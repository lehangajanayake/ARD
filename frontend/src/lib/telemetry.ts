import type { TelemetrySample } from "../types/telemetry";

export function normalizeTelemetryMessage(raw: unknown): TelemetrySample | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const candidate = raw as Partial<TelemetrySample>;
  if (candidate.type !== "telemetry") {
    return null;
  }

  if (!candidate.packet || !candidate.derived) {
    return null;
  }

  return candidate as TelemetrySample;
}
