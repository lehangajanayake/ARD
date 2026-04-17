import { useEffect, useRef } from "react";
import { dashboardActions } from "../store/useDashboardStore";
import { normalizeTelemetryMessage } from "../lib/telemetry";

const SOCKET_URL = import.meta.env.VITE_TELEMETRY_WS_URL ?? "ws://localhost:8000/ws/telemetry";

export function useTelemetrySocket() {
  const retryRef = useRef(0);

  useEffect(() => {
    let active = true;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;

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
            console.log("✓ Telemetry received:", telemetry.packet.time, "ms, alt:", telemetry.packet.altitude, "m, vel:", telemetry.derived.velocity, "m/s");
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
  }, []);
}
