#!/usr/bin/env python3
"""
Generate a test CSV that fuses the BlueRaven high-rate and low-rate telemetry.

The script keeps the low-rate telemetry rows as the output spine, integrates the
high-rate acceleration in the intermediate steps, and converts the resulting
local north/east displacement into latitude/longitude from a user-provided
starting coordinate.
"""

from __future__ import annotations

import argparse
import csv
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Sequence, Tuple


START_LAT = -30.670535341898105
START_LON = 143.18988386875418
EARTH_RADIUS_M = 6_378_137.0
BASELINE_WINDOW_SECONDS = 1.0
VELOCITY_BLEND = 0.25


@dataclass
class Sample:
    time_s: float
    row: Dict[str, str]
    accel_x: float
    accel_y: float
    accel_z: float


@dataclass
class VelocitySample:
    time_s: float
    row: Dict[str, str]
    vel_up: float
    vel_dr: float
    vel_cr: float


def parse_float(row: Dict[str, str], key: str, default: float = 0.0) -> float:
    value = row.get(key, "")
    if value is None or value == "":
        return default
    return float(value)


def load_high_rate(path: Path) -> List[Sample]:
    with path.open(newline="") as handle:
        reader = csv.DictReader(handle)
        samples: List[Sample] = []
        for row in reader:
            samples.append(
                Sample(
                    time_s=parse_float(row, "Flight_Time_(s)"),
                    row=row,
                    accel_x=parse_float(row, "Accel_X"),
                    accel_y=parse_float(row, "Accel_Y"),
                    accel_z=parse_float(row, "Accel_Z"),
                )
            )
    samples.sort(key=lambda sample: sample.time_s)
    return samples


def load_low_rate(path: Path) -> List[VelocitySample]:
    with path.open(newline="") as handle:
        reader = csv.DictReader(handle)
        samples: List[VelocitySample] = []
        for row in reader:
            samples.append(
                VelocitySample(
                    time_s=parse_float(row, "Flight_Time_(s)"),
                    row=row,
                    vel_up=parse_float(row, "Velocity_Up"),
                    vel_dr=parse_float(row, "Velocity_DR"),
                    vel_cr=parse_float(row, "Velocity_CR"),
                )
            )
    samples.sort(key=lambda sample: sample.time_s)
    return samples


def linear_interpolate(left: float, right: float, fraction: float) -> float:
    return left + (right - left) * fraction


def interpolate_sample(samples: Sequence[Sample], target_time: float) -> Tuple[float, float, float]:
    if target_time <= samples[0].time_s:
        return samples[0].accel_x, samples[0].accel_y, samples[0].accel_z
    if target_time >= samples[-1].time_s:
        return samples[-1].accel_x, samples[-1].accel_y, samples[-1].accel_z

    left = 0
    right = len(samples) - 1
    while left + 1 < right:
        mid = (left + right) // 2
        if samples[mid].time_s <= target_time:
            left = mid
        else:
            right = mid

    start = samples[left]
    end = samples[right]
    span = end.time_s - start.time_s
    if span <= 0:
        return start.accel_x, start.accel_y, start.accel_z

    fraction = (target_time - start.time_s) / span
    return (
        linear_interpolate(start.accel_x, end.accel_x, fraction),
        linear_interpolate(start.accel_y, end.accel_y, fraction),
        linear_interpolate(start.accel_z, end.accel_z, fraction),
    )


