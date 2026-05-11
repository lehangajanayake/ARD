import type { TelemetrySample } from "../types/telemetry";

function csvEscape(value: string | number | null | undefined) {
  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

export function telemetrySamplesToCsv(samples: TelemetrySample[]) {
  const header = [
    "timestamp",
    "time_ms",
    "altitude_m",
    "velocity_m_s",
    "latitude_deg",
    "longitude_deg",
    "azimuth_deg",
    "pressure_pa",
    "bmp_temp_c",
    "imu_temp_c",
    "acc_x",
    "acc_y",
    "acc_z",
    "ang_vel_x",
    "ang_vel_y",
    "ang_vel_z",
  ];

  const rows = samples.map((sample) => [
    sample.timestamp,
    sample.packet.time,
    sample.packet.altitude,
    sample.derived.velocity,
    sample.derived.latitude,
    sample.derived.longitude,
    sample.derived.azimuth_deg,
    sample.packet.pressure,
    sample.packet.bmpTemp,
    sample.packet.imuTemp,
    sample.packet.accX,
    sample.packet.accY,
    sample.packet.accZ,
    sample.packet.angVelX,
    sample.packet.angVelY,
    sample.packet.angVelZ,
  ]);

  return [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
}
