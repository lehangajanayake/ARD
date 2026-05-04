import struct
from typing import Optional
from .telemetry_schema import TelemetryFrame, DATA_COLUMNS

# Current uploaded Python code used:
# '<Iffffffffff' = uint32 time + 10 floats
BINARY_PACKET_FORMAT = "<Iffffffffff"
BINARY_PACKET_SIZE = struct.calcsize(BINARY_PACKET_FORMAT)


class PacketParser:
    """
    Converts raw serial lines or binary packets into TelemetryFrame objects.

    Keep this separate from Flask and Socket.IO so you can test it without the dashboard.
    """

    def parse_csv_line(self, line: str) -> Optional[TelemetryFrame]:
        line = line.strip()

        # Ignore debug lines from Arduino like "Data received" or "LoRa Radio Ready".
        if not line or "," not in line:
            return None

        parts = [p.strip() for p in line.split(",")]

        if len(parts) < len(DATA_COLUMNS):
            return None

        try:
            values = [float(parts[i]) for i in range(len(DATA_COLUMNS))]

            frame = TelemetryFrame(
                time=values[0],
                bmpTemp=values[1],
                imuTemp=values[2],
                pressure=values[3],
                altitude=values[4],
                accX=values[5],
                accY=values[6],
                accZ=values[7],
                angVelX=values[8],
                angVelY=values[9],
                angVelZ=values[10],
            )

            # Optional fields for interference work.
            if len(parts) > 11 and parts[11] != "":
                frame.rssi = float(parts[11])
            if len(parts) > 12 and parts[12] != "":
                frame.snr = float(parts[12])
            if len(parts) > 13 and parts[13] != "":
                frame.packet_id = int(float(parts[13]))

            return frame

        except ValueError:
            return None

    def parse_binary_packet(self, raw: bytes) -> Optional[TelemetryFrame]:
        if len(raw) != BINARY_PACKET_SIZE:
            return None

        try:
            data = struct.unpack(BINARY_PACKET_FORMAT, raw)
            return TelemetryFrame(
                time=float(data[0]),
                bmpTemp=float(data[1]),
                imuTemp=float(data[2]),
                pressure=float(data[3]),
                altitude=float(data[4]),
                accX=float(data[5]),
                accY=float(data[6]),
                accZ=float(data[7]),
                angVelX=float(data[8]),
                angVelY=float(data[9]),
                angVelZ=float(data[10]),
            )
        except struct.error:
            return None
