import time
import math
from collections import deque
from typing import Optional, Dict, Any
from .telemetry_schema import TelemetryFrame


class InterferenceMonitor:
    """
    Tracks radio/data quality without controlling the rocket.

    This gives you project evidence for interference work:
    packet loss, jitter, stale data, duplicate packets, RSSI/SNR warnings,
    and physically suspicious telemetry spikes.
    """

    def __init__(self, max_history: int = 200):
        self.history = deque(maxlen=max_history)
        self.last_frame: Optional[TelemetryFrame] = None
        self.last_packet_id: Optional[int] = None
        self.total_frames = 0
        self.parse_failures = 0
        self.dropout_count = 0
        self.duplicate_count = 0
        self.missing_packets = 0

    def record_parse_failure(self) -> None:
        self.parse_failures += 1

    def check(self, frame: TelemetryFrame) -> TelemetryFrame:
        now = time.time()
        frame.received_at = now
        warnings = []

        self.total_frames += 1

        # Basic sanity checks.
        numeric_fields = [
            frame.time, frame.bmpTemp, frame.imuTemp, frame.pressure, frame.altitude,
            frame.accX, frame.accY, frame.accZ, frame.angVelX, frame.angVelY, frame.angVelZ
        ]
        if any(math.isnan(x) or math.isinf(x) for x in numeric_fields):
            warnings.append("bad_numeric_value")

        if not (20000 <= frame.pressure <= 120000):
            warnings.append("pressure_out_of_expected_range")

        if not (-1000 <= frame.altitude <= 10000):
            warnings.append("altitude_out_of_expected_range")

        # Radio interference indicators.
        if frame.rssi is not None and frame.rssi < -115:
            warnings.append("weak_rssi_possible_interference")

        if frame.snr is not None and frame.snr < 0:
            warnings.append("low_snr_possible_interference")

        # Packet ID based loss/duplicate detection.
        if frame.packet_id is not None:
            if self.last_packet_id is not None:
                expected = self.last_packet_id + 1
                if frame.packet_id == self.last_packet_id:
                    self.duplicate_count += 1
                    warnings.append("duplicate_packet")
                elif frame.packet_id > expected:
                    missing = frame.packet_id - expected
                    self.missing_packets += missing
                    warnings.append(f"packet_gap_missing_{missing}")
                elif frame.packet_id < self.last_packet_id:
                    warnings.append("packet_id_went_backwards")
            self.last_packet_id = frame.packet_id

        # Time and spike checks.
        if self.last_frame is not None:
            dt_ms = frame.time - self.last_frame.time

            if dt_ms <= 0:
                warnings.append("timestamp_not_increasing")

            if dt_ms > 1000:
                self.dropout_count += 1
                warnings.append("telemetry_dropout_or_large_gap")

            d_alt = abs(frame.altitude - self.last_frame.altitude)
            if dt_ms > 0:
                vertical_speed = d_alt / (dt_ms / 1000.0)
                if vertical_speed > 350:
                    warnings.append("altitude_spike_check_sensor_or_packet_error")

            accel_mag = math.sqrt(frame.accX**2 + frame.accY**2 + frame.accZ**2)
            if accel_mag > 200:
                warnings.append("acceleration_spike_check_sensor_or_packet_error")

        if len(warnings) >= 3:
            frame.quality_status = "BAD"
        elif warnings:
            frame.quality_status = "WARN"
        else:
            frame.quality_status = "OK"

        frame.warnings = warnings
        self.history.append(frame)
        self.last_frame = frame
        return frame

    def stats(self) -> Dict[str, Any]:
        denominator = max(1, self.total_frames + self.missing_packets)
        return {
            "total_frames": self.total_frames,
            "parse_failures": self.parse_failures,
            "dropout_count": self.dropout_count,
            "duplicate_count": self.duplicate_count,
            "missing_packets": self.missing_packets,
            "packet_loss_percent": round((self.missing_packets / denominator) * 100, 2),
        }
