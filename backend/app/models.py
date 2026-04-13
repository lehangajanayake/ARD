from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, Field


class TelemetryPacket(BaseModel):
    time: int = Field(ge=0)
    altitude: float
    bmpTemp: float
    imuTemp: float
    pressure: float
    accX: float
    accY: float
    accZ: float
    angVelX: float
    angVelY: float
    angVelZ: float


class DerivedTelemetry(BaseModel):
    velocity: float
    downrange_m: float
    east_m: float
    north_m: float
    latitude: float
    longitude: float
    azimuth_deg: float


class TelemetryEnvelope(BaseModel):
    type: Literal["telemetry"] = "telemetry"
    timestamp: int
    packet: TelemetryPacket
    derived: DerivedTelemetry


@dataclass(frozen=True)
class FlightSample:
    time_ms: int
    altitude_m: float
    bmp_temp_c: float
    imu_temp_c: float
    pressure_pa: float
    acc_x: float
    acc_y: float
    acc_z: float
    ang_vel_x: float
    ang_vel_y: float
    ang_vel_z: float
