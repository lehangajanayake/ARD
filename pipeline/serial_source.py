import glob
import sys
import time
import serial
from typing import Iterator, Optional


class SerialSource:
    """
    Owns the serial port only.

    It does not parse telemetry and does not know about Flask.
    """

    def __init__(self, port_name: Optional[str] = None, baudrate: int = 115200, timeout: float = 0.1):
        self.port_name = port_name
        self.baudrate = baudrate
        self.timeout = timeout
        self.ser: Optional[serial.Serial] = None
        self.running = False

    def set_port(self, port_name: str) -> None:
        self.port_name = port_name

    def open(self) -> None:
        if not self.port_name:
            raise RuntimeError("No serial port selected")

        self.ser = serial.Serial(self.port_name, self.baudrate, timeout=self.timeout)
        self.running = True

    def close(self) -> None:
        self.running = False
        if self.ser and self.ser.is_open:
            self.ser.close()

    def lines(self) -> Iterator[str]:
        while self.running:
            if not self.ser or not self.ser.is_open:
                time.sleep(0.05)
                continue

            raw = self.ser.readline()
            if not raw:
                continue

            yield raw.decode("utf-8", errors="replace").strip()

    def list_ports(self):
        if sys.platform.startswith("win"):
            candidates = [f"COM{i + 1}" for i in range(256)]
        elif sys.platform.startswith("linux") or sys.platform.startswith("cygwin"):
            candidates = glob.glob("/dev/tty[A-Za-z]*")
        elif sys.platform.startswith("darwin"):
            candidates = glob.glob("/dev/tty.*") + glob.glob("/dev/cu.*")
        else:
            raise EnvironmentError("Unsupported platform")

        available = []
        for port in candidates:
            try:
                s = serial.Serial(port)
                s.close()
                available.append(port)
            except (OSError, serial.SerialException):
                pass

        return sorted(set(available))
