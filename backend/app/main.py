from __future__ import annotations

import time
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
    global _simulation_start_time
    _simulation_start_time = time.time()
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
    global _simulation_start_time
    _simulation_start_time = time.time()
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
    from .telemetry import build_sample, sample_to_dict
    
    start = time.time()
    MAX_ALTITUDE_FEET = 11_000.0
    FEET_TO_METERS = 0.3048
    MAX_ALTITUDE_METERS = MAX_ALTITUDE_FEET * FEET_TO_METERS
    
    while _simulation_enabled:
        try:
            elapsed_ms = int((time.time() - start) * 1000)
            sample = build_sample(elapsed_ms)
            
            # Restart simulation at max altitude
            if sample.packet.altitude >= MAX_ALTITUDE_METERS:
                start = time.time()
                elapsed_ms = 0
                sample = build_sample(elapsed_ms)
            
            socketio.emit("telemetry_data", sample_to_dict(sample))
            socketio.sleep(0.1)
        except Exception as e:
            print(f"Error in simulated telemetry: {e}")
            socketio.sleep(0.5)


def stream_telemetry():
    """
    Main telemetry stream - uses real data or falls back to simulation
    """
    global _simulation_start_time
    from .telemetry import build_sample, sample_to_dict
    
    MAX_ALTITUDE_FEET = 11_000.0
    FEET_TO_METERS = 0.3048
    MAX_ALTITUDE_METERS = MAX_ALTITUDE_FEET * FEET_TO_METERS
    
    while True:
        if _simulation_enabled:
            try:
                elapsed_ms = int((time.time() - _simulation_start_time) * 1000)
                sample = build_sample(elapsed_ms)
                
                # Restart simulation at max altitude
                if sample.packet.altitude >= MAX_ALTITUDE_METERS:
                    _simulation_start_time = time.time()
                    elapsed_ms = 0
                    sample = build_sample(elapsed_ms)
                
                socketio.emit("telemetry_data", sample_to_dict(sample))
                socketio.sleep(0.1)
            except Exception as e:
                print(f"Error in simulated telemetry: {e}")
                socketio.sleep(0.5)
        else:
            # Real serial data stream
            socketio.sleep(0.01)


if __name__ == "__main__":
    socketio.run(app, debug=True, host="127.0.0.1", port=5000)



