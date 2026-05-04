import { useEffect, useRef } from "react";
import { dashboardActions, useDashboardStore } from "../store/useDashboardStore";
import { normalizeTelemetryMessage } from "../lib/telemetry";
import type { TelemetrySample } from "../types/telemetry";

const SOCKET_URL = import.meta.env.VITE_TELEMETRY_WS_URL ?? "ws://localhost:8000/ws/telemetry";

function createDemoSample(index: number, startTimeMs: number): TelemetrySample {
  const elapsedSeconds = (index * 250) / 1000;
  const launchPhase = Math.min(elapsedSeconds / 14, 1);
  const coastPhase = Math.min(Math.max((elapsedSeconds - 14) / 34, 0), 1);
  const descentPhase = Math.min(Math.max((elapsedSeconds - 48) / 28, 0), 1);

  const ascentAltitude = 3200 * (1 - Math.cos(Math.PI * launchPhase)) / 2;
  const descentAltitude = 3200 * (1 - descentPhase);
  const altitude = elapsedSeconds < 14 ? ascentAltitude : elapsedSeconds < 48 ? 3200 - 250 * coastPhase : Math.max(0, descentAltitude);

  const downrange = elapsedSeconds * 42 + Math.sin(elapsedSeconds / 5) * 16;
  const east = downrange * 0.65;
  const north = downrange * 0.28;
  const latitude = 35 + north / 111_000;
  const longitude = -117 + east / (111_000 * Math.cos((35 * Math.PI) / 180));
  const velocity = elapsedSeconds < 14 ? 460 * launchPhase : elapsedSeconds < 48 ? 18 + 12 * coastPhase : Math.max(0, 125 - 90 * descentPhase);
  const azimuth = 67 + Math.sin(elapsedSeconds / 6) * 12;

  return {
    type: "telemetry",
    timestamp: startTimeMs + index * 250,
    packet: {
      time: index * 250,
      altitude,
      bmpTemp: 21.5 + Math.sin(elapsedSeconds / 9) * 3,
      imuTemp: 24.2 + Math.sin(elapsedSeconds / 6) * 2,
      pressure: Math.max(28_000, 101_325 * Math.exp(-altitude / 8_400)),
      accX: 0.35 + Math.sin(elapsedSeconds * 1.3) * 0.8,
      accY: 0.18 + Math.cos(elapsedSeconds * 0.8) * 0.45,
      accZ: 9.81 + Math.sin(elapsedSeconds * 0.5) * 0.6,
      angVelX: Math.sin(elapsedSeconds * 0.75) * 8,
      angVelY: Math.cos(elapsedSeconds * 0.55) * 7,
      angVelZ: Math.sin(elapsedSeconds * 0.35) * 12,
    },
    derived: {
      velocity,
      downrange_m: downrange,
      east_m: east,
      north_m: north,
      latitude,
      longitude,
      azimuth_deg: azimuth,
    },
  };
}

export function useTelemetryFeed() {
  const telemetrySource = useDashboardStore((state) => state.telemetrySource);
  const retryRef = useRef(0);

  useEffect(() => {
    let active = true;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let demoTimer: number | null = null;
    let demoIndex = 0;
    const demoStartTime = Date.now();

    if (telemetrySource === "demo") {
      dashboardActions.setConnectionState("demo");
      demoTimer = window.setInterval(() => {
        if (!active) {
          return;
        }

        const sample = createDemoSample(demoIndex, demoStartTime);
        demoIndex += 1;
        dashboardActions.pushTelemetry(sample);
      }, 250);

      // push the first sample immediately so the screen is never empty
      dashboardActions.pushTelemetry(createDemoSample(demoIndex, demoStartTime));
      demoIndex += 1;

      return () => {
        active = false;
        if (demoTimer) {
          window.clearInterval(demoTimer);
        }
      };
    }

    const connect = () => {
      if (!active) {
        return;
      }

      dashboardActions.setConnectionState("connecting");
      socket = new WebSocket(SOCKET_URL);

      socket.onopen = () => {
        retryRef.current = 0;
        dashboardActions.setConnectionState("connected");
      };

      socket.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data as string);
          const telemetry = normalizeTelemetryMessage(parsed);
          if (telemetry) {
            dashboardActions.pushTelemetry(telemetry);
          } else {
            console.warn("✗ Failed to normalize telemetry:", parsed);
          }
        } catch (err) {
          console.error("✗ Telemetry parse error:", err);
          dashboardActions.setConnectionState("error");
        }
      };

      socket.onerror = () => {
        dashboardActions.setConnectionState("error");
      };

      socket.onclose = () => {
        if (!active) {
          return;
        }

        dashboardActions.setConnectionState("disconnected");
        retryRef.current += 1;
        const delay = Math.min(10_000, 500 * 2 ** retryRef.current);
        reconnectTimer = window.setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      active = false;
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
      socket?.close();
    };
  }, [telemetrySource]);
}
