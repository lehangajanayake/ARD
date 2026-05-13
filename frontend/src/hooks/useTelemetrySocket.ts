import { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { dashboardActions } from "../store/useDashboardStore";
import { normalizeTelemetryMessage } from "../lib/telemetry";

const SOCKET_URL = import.meta.env.VITE_TELEMETRY_WS_URL ?? "http://127.0.0.1:5000";

export function useTelemetrySocket() {
  const retryRef = useRef(0);

  useEffect(() => {
    let active = true;
    let socket: Socket | null = null;
    let reconnectTimer: number | null = null;

    const connect = () => {
      if (!active) {
        return;
      }

      dashboardActions.setConnectionState("connecting");
      socket = io(SOCKET_URL, {
        reconnection: true,
        reconnectionDelay: 500,
        reconnectionDelayMax: 10_000,
        reconnectionAttempts: Infinity,
        transports: ["polling"],
      });

      socket.on("connect", () => {
        retryRef.current = 0;
        dashboardActions.setConnectionState("connected");
        console.log("✓ Socket.IO connected");
      });

      socket.on("telemetry_data", (data) => {
        try {
          const telemetry = normalizeTelemetryMessage(data);
          if (telemetry) {
            console.log("✓ Telemetry received:", telemetry.packet.time, "ms, alt:", telemetry.packet.altitude, "m, vel:", telemetry.derived.velocity, "m/s");
            dashboardActions.pushTelemetry(telemetry);
          } else {
            console.warn("✗ Failed to normalize telemetry:", data);
          }
        } catch (err) {
          console.error("✗ Telemetry parse error:", err);
          dashboardActions.setConnectionState("error");
        }
      });

      socket.on("connect_error", (error) => {
        console.error("✗ Connection error:", error);
        dashboardActions.setConnectionState("error");
      });

      socket.on("disconnect", () => {
        if (!active) {
          return;
        }

        dashboardActions.setConnectionState("disconnected");
        console.log("✗ Socket.IO disconnected");
      });
    };

    connect();

    return () => {
      active = false;
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
      socket?.disconnect();
    };
  }, []);
}
