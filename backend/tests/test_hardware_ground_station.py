from __future__ import annotations

import os
import time

import pytest

from app.pipeline.packet_parser import PacketParser
from app.pipeline.serial_source import SerialSource


@pytest.mark.hardware
def test_real_ground_station_emits_at_least_one_valid_packet() -> None:
    """
    Hardware-in-the-loop layer: requires a physically connected ground station.

    This test is excluded from default test runs and should be invoked explicitly
    on the Raspberry Pi (or another machine with the hardware connected).
    """
    port = os.environ.get("GROUND_STATION_PORT")
    if not port:
        pytest.skip("Set GROUND_STATION_PORT to run hardware serial test")

    parser = PacketParser()
    source = SerialSource(port_name=port, baudrate=115200, timeout=0.2)

    deadline = time.time() + 10.0
    valid_packet = None

    try:
        source.open()
        if source.ser is None:
            pytest.fail("Serial port opened but serial handle is unavailable")

        while time.time() < deadline:
            raw = source.ser.readline()
            if not raw:
                continue

            line = raw.decode("utf-8", errors="replace").strip()
            parsed = parser.parse_csv_line(line)
            if parsed is not None:
                valid_packet = parsed
                break
    finally:
        source.close()

    assert valid_packet is not None, (
        "No valid telemetry packet was received within 10 seconds. "
        "Check Ground Station power, serial wiring, baudrate, and selected port."
    )