import math
import time
from collections import deque
from typing import Callable, Dict, Any, Optional
from .packet_parser import PacketParser
from .quality import InterferenceMonitor
from .recorder import TelemetryRecorder


LAUNCH_SITE_LATITUDE = -30.670535341898105
LAUNCH_SITE_LONGITUDE = 143.18988386875418
EARTH_METERS_PER_DEGREE = 111_111.0


class TelemetryPipeline:
    """
    Main data pipeline.

    Input: raw serial CSV lines.
    Output: validated telemetry dictionaries ready for Socket.IO/dashboard.
    """

    def __init__(self, recorder: Optional[TelemetryRecorder] = None, max_buffer: int = 500):
        self.parser = PacketParser()
        self.quality = InterferenceMonitor()
        self.recorder = recorder
        self.buffer = deque(maxlen=max_buffer)
        self.on_frame: Optional[Callable[[Dict[str, Any]], None]] = None

    def _build_envelope(self, row: Dict[str, Any]) -> Dict[str, Any]:
        last_envelope = self.buffer[-1] if self.buffer else None
        last_packet = last_envelope.get("packet") if last_envelope else None
        dt_ms = 0.0
        velocity = 0.0

        if last_packet is not None:
            dt_ms = float(row["time"]) - float(last_packet.get("time", 0.0))
            if dt_ms > 0:
                velocity = (float(row["altitude"]) - float(last_packet.get("altitude", 0.0))) / (dt_ms / 1000.0)

        north_m = 0.0
        east_m = 0.0
        latitude = LAUNCH_SITE_LATITUDE
        longitude = LAUNCH_SITE_LONGITUDE
        azimuth_deg = 0.0

        if last_envelope is not None:
            last_derived = last_envelope.get("derived", {})
            north_m = float(last_derived.get("north_m", 0.0))
            east_m = float(last_derived.get("east_m", 0.0))
            latitude = float(last_derived.get("latitude", LAUNCH_SITE_LATITUDE))
            longitude = float(last_derived.get("longitude", LAUNCH_SITE_LONGITUDE))
            azimuth_deg = float(last_derived.get("azimuth_deg", 0.0))

        if row.get("packet_id") is not None and last_packet is not None and dt_ms > 0 and abs(velocity) > 1.0:
            north_m += velocity * (dt_ms / 1000.0)
            latitude = LAUNCH_SITE_LATITUDE + north_m / EARTH_METERS_PER_DEGREE
            longitude = LAUNCH_SITE_LONGITUDE + east_m / (
                EARTH_METERS_PER_DEGREE * math.cos(math.radians(LAUNCH_SITE_LATITUDE))
            )
            azimuth_deg = 0.0

        packet = {
            "time": int(round(float(row["time"]))),
            "altitude": float(row["altitude"]),
            "bmpTemp": float(row["bmpTemp"]),
            "imuTemp": float(row["imuTemp"]),
            "pressure": float(row["pressure"]),
            "accX": float(row["accX"]),
            "accY": float(row["accY"]),
            "accZ": float(row["accZ"]),
            "angVelX": float(row["angVelX"]),
            "angVelY": float(row["angVelY"]),
            "angVelZ": float(row["angVelZ"]),
        }

        return {
            "type": "telemetry",
            "timestamp": int(time.time() * 1000),
            "packet": packet,
            "derived": {
                "velocity": velocity,
                "downrange_m": north_m,
                "east_m": east_m,
                "north_m": north_m,
                "latitude": latitude,
                "longitude": longitude,
                "azimuth_deg": azimuth_deg,
            },
            "quality": {
                "status": row["quality_status"],
                "warnings": row["warnings"],
                "received_at": row["received_at"],
                "rssi": row.get("rssi"),
                "snr": row.get("snr"),
                "packet_id": row.get("packet_id"),
            },
        }

    def process_line(self, line: str) -> Optional[Dict[str, Any]]:
        frame = self.parser.parse_csv_line(line)

        if frame is None:
            self.quality.record_parse_failure()
            return None

        checked = self.quality.check(frame)
        row = checked.to_dict()
        envelope = self._build_envelope(row)

        self.buffer.append(envelope)

        if self.recorder:
            self.recorder.write(row)

        if self.on_frame:
            self.on_frame(envelope)

        return envelope

    def latest(self):
        return self.buffer[-1] if self.buffer else None

    def history(self):
        return list(self.buffer)

    def stats(self):
        return self.quality.stats()
