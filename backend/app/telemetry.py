from __future__ import annotations

import math
import random
import time

from .models import DerivedTelemetry, TelemetryEnvelope, TelemetryPacket


_rng = random.Random()
_last_elapsed_ms = 0
_wind_east_mps = 0.0
_wind_north_mps = 0.0
_drift_east_m = 0.0
_drift_north_m = 0.0


def build_sample(elapsed_ms: int) -> TelemetryEnvelope:
    global _last_elapsed_ms, _wind_east_mps, _wind_north_mps, _drift_east_m, _drift_north_m

    if elapsed_ms < _last_elapsed_ms:
        _wind_east_mps = 0.0
        _wind_north_mps = 0.0
        _drift_east_m = 0.0
        _drift_north_m = 0.0

    dt = 0.1
    if _last_elapsed_ms > 0:
        dt = max(0.05, min(0.25, (elapsed_ms - _last_elapsed_ms) / 1000.0))
    _last_elapsed_ms = elapsed_ms

    phase = elapsed_ms / 1000.0
    altitude = max(0.0, 1.2 * phase * phase - 0.4 * phase)
    velocity = max(0.0, 2.4 * phase - 0.4)
    downrange = 18.0 * phase

    # Simulate smooth turbulence and wind gusts instead of frame-to-frame jitter.
    gust_east = _rng.gauss(0.0, 1.3)
    gust_north = _rng.gauss(0.0, 1.0)
    _wind_east_mps = 0.92 * _wind_east_mps + 0.08 * gust_east
    _wind_north_mps = 0.94 * _wind_north_mps + 0.06 * gust_north

    # Crosswind effect increases with altitude and naturally meanders.
    altitude_factor = min(1.0, altitude / 3000.0)
    meander_east = 1.4 * math.sin(phase / 6.5)
    meander_north = 1.0 * math.sin(phase / 8.0 + 0.7)
    _drift_east_m += (_wind_east_mps * (0.4 + 0.8 * altitude_factor) + meander_east) * dt
    _drift_north_m += (_wind_north_mps * (0.3 + 0.6 * altitude_factor) + meander_north) * dt

    east = 0.55 * downrange + _drift_east_m
    north = 0.25 * downrange + 3.0 * math.sin(phase / 4.0) + _drift_north_m
    latitude = 35.0 + north / 111_111.0
    longitude = -117.0 + east / (111_111.0 * math.cos(math.radians(35.0)))
    azimuth = (math.degrees(math.atan2(east, max(north, 0.001))) + 360.0) % 360.0

    packet = TelemetryPacket(
        time=elapsed_ms,
        altitude=altitude,
        bmpTemp=21.5 + 1.2 * math.sin(phase / 7.0),
        imuTemp=24.0 + 0.7 * math.cos(phase / 6.0),
        pressure=max(5_000.0, 101_325.0 - altitude * 12.0),
        accX=0.08 * math.sin(phase * 3.0),
        accY=0.09 * math.cos(phase * 2.4),
        accZ=9.81 + 0.2 * math.sin(phase * 1.7),
        angVelX=0.05 * math.sin(phase * 2.2),
        angVelY=0.06 * math.cos(phase * 1.4),
        angVelZ=0.12 * math.sin(phase * 1.1),
    )
    derived = DerivedTelemetry(
        velocity=velocity,
        downrange_m=downrange,
        east_m=east,
        north_m=north,
        latitude=latitude,
        longitude=longitude,
        azimuth_deg=azimuth,
    )
    return TelemetryEnvelope(timestamp=int(time.time() * 1000), packet=packet, derived=derived)


def sample_to_dict(sample: TelemetryEnvelope) -> dict:
    return sample.model_dump(mode="json")