def mean_baseline(samples: Sequence[Sample], window_seconds: float) -> Tuple[float, float, float]:
    start_time = samples[0].time_s
    window = [sample for sample in samples if sample.time_s <= start_time + window_seconds]
    if not window:
        window = list(samples[: max(1, len(samples) // 100)])

    return (
        sum(sample.accel_x for sample in window) / len(window),
        sum(sample.accel_y for sample in window) / len(window),
        sum(sample.accel_z for sample in window) / len(window),
    )


def feet_to_meters(feet: float) -> float:
    return feet * 0.3048


def meters_to_lat_delta(meters: float) -> float:
    return math.degrees(meters / EARTH_RADIUS_M)


def meters_to_lon_delta(meters: float, latitude_deg: float) -> float:
    return math.degrees(meters / (EARTH_RADIUS_M * max(1e-9, math.cos(math.radians(latitude_deg)))))


def generate_rows(high_rate: Sequence[Sample], low_rate: Sequence[VelocitySample]) -> List[Dict[str, str]]:
    baseline_x, baseline_y, baseline_z = mean_baseline(high_rate, BASELINE_WINDOW_SECONDS)

    output_rows: List[Dict[str, str]] = []
    north_m = 0.0
    east_m = 0.0
    up_m = 0.0

    velocity_n = low_rate[0].vel_dr
    velocity_e = low_rate[0].vel_cr
    velocity_u = low_rate[0].vel_up

    start_alt_m = feet_to_meters(parse_float(low_rate[0].row, "Baro_Altitude_ASL_(feet)", 0.0))
    previous_time = low_rate[0].time_s

    high_index = 0
    for low_index, current in enumerate(low_rate):
        current_time = current.time_s
        current_linear_acc = interpolate_sample(high_rate, current_time)

        if low_index > 0:
            while high_index < len(high_rate) and high_rate[high_index].time_s < previous_time:
                high_index += 1

            step_index = high_index
            current_step_time = previous_time
            while step_index < len(high_rate) and high_rate[step_index].time_s <= current_time:
                step_time = high_rate[step_index].time_s
                dt = step_time - current_step_time
                if dt > 0:
                    linear_acc_x = high_rate[step_index].accel_x - baseline_x
                    linear_acc_y = high_rate[step_index].accel_y - baseline_y
                    linear_acc_z = high_rate[step_index].accel_z - baseline_z

                    velocity_u += linear_acc_x * dt
                    velocity_n += linear_acc_y * dt
                    velocity_e += linear_acc_z * dt

                    north_m += velocity_n * dt
                    east_m += velocity_e * dt
                    up_m += velocity_u * dt

                current_step_time = step_time
                step_index += 1

            high_index = step_index

            measured_n = current.vel_dr
            measured_e = current.vel_cr
            measured_u = current.vel_up

            velocity_n = (1.0 - VELOCITY_BLEND) * velocity_n + VELOCITY_BLEND * measured_n
            velocity_e = (1.0 - VELOCITY_BLEND) * velocity_e + VELOCITY_BLEND * measured_e
            velocity_u = (1.0 - VELOCITY_BLEND) * velocity_u + VELOCITY_BLEND * measured_u

        derived_lat = START_LAT + meters_to_lat_delta(north_m)
        derived_lon = START_LON + meters_to_lon_delta(east_m, derived_lat)
        current_alt_m = feet_to_meters(parse_float(current.row, "Baro_Altitude_ASL_(feet)", 0.0))
        derived_alt_m = current_alt_m if current_alt_m > 0 else start_alt_m + up_m

        output_row = dict(current.row)
        output_row.update(
            {
                "derived_north_m": f"{north_m:.3f}",
                "derived_east_m": f"{east_m:.3f}",
                "derived_up_m": f"{up_m:.3f}",
                "derived_latitude": f"{derived_lat:.9f}",
                "derived_longitude": f"{derived_lon:.9f}",
                "derived_altitude_m": f"{derived_alt_m:.3f}",
                "derived_velocity_north_mps": f"{velocity_n:.3f}",
                "derived_velocity_east_mps": f"{velocity_e:.3f}",
                "derived_velocity_up_mps": f"{velocity_u:.3f}",
                "derived_speed_mps": f"{math.sqrt(velocity_n ** 2 + velocity_e ** 2 + velocity_u ** 2):.3f}",
                "derived_linear_accel_x_mps2": f"{(current_linear_acc[0] - baseline_x):.3f}",
                "derived_linear_accel_y_mps2": f"{(current_linear_acc[1] - baseline_y):.3f}",
                "derived_linear_accel_z_mps2": f"{(current_linear_acc[2] - baseline_z):.3f}",
            }
        )
        output_rows.append(output_row)
        previous_time = current_time

    return output_rows


def write_csv(path: Path, rows: Iterable[Dict[str, str]]) -> None:
    rows = list(rows)
    if not rows:
        raise ValueError("No rows were generated")

    fieldnames = list(rows[0].keys())
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate derived BlueRaven test data from the bundled CSVs.")
    parser.add_argument(
        "--high-rate",
        type=Path,
        default=Path("backend/TestData/Level 3 High Rate BlueRaven (4).csv"),
        help="Path to the high-rate BlueRaven CSV.",
    )
    parser.add_argument(
        "--low-rate",
        type=Path,
        default=Path("backend/TestData/Level 3 Low Rate BlueRaven (3).csv"),
        help="Path to the low-rate BlueRaven CSV.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("backend/TestData/generated_blue_raven_test_data.csv"),
        help="Output path for the generated test CSV.",
    )
    args = parser.parse_args()

    high_rate = load_high_rate(args.high_rate)
    low_rate = load_low_rate(args.low_rate)
    rows = generate_rows(high_rate, low_rate)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    write_csv(args.output, rows)
    print(f"Wrote {len(rows)} rows to {args.output}")


if __name__ == "__main__":
    main()