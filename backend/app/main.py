from __future__ import annotations

import csv
import math
import time
from pathlib import Path
from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_socketio import SocketIO, emit

from .pipeline.serial_source import SerialSource
from .pipeline.telemetry_pipeline import TelemetryPipeline
from .pipeline.recorder import TelemetryRecorder

app = Flask(__name__)
CORS(app, origins=["http://127.0.0.1:5173", "*"], supports_credentials=True)
socketio = SocketIO(app, cors_allowed_origins="*")

serial_source = SerialSource(baudrate=115200)
pipeline = TelemetryPipeline(recorder=TelemetryRecorder("flight_log.csv"))

stream_task = None
_simulation_enabled = True  # Enable simulated telemetry when no real data
_simulation_start_time = time.time()  # Track when simulation started
_simulation_rows = []
_simulation_index = 0


def _load_simulation_rows() -> list[dict]:
    csv_path = Path(__file__).resolve().parents[1] / "TestData" / "generated_blue_raven_test_data.csv"
    rows: list[dict] = []

    if not csv_path.exists():
        return rows

    with csv_path.open(newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            rows.append(row)

    return rows


def _float_value(row: dict, key: str, default: float = 0.0) -> float:
    value = row.get(key, "")
    if value in (None, ""):
        return default
    return float(value)


def _build_envelope_from_row(row: dict) -> dict:
    north_m = _float_value(row, "derived_north_m")
    east_m = _float_value(row, "derived_east_m")
    azimuth_deg = (math.degrees(math.atan2(east_m, max(north_m, 1e-9))) + 360.0) % 360.0
    temperature_c = (_float_value(row, "Temperature_(F)") - 32.0) * (5.0 / 9.0)

    return {
        "type": "telemetry",
        "timestamp": int(time.time() * 1000),
        "packet": {
            "time": int(round(_float_value(row, "Flight_Time_(s)") * 1000.0)),
            "altitude": _float_value(row, "derived_altitude_m", _float_value(row, "Baro_Altitude_ASL_(feet)") * 0.3048),
            "bmpTemp": temperature_c,
            "imuTemp": temperature_c + 0.8,
            "pressure": _float_value(row, "Baro_Press_(atm)") * 101325.0,
            "accX": _float_value(row, "Accel_X"),
            "accY": _float_value(row, "Accel_Y"),
            "accZ": _float_value(row, "Accel_Z"),
            "angVelX": _float_value(row, "Gyro_X"),
            "angVelY": _float_value(row, "Gyro_Y"),
            "angVelZ": _float_value(row, "Gyro_Z"),
        },
        "derived": {
            "velocity": _float_value(row, "derived_speed_mps"),
            "downrange_m": north_m,
            "east_m": east_m,
            "north_m": north_m,
            "latitude": _float_value(row, "derived_latitude"),
            "longitude": _float_value(row, "derived_longitude"),
            "azimuth_deg": azimuth_deg,
        },
    }


def _next_simulated_envelope() -> dict:
    global _simulation_index

    if not _simulation_rows:
        from .telemetry import build_sample, sample_to_dict

        elapsed_ms = int((time.time() - _simulation_start_time) * 1000)
        return sample_to_dict(build_sample(elapsed_ms))

    row = _simulation_rows[_simulation_index]
    _simulation_index = (_simulation_index + 1) % len(_simulation_rows)
    return _build_envelope_from_row(row)


_simulation_rows = _load_simulation_rows()


@app.route("/ports", methods=["GET"])
def get_serial_ports():
    return jsonify({"success": True, "ports": serial_source.list_ports()})


@app.route("/set_port", methods=["POST"])
def set_serial_port():
    port = request.json.get("port")
    if not port:
        return jsonify({"success": False, "error": "No port specified"}), 400

    serial_source.set_port(port)
    return jsonify({"success": True, "message": f"Serial port {port} has been set"})


@app.route("/open_port", methods=["POST"])
def open_serial_port():
    global stream_task, _simulation_enabled

    try:
        serial_source.open()
        _simulation_enabled = False
        
        if stream_task is None:
            stream_task = socketio.start_background_task(stream_serial_to_pipeline)

        socketio.emit("port_opened", {"port": serial_source.port_name})
        return jsonify({"success": True, "message": f"Serial port {serial_source.port_name} opened"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/stop_port", methods=["POST"])
def stop_serial_port():
    global _simulation_enabled
    try:
        serial_source.close()
        _simulation_enabled = True
        return jsonify({"success": True, "message": "Serial port closed"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/telemetry/latest", methods=["GET"])
def latest_telemetry():
    return jsonify({"success": True, "data": pipeline.latest()})


@app.route("/telemetry/history", methods=["GET"])
def telemetry_history():
    return jsonify({"success": True, "data": pipeline.history()})


@app.route("/telemetry/stats", methods=["GET"])
def telemetry_stats():
    return jsonify({"success": True, "data": pipeline.stats()})


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


@app.route("/telemetry/restart", methods=["POST"])
def restart_simulation():
    """Restart the simulation from the beginning"""
    global _simulation_start_time, _simulation_index
    _simulation_start_time = time.time()
    _simulation_index = 0
    return jsonify({"success": True, "message": "Simulation restarted"})


@socketio.on("connect")
def handle_connect():
    global stream_task
    print(f"Client connected")
    
    if stream_task is None:
        stream_task = socketio.start_background_task(stream_telemetry)


@socketio.on("disconnect")
def handle_disconnect():
    print(f"Client disconnected")


@socketio.on("request_telemetry")
def request_telemetry():
    # Send buffered data immediately so the dashboard is not empty after refresh.
    for row in pipeline.history()[-100:]:
        emit("telemetry_data", row)

    emit("pipeline_stats", pipeline.stats())


@socketio.on("restart_simulation")
def handle_restart_simulation():
    """Socket.IO handler to restart simulation from client"""
    global _simulation_start_time, _simulation_index
    _simulation_start_time = time.time()
    _simulation_index = 0
    emit("simulation_restarted", {"success": True}, broadcast=True)


def stream_serial_to_pipeline():
    """
    Background loop for real serial data:
    serial line -> parse -> validate/interference check -> log -> socket emit
    """
    for line in serial_source.lines():
        row = pipeline.process_line(line)
        if row is not None:
            socketio.emit("telemetry_data", row)
            socketio.emit("pipeline_stats", pipeline.stats())

        socketio.sleep(0.001)


def stream_simulated_telemetry():
    """
    Generate simulated telemetry for testing/demo purposes
    """
    while _simulation_enabled:
        try:
            sample = _next_simulated_envelope()
            socketio.emit("telemetry_data", sample)

            if _simulation_rows:
                socketio.sleep(0.02)
            else:
                socketio.sleep(0.1)
        except Exception as e:
            print(f"Error in simulated telemetry: {e}")
            socketio.sleep(0.5)


def stream_telemetry():
    """
    Main telemetry stream - uses real data or falls back to simulation
    """
    global _simulation_start_time
    
    while True:
        if _simulation_enabled:
            try:
                sample = _next_simulated_envelope()
                socketio.emit("telemetry_data", sample)

                if _simulation_rows:
                    socketio.sleep(0.02)
                else:
                    socketio.sleep(0.1)
            except Exception as e:
                print(f"Error in simulated telemetry: {e}")
                socketio.sleep(0.5)
        else:
            # Real serial data stream
            socketio.sleep(0.01)


if __name__ == "__main__":
    socketio.run(app, debug=True, host="127.0.0.1", port=5000)



