from __future__ import annotations

import pytest
import struct
from pathlib import Path

from app.pipeline.packet_parser import BINARY_PACKET_FORMAT, PacketParser


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "serial_replay_lines.csv"


def _load_sample_lines() -> list[str]:
    lines: list[str] = []
    with FIXTURE_PATH.open("r", encoding="utf-8") as handle:
        for raw in handle:
            row = raw.strip()
            if row and not row.startswith("#"):
                lines.append(row)
    return lines


def test_parse_csv_packet_without_optional_fields() -> None:
    parser = PacketParser()
    line = "10,24.0,25.0,101325,110.5,0.1,0.2,9.8,0.01,0.02,0.03"

    frame = parser.parse_csv_line(line)

    assert frame is not None
    assert frame.time == 10
    assert frame.altitude == 110.5
    assert frame.rssi is None
    assert frame.snr is None
    assert frame.packet_id is None


def test_parse_csv_packet_with_optional_radio_fields_from_fixture() -> None:
    parser = PacketParser()
    sample = _load_sample_lines()[0]

    frame = parser.parse_csv_line(sample)

    assert frame is not None
    assert frame.time == 0
    assert frame.rssi == -98.0
    assert frame.snr == 9.2
    assert frame.packet_id == 1


def test_parse_binary_packet() -> None:
    parser = PacketParser()
    raw = struct.pack(
        BINARY_PACKET_FORMAT,
        250,
        25.0,
        26.0,
        100900.0,
        123.4,
        0.1,
        0.2,
        9.81,
        0.01,
        0.02,
        0.03,
    )

    frame = parser.parse_binary_packet(raw)

    assert frame is not None
    assert frame.time == 250
    assert frame.pressure == 100900.0
    assert frame.altitude == pytest.approx(123.4)


def test_parse_csv_rejects_malformed_non_numeric() -> None:
    parser = PacketParser()
    malformed = "100,24.0,abc,101325,110,0.1,0.2,9.8,0.01,0.02,0.03"

    assert parser.parse_csv_line(malformed) is None


def test_parse_csv_rejects_truncated_line() -> None:
    parser = PacketParser()
    truncated = "100,24.0,25.0,101325"

    assert parser.parse_csv_line(truncated) is None


def test_parse_csv_rejects_garbage_binary_mixed_line() -> None:
    parser = PacketParser()
    garbage = "100,24.0,\ufffd\x00,101325,110,0.1,0.2,9.8,0.01,0.02,0.03"

    assert parser.parse_csv_line(garbage) is None


def test_parse_csv_rejects_empty_or_debug_input() -> None:
    parser = PacketParser()

    assert parser.parse_csv_line("") is None
    assert parser.parse_csv_line("Data received") is None


def test_parse_binary_rejects_truncated_packet() -> None:
    parser = PacketParser()
    raw = b"\x00\x01\x02"

    assert parser.parse_binary_packet(raw) is None