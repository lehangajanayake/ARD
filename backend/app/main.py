from __future__ import annotations

import csv
import math
import os
import sys
import time
import threading
import select
import tty
import termios
from pathlib import Path
from typing import Any
from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_socketio import SocketIO, emit

from .pipeline.serial_source import SerialSource
from .pipeline.telemetry_pipeline import TelemetryPipeline
from .pipeline.recorder import TelemetryRecorder

app = Flask(__name__)
CORS(
    app,
    resources={r"/*": {"origins": "*"}},
    allow_headers=["*"],
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    supports_credentials=False,
)
# Allow all local dev origins for Socket.IO to avoid port-hopping 403 loops.
socketio = SocketIO(app, cors_allowed_origins="*")

serial_source = SerialSource(baudrate=115200)
pipeline = TelemetryPipeline(recorder=TelemetryRecorder("flight_log.csv"))

stream_task = None
_simulation_enabled = True  # Enable simulated telemetry when no real data
_simulation_start_time = time.time()  # Track when simulation started
_simulation_rows = []
_simulation_index = 0
_last_status_emit_at = 0.0
_last_packet_emit_at = 0.0

telemetry_status: dict[str, Any] = {
    "type": "telemetry_status",
    "mode": "simulation",
    "stream": "idle",
    "serial_port": None,
    "serial_connected": False,
    "last_packet_at_ms": None,
    "last_error": None,
    "last_error_at_ms": None,
    "note": "waiting_for_client",
}


def _now_ms() -> int:
    return int(time.time() * 1000)


def _status_snapshot() -> dict[str, Any]:
    snapshot = dict(telemetry_status)
    snapshot["timestamp_ms"] = _now_ms()
    snapshot["stats"] = pipeline.stats()
    if snapshot.get("last_packet_at_ms"):
        snapshot["last_packet_age_ms"] = max(0, snapshot["timestamp_ms"] - int(snapshot["last_packet_at_ms"]))
    else:
        snapshot["last_packet_age_ms"] = None
    return snapshot


def _publish_status(force: bool = False) -> None:
    global _last_status_emit_at

    now = time.time()
    if not force and (now - _last_status_emit_at) < 1.0:
        return

    _last_status_emit_at = now
    socketio.emit("telemetry_status", _status_snapshot())


def _set_status(**updates: Any) -> None:
    telemetry_status.update(updates)


def _set_status_error(message: str) -> None:
    _set_status(last_error=message, last_error_at_ms=_now_ms(), stream="error")


def _record_packet_emitted() -> None:
    global _last_packet_emit_at

    _last_packet_emit_at = time.time()
    _set_status(last_packet_at_ms=_now_ms(), stream="running", last_error=None)


def _load_simulation_rows() -> list[dict]:
    csv_path = Path(__file__).resolve().parents[2] / "TestData" / "generated_blue_raven_test_data.csv"
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
    _set_status(serial_port=port)
    _publish_status(force=True)
    return jsonify({"success": True, "message": f"Serial port {port} has been set"})


@app.route("/open_port", methods=["POST"])
def open_serial_port():
    global stream_task, _simulation_enabled

    try:
        serial_source.open()
        _simulation_enabled = False
        _set_status(
            mode="serial",
            stream="running",
            serial_connected=True,
            serial_port=serial_source.port_name,
            last_error=None,
            note="serial_stream_active",
        )
        
        if stream_task is None:
            stream_task = socketio.start_background_task(stream_telemetry)

        socketio.emit("port_opened", {"port": serial_source.port_name})
        _publish_status(force=True)
        return jsonify({"success": True, "message": f"Serial port {serial_source.port_name} opened"})
    except Exception as e:
        _simulation_enabled = True
        _set_status(mode="simulation", serial_connected=False, note="serial_open_failed")
        _set_status_error(str(e))
        _publish_status(force=True)
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/stop_port", methods=["POST"])
def stop_serial_port():
    global _simulation_enabled
    try:
        serial_source.close()
        _simulation_enabled = True
        _set_status(mode="simulation", stream="running", serial_connected=False, note="serial_closed")
        _publish_status(force=True)
        return jsonify({"success": True, "message": "Serial port closed"})
    except Exception as e:
        _set_status_error(str(e))
        _publish_status(force=True)
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
    global _simulation_start_time, _simulation_index, _simulation_enabled
    try:
        serial_source.close()
    except Exception:
        pass

    _simulation_enabled = True
    _simulation_start_time = time.time()
    _simulation_index = 0
    _set_status(
        mode="simulation",
        stream="running",
        serial_connected=False,
        note="simulation_restarted",
        last_error=None,
    )
    _publish_status(force=True)
    return jsonify({"success": True, "message": "Simulation restarted"})


def _stdin_watcher():
    """Background watcher that listens to stdin and restarts simulation on 'R' or 'r'.

    Supports single-key presses when stdin is a TTY (no Enter required). When
    stdin is not a TTY (e.g., redirected), falls back to line-based input.
    """
    global _simulation_start_time, _simulation_index

    def do_restart():
        global _simulation_start_time, _simulation_index
        _simulation_start_time = time.time()
        _simulation_index = 0
        try:
            socketio.emit("simulation_restarted", {"success": True}, broadcast=True)
        except Exception:
            pass
        print("Simulation restarted via keyboard")

    try:
        if sys.stdin is not None and sys.stdin.isatty():
            fd = sys.stdin.fileno()
            old_settings = termios.tcgetattr(fd)
            try:
                tty.setcbreak(fd)
                while True:
                    rlist, _, _ = select.select([sys.stdin], [], [], 0.2)
                    if rlist:
                        ch = sys.stdin.read(1)
                        if ch and ch.lower() == "r":
                            do_restart()
            finally:
                termios.tcsetattr(fd, termios.TCSADRAIN, old_settings)
        else:
            # Fallback: line-based reading (requires Enter)
            for line in sys.stdin:
                if "r" in line.lower():
                    do_restart()
    except Exception as e:
        print(f"stdin watcher exited: {e}")


@socketio.on("connect")
def handle_connect():
    global stream_task
    print(f"Client connected")
    _set_status(note="client_connected")
    
    if stream_task is None:
        _set_status(stream="starting")
        stream_task = socketio.start_background_task(stream_telemetry)

    emit("telemetry_status", _status_snapshot())


@socketio.on("disconnect")
def handle_disconnect():
    print(f"Client disconnected")


@socketio.on("request_telemetry")
def request_telemetry():
    # Send buffered data immediately so the dashboard is not empty after refresh.
    for row in pipeline.history()[-100:]:
        emit("telemetry_data", row)

    emit("pipeline_stats", pipeline.stats())
    emit("telemetry_status", _status_snapshot())


@socketio.on("restart_simulation")
def handle_restart_simulation():
    """Socket.IO handler to restart simulation from client"""
    global _simulation_start_time, _simulation_index, _simulation_enabled
    try:
        serial_source.close()
    except Exception:
        pass

    _simulation_enabled = True
    _simulation_start_time = time.time()
    _simulation_index = 0
    _set_status(
        mode="simulation",
        stream="running",
        serial_connected=False,
        note="simulation_restarted",
        last_error=None,
    )
    emit("simulation_restarted", {"success": True}, broadcast=True)
    emit("telemetry_status", _status_snapshot(), broadcast=True)


def stream_serial_to_pipeline():
    """
    Background loop for real serial data:
    serial line -> parse -> validate/interference check -> log -> socket emit
    """
    for line in serial_source.lines():
        row = pipeline.process_line(line)
        if row is not None:
            _record_packet_emitted()
            socketio.emit("telemetry_data", row)
            socketio.emit("pipeline_stats", pipeline.stats())
            _publish_status()

        socketio.sleep(0.001)


def stream_simulated_telemetry():
    """
    Generate simulated telemetry for testing/demo purposes
    """
    while _simulation_enabled:
        try:
            sample = _next_simulated_envelope()
            _record_packet_emitted()
            socketio.emit("telemetry_data", sample)
            _set_status(mode="simulation", stream="running", note="simulation")
            _publish_status()

            if _simulation_rows:
                socketio.sleep(0.02)
            else:
                socketio.sleep(0.1)
        except Exception as e:
            print(f"Error in simulated telemetry: {e}")
            _set_status_error(str(e))
            _publish_status(force=True)
            socketio.sleep(0.5)


def stream_telemetry():
    """
    Main telemetry stream - uses real data or falls back to simulation
    """
    global _simulation_start_time, _simulation_enabled
    
    while True:
        if _simulation_enabled:
            try:
                sample = _next_simulated_envelope()
                _record_packet_emitted()
                socketio.emit("telemetry_data", sample)
                _set_status(mode="simulation", stream="running", serial_connected=False, note="simulation")
                _publish_status()

                if _simulation_rows:
                    socketio.sleep(0.02)
                else:
                    socketio.sleep(0.1)
            except Exception as e:
                print(f"Error in simulated telemetry: {e}")
                _set_status_error(str(e))
                _publish_status(force=True)
                socketio.sleep(0.5)
        else:
            try:
                emitted_any = False
                _set_status(mode="serial", serial_connected=True, stream="running", note="reading_serial")
                for line in serial_source.lines():
                    if _simulation_enabled:
                        break

                    sample = pipeline.process_line(line)
                    if sample is None:
                        continue

                    emitted_any = True
                    _record_packet_emitted()
                    socketio.emit("telemetry_data", sample)
                    socketio.emit("pipeline_stats", pipeline.stats())
                    _publish_status()
                    socketio.sleep(0.001)

                if not emitted_any:
                    if _last_packet_emit_at and (time.time() - _last_packet_emit_at) > 2.0:
                        _set_status(
                            mode="serial",
                            serial_connected=True,
                            stream="waiting_data",
                            note="no_serial_data_recently",
                        )
                        _publish_status()
                    socketio.sleep(0.01)
            except Exception as e:
                print(f"Error in serial telemetry: {e}")
                _set_status_error(str(e))
                _set_status(serial_connected=False, note="serial_error_fallback_to_simulation")
                _simulation_enabled = True
                try:
                    serial_source.close()
                except Exception:
                    pass
                _publish_status(force=True)
                socketio.sleep(0.1)


if os.environ.get("WERKZEUG_RUN_MAIN") == "true" or __name__ == "__main__":
    # Start stdin watcher in the reloader child or when running directly.
    try:
        socketio.start_background_task(_stdin_watcher)
    except Exception:
        watcher_thread = threading.Thread(target=_stdin_watcher, daemon=True)
        watcher_thread.start()

if __name__ == "__main__":
    socketio.run(app, debug=True, host="127.0.0.1", port=5000)



