from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Iterator, Optional, Union


@dataclass(frozen=True)
class DisconnectSignal:
    """Marker used by tests to emulate a dropped serial connection."""


class FixtureReplaySerialSource:
    """
    Test double for SerialSource that replays lines from an iterable or fixture file.

    This mirrors the minimal SerialSource API used by backend routes/pipeline:
    set_port(), open(), close(), list_ports(), and lines().
    """

    def __init__(
        self,
        scripted_items: Optional[Iterable[Union[str, DisconnectSignal]]] = None,
        fixture_path: Optional[Path] = None,
        timeout_seconds: float = 0.0,
    ):
        self.scripted_items = list(scripted_items) if scripted_items is not None else []
        self.fixture_path = fixture_path
        self.timeout_seconds = timeout_seconds
        self.port_name: Optional[str] = None
        self.running = False
        self.is_open = False
        self.reconnect_count = 0

    def set_port(self, port_name: str) -> None:
        self.port_name = port_name

    def open(self) -> None:
        self.running = True
        self.is_open = True

    def close(self) -> None:
        self.running = False
        self.is_open = False

    def list_ports(self):
        return ["/dev/ttyUSB_TEST"]

    def _fixture_lines(self) -> list[str]:
        if self.fixture_path is None:
            return []

        rows: list[str] = []
        with self.fixture_path.open("r", encoding="utf-8") as handle:
            for raw in handle:
                line = raw.strip()
                if line and not line.startswith("#"):
                    rows.append(line)

        return rows

    def lines(self) -> Iterator[str]:
        for item in self.scripted_items:
            if not self.running:
                return

            if isinstance(item, DisconnectSignal):
                # Simulate a brief disconnect/reconnect cycle.
                self.is_open = False
                self.reconnect_count += 1
                self.is_open = True
                continue

            yield item

        for line in self._fixture_lines():
            if not self.running:
                return
            yield line

        # Simulated read timeout with no incoming bytes.
        if self.timeout_seconds >= 0:
            return