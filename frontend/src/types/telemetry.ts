export type TelemetryPacket = {
  time: number;
  altitude: number;
  bmpTemp: number;
  imuTemp: number;
  pressure: number;
  accX: number;
  accY: number;
  accZ: number;
  angVelX: number;
  angVelY: number;
  angVelZ: number;
};

export type DerivedTelemetry = {
  velocity: number;
  downrange_m: number;
  east_m: number;
  north_m: number;
  latitude: number;
  longitude: number;
  azimuth_deg: number;
};

export type TelemetryEnvelope = {
  type: "telemetry";
  timestamp: number;
  packet: TelemetryPacket;
  derived: DerivedTelemetry;
};

export type TelemetrySample = TelemetryEnvelope;
