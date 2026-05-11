from collections import deque
from typing import Callable, Dict, Any, Optional
from .packet_parser import PacketParser
from .quality import InterferenceMonitor
from .recorder import TelemetryRecorder


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

    def process_line(self, line: str) -> Optional[Dict[str, Any]]:
        frame = self.parser.parse_csv_line(line)

        if frame is None:
            self.quality.record_parse_failure()
            return None

        checked = self.quality.check(frame)
        row = checked.to_dict()

        self.buffer.append(row)

        if self.recorder:
            self.recorder.write(row)

        if self.on_frame:
            self.on_frame(row)

        return row

    def latest(self):
        return self.buffer[-1] if self.buffer else None

    def history(self):
        return list(self.buffer)

    def stats(self):
        return self.quality.stats()
