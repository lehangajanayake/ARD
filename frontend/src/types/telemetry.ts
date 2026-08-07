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

export type TelemetryStatus = {
  type: "telemetry_status";
  timestamp_ms: number;
  mode: "simulation" | "serial";
  stream: "idle" | "starting" | "running" | "waiting_data" | "error";
  serial_port: string | null;
  serial_connected: boolean;
  last_packet_at_ms: number | null;
  last_packet_age_ms: number | null;
  last_error: string | null;
  last_error_at_ms: number | null;
  note: string | null;
  stats: {
    total_frames: number;
    parse_failures: number;
    dropout_count: number;
    duplicate_count: number;
    missing_packets: number;
    packet_loss_percent: number;
  };
};
