import time
import random
from pipeline.telemetry_pipeline import TelemetryPipeline
from pipeline.recorder import TelemetryRecorder


def make_line(i: int) -> str:
    t = i * 100
    altitude = max(0, 0.5 * i + random.uniform(-0.5, 0.5))
    pressure = 101325 - altitude * 12 + random.uniform(-20, 20)

    # Simulate interference around packet 80-90.
    rssi = -90
    snr = 8
    packet_id = i
    if 80 <= i <= 90:
        rssi = -120
        snr = -2

    return ",".join(map(str, [
        t, 24.0, 29.5, pressure, altitude,
        random.uniform(-0.2, 0.2),
        random.uniform(-0.2, 0.2),
        9.81 + random.uniform(-0.2, 0.2),
        random.uniform(-0.05, 0.05),
        random.uniform(-0.05, 0.05),
        random.uniform(-0.05, 0.05),
        rssi, snr, packet_id
    ]))


if __name__ == "__main__":
    pipeline = TelemetryPipeline(recorder=TelemetryRecorder("sim_flight_log.csv"))

    for i in range(120):
        line = make_line(i)

        # Simulate lost packets.
        if i in [30, 31, 32, 88]:
            continue

        row = pipeline.process_line(line)
        if row:
            print(row["time"], row["altitude"], row["quality_status"], row["warnings"])

        time.sleep(0.02)

    print("Stats:", pipeline.stats())
