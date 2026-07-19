from __future__ import annotations

import csv
from pathlib import Path

from app import main as main_module
from app.pipeline.recorder import TelemetryRecorder
from app.pipeline.telemetry_pipeline import TelemetryPipeline

from .fakes import DisconnectSignal, FixtureReplaySerialSource


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "serial_replay_lines.csv"


def _load_fixture_lines() -> list[str]:
    rows: list[str] = []
    with FIXTURE_PATH.open("r", encoding="utf-8") as handle:
        for raw in handle:
            line = raw.strip()
            if line and not line.startswith("#"):
                rows.append(line)
    return rows


def _setup_pipeline(tmp_path: Path) -> Path:
    output_path = tmp_path / "flight_log_test.csv"
    main_module.pipeline = TelemetryPipeline(recorder=TelemetryRecorder(str(output_path)), max_buffer=50)
    return output_path


def _capture_socket_events(monkeypatch):
    events = []

    def fake_emit(event_name, payload, *args, **kwargs):
        events.append((event_name, payload))

    monkeypatch.setattr(main_module.socketio, "emit", fake_emit)
    monkeypatch.setattr(main_module.socketio, "sleep", lambda *_: None)
    return events


def test_reader_parser_to_api_and_websocket_normal_flow(tmp_path: Path, monkeypatch) -> None:
    # Integration layer: replay serial fixture -> parser -> quality -> recorder -> websocket/api state.
    output_path = _setup_pipeline(tmp_path)
    events = _capture_socket_events(monkeypatch)

    source = FixtureReplaySerialSource(fixture_path=FIXTURE_PATH)
    source.open()
    monkeypatch.setattr(main_module, "serial_source", source)

    main_module.stream_serial_to_pipeline()

    telemetry_events = [payload for name, payload in events if name == "telemetry_data"]
    stats_events = [payload for name, payload in events if name == "pipeline_stats"]
    assert len(telemetry_events) == 3
    assert len(stats_events) == 3

    client = main_module.app.test_client()
    latest = client.get("/telemetry/latest").get_json()
    history = client.get("/telemetry/history").get_json()
    stats = client.get("/telemetry/stats").get_json()

    assert latest["success"] is True
    assert latest["data"]["packet_id"] == 3
    assert history["success"] is True
    assert len(history["data"]) == 3
    assert stats["success"] is True
    assert stats["data"]["total_frames"] == 3

    with output_path.open("r", encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    assert len(rows) == 3
    assert rows[-1]["packet_id"] == "3"


def test_reader_path_handles_disconnect_then_reconnect(tmp_path: Path, monkeypatch) -> None:
    # Integration layer: connection drop should not prevent later frames from reaching backend outputs.
    output_path = _setup_pipeline(tmp_path)
    events = _capture_socket_events(monkeypatch)
    scripted = [
        _load_fixture_lines()[0],
        DisconnectSignal(),
        _load_fixture_lines()[1],
    ]

    source = FixtureReplaySerialSource(scripted_items=scripted)
    source.open()
    monkeypatch.setattr(main_module, "serial_source", source)

    main_module.stream_serial_to_pipeline()

    telemetry_events = [payload for name, payload in events if name == "telemetry_data"]
    assert len(telemetry_events) == 2
    assert source.reconnect_count == 1

    with output_path.open("r", encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    assert len(rows) == 2


def test_reader_path_no_data_before_timeout(tmp_path: Path, monkeypatch) -> None:
    # Integration layer: timeout with no bytes should produce no telemetry rows and keep API state empty.
    _setup_pipeline(tmp_path)
    events = _capture_socket_events(monkeypatch)

    source = FixtureReplaySerialSource(scripted_items=[], timeout_seconds=0.01)
    source.open()
    monkeypatch.setattr(main_module, "serial_source", source)

    main_module.stream_serial_to_pipeline()

    telemetry_events = [payload for name, payload in events if name == "telemetry_data"]
    assert telemetry_events == []

    client = main_module.app.test_client()
    latest = client.get("/telemetry/latest").get_json()
    stats = client.get("/telemetry/stats").get_json()

    assert latest["success"] is True
    assert latest["data"] is None
    assert stats["success"] is True
    assert stats["data"]["total_frames"] == 0