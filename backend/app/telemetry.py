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


G_MPS2 = 9.80665
T0_K = 288.15
P0_PA = 101_325.0
LAPSE_K_PER_M = 0.0065


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _hermite_segment(t: float, t0: float, t1: float, h0: float, h1: float, v0: float, v1: float) -> tuple[float, float]:
    if t1 <= t0:
        return h1, v1

    u = _clamp((t - t0) / (t1 - t0), 0.0, 1.0)
    dt = t1 - t0

    h00 = 2 * u * u * u - 3 * u * u + 1
    h10 = u * u * u - 2 * u * u + u
    h01 = -2 * u * u * u + 3 * u * u
    h11 = u * u * u - u * u
    altitude = h00 * h0 + h10 * dt * v0 + h01 * h1 + h11 * dt * v1

    dh00 = 6 * u * u - 6 * u
    dh10 = 3 * u * u - 4 * u + 1
    dh01 = -6 * u * u + 6 * u
    dh11 = 3 * u * u - 2 * u
    velocity = (dh00 * h0 + dh10 * dt * v0 + dh01 * h1 + dh11 * dt * v1) / dt
    return max(0.0, altitude), velocity


def _flight_profile(phase_s: float) -> tuple[float, float, float]:
    # Time, altitude, and velocity anchors tuned to hobby high-power profile (~11k ft apogee).
    if phase_s <= 0.8:
        altitude = 0.0
        velocity = 0.0
    elif phase_s <= 6.3:
        altitude, velocity = _hermite_segment(phase_s, 0.8, 6.3, 0.0, 620.0, 0.0, 235.0)
    elif phase_s <= 28.0:
        altitude, velocity = _hermite_segment(phase_s, 6.3, 28.0, 620.0, 3320.0, 235.0, 0.0)
    elif phase_s <= 42.0:
        altitude, velocity = _hermite_segment(phase_s, 28.0, 42.0, 3320.0, 2300.0, 0.0, -45.0)
    elif phase_s <= 78.0:
        altitude, velocity = _hermite_segment(phase_s, 42.0, 78.0, 2300.0, 0.0, -45.0, -6.0)
    else:
        altitude = 0.0
        velocity = 0.0

    if phase_s <= 0.8:
        accel = 0.0
    elif phase_s <= 6.3:
        accel = 32.0 - 1.8 * (phase_s - 0.8)
    elif phase_s <= 28.0:
        accel = -10.5 - 0.6 * math.sin(phase_s / 3.8)
    elif phase_s <= 42.0:
        accel = -6.5 + 1.3 * math.sin(phase_s / 2.4)
    elif phase_s <= 78.0:
        accel = -0.5 + 0.7 * math.sin(phase_s / 4.5)
    else:
        accel = 0.0

    return altitude, velocity, accel


def _pressure_from_altitude(altitude_m: float) -> float:
    temp_ratio = 1.0 - (LAPSE_K_PER_M * altitude_m) / T0_K
    temp_ratio = max(0.15, temp_ratio)
    return P0_PA * (temp_ratio ** 5.25588)


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
    altitude, velocity, accel = _flight_profile(phase)

    # Determine flight phase for debugging
    if phase <= 0.8:
        phase_name = "PAD"
    elif phase <= 6.3:
        phase_name = "BOOST"
    elif phase <= 28.0:
        phase_name = "COAST"
    elif phase <= 42.0:
        phase_name = "APOGEE"
    elif phase <= 78.0:
        phase_name = "DESCENT"
    else:
        phase_name = "LANDED"

    # Ballistic drift and wind-dependent horizontal travel (only while in flight).
    if phase <= 78.0:
        if phase <= 28.0:
            downrange = 16.0 * phase + 0.55 * phase * phase
        else:
            downrange = 16.0 * 28.0 + 0.55 * 28.0 * 28.0 + 3.2 * (phase - 28.0)

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
    else:
        downrange = 16.0 * 28.0 + 0.55 * 28.0 * 28.0 + 3.2 * (78.0 - 28.0)

    east = 0.55 * downrange + _drift_east_m
    north = 0.25 * downrange + 3.0 * math.sin(phase / 4.0) + _drift_north_m
    latitude = 35.0 + north / 111_111.0
    longitude = -117.0 + east / (111_111.0 * math.cos(math.radians(35.0)))
    azimuth = (math.degrees(math.atan2(east, max(north, 0.001))) + 360.0) % 360.0

    pressure = _pressure_from_altitude(altitude)
    ambient_temp = 22.0 - 0.0062 * altitude
    bmp_temp = ambient_temp + 0.4 * math.sin(phase / 9.0) + _rng.gauss(0.0, 0.18)

    # IMU runs warmer than ambient and cools with altitude/wind.
    imu_temp_target = 31.0 - 0.0014 * altitude + 0.6 * math.cos(phase / 16.0)
    imu_temp = imu_temp_target + _rng.gauss(0.0, 0.25)

    # Simulated body-frame vibration profile: strong during boost, calmer under chute.
    boost_factor = 1.0 if 0.8 < phase < 6.3 else 0.0
    acc_x = 0.12 * math.sin(phase * 7.0) + 0.25 * boost_factor * math.sin(phase * 18.0) + _rng.gauss(0.0, 0.04)
    acc_y = 0.10 * math.cos(phase * 6.4) + 0.2 * boost_factor * math.cos(phase * 16.0) + _rng.gauss(0.0, 0.04)
    acc_z = _clamp(G_MPS2 + accel + _rng.gauss(0.0, 0.35), 0.0, 60.0)

    spin_base = 0.7 if 0.8 < phase < 6.3 else 0.18
    ang_vel_x = spin_base * math.sin(phase * 1.6) + _rng.gauss(0.0, 0.03)
    ang_vel_y = 0.8 * spin_base * math.cos(phase * 1.2) + _rng.gauss(0.0, 0.03)
    ang_vel_z = 1.4 * spin_base * math.sin(phase * 0.9) + _rng.gauss(0.0, 0.04)

    packet = TelemetryPacket(
        time=elapsed_ms,
        altitude=altitude,
        bmpTemp=bmp_temp,
        imuTemp=imu_temp,
        pressure=pressure,
        accX=acc_x,
        accY=acc_y,
        accZ=acc_z,
        angVelX=ang_vel_x,
        angVelY=ang_vel_y,
        angVelZ=ang_vel_z,
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
