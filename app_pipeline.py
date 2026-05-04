from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_socketio import SocketIO, emit

from pipeline.serial_source import SerialSource
from pipeline.telemetry_pipeline import TelemetryPipeline
from pipeline.recorder import TelemetryRecorder

app = Flask(__name__)
CORS(app, origins=["http://127.0.0.1:5173", "*"], supports_credentials=True)
socketio = SocketIO(app, cors_allowed_origins="*")

serial_source = SerialSource(baudrate=115200)
pipeline = TelemetryPipeline(recorder=TelemetryRecorder("flight_log.csv"))

stream_task = None


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
    global stream_task

    try:
        serial_source.open()

        if stream_task is None:
            stream_task = socketio.start_background_task(stream_serial_to_pipeline)

        socketio.emit("port_opened", {"port": serial_source.port_name})
        return jsonify({"success": True, "message": f"Serial port {serial_source.port_name} opened"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/stop_port", methods=["POST"])
def stop_serial_port():
    try:
        serial_source.close()
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


@socketio.on("request_telemetry")
def request_telemetry():
    # Send buffered data immediately so the dashboard is not empty after refresh.
    for row in pipeline.history()[-100:]:
        emit("telemetry_data", row)

    emit("pipeline_stats", pipeline.stats())


def stream_serial_to_pipeline():
    """
    Background loop:
    serial line -> parse -> validate/interference check -> log -> socket emit
    """
    for line in serial_source.lines():
        row = pipeline.process_line(line)
        if row is not None:
            socketio.emit("telemetry_data", row)
            socketio.emit("pipeline_stats", pipeline.stats())

        socketio.sleep(0.001)


if __name__ == "__main__":
    socketio.run(app, debug=True, host="127.0.0.1", port=5000)
