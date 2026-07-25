import { useEffect, useRef } from "react";
import { dashboardActions } from "../store/useDashboardStore";
import { normalizeTelemetryMessage } from "../lib/telemetry";
import { io, Socket } from "socket.io-client";
import type { TelemetryStatus } from "../types/telemetry";

const SOCKET_URL = import.meta.env.VITE_TELEMETRY_WS_URL ?? "http://127.0.0.1:5000";
const MAP_READY_EVENT = "ard:map-ready";
const MAP_READY_TIMEOUT_MS = 10_000;

async function restartSimulation(reason: string) {
  try {
    const response = await fetch(`${SOCKET_URL}/telemetry/restart`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    console.log(`↻ Simulation restarted (${reason})`, payload);
  } catch (error) {
    console.error(`✗ Failed to restart simulation (${reason})`, error);
  }
}

type UseTelemetryFeedOptions = {
  waitForMapReady?: boolean;
};

export function useTelemetryFeed(options: UseTelemetryFeedOptions = {}) {
  const { waitForMapReady = false } = options;
  const retryRef = useRef(0);

  useEffect(() => {
    let active = true;
    let socket: Socket | null = null;
    let cleanupKeyListener: (() => void) | null = null;
    let mapReadyTimer: number | null = null;

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
        console.log("✓ Socket.IO connected to telemetry backend");
        socket?.emit("request_telemetry");
      });

      socket.on("telemetry_data", (data) => {
        try {
          const telemetry = normalizeTelemetryMessage(data);
          if (telemetry) {
            dashboardActions.pushTelemetry(telemetry);
          } else {
            console.warn("✗ Failed to normalize telemetry:", data);
          }
        } catch (err) {
          console.error("✗ Telemetry parse error:", err);
          dashboardActions.setConnectionState("error");
        }
      });

      socket.on("telemetry_status", (data: TelemetryStatus) => {
        dashboardActions.setBackendStatus(data);
        if (data.stream === "error") {
          dashboardActions.setConnectionState("error");
        }
      });

      socket.on("connect_error", () => {
        dashboardActions.setConnectionState("error");
      });

      socket.on("disconnect", () => {
        if (!active) {
          return;
        }

        dashboardActions.setConnectionState("disconnected");
        console.log("✗ Socket.IO disconnected from telemetry backend");
      });

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.repeat) {
          return;
        }

        if (event.key.toLowerCase() === "r") {
          void restartSimulation("keyboard R");
        }
      };

      window.addEventListener("keydown", handleKeyDown);
      cleanupKeyListener = () => window.removeEventListener("keydown", handleKeyDown);

      void restartSimulation("page load");
    };

    const startConnection = () => {
      if (!active) {
        return;
      }
      connect();
    };

    if (waitForMapReady) {
      if ((window as any).__ardMapReady) {
        startConnection();
      } else {
        const handleMapReady = () => {
          window.removeEventListener(MAP_READY_EVENT, handleMapReady);
          if (mapReadyTimer !== null) {
            window.clearTimeout(mapReadyTimer);
            mapReadyTimer = null;
          }
          startConnection();
        };

        window.addEventListener(MAP_READY_EVENT, handleMapReady, { once: true });

        // Fallback so telemetry still works if map never reaches ready state.
        mapReadyTimer = window.setTimeout(() => {
          window.removeEventListener(MAP_READY_EVENT, handleMapReady);
          console.warn("Map readiness timeout reached, connecting telemetry anyway");
          startConnection();
        }, MAP_READY_TIMEOUT_MS);
      }
    } else {
      startConnection();
    }

    return () => {
      active = false;
      if (mapReadyTimer !== null) {
        window.clearTimeout(mapReadyTimer);
      }
      cleanupKeyListener?.();
      socket?.disconnect();
    };
  }, [waitForMapReady]);
}
