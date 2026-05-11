import { useEffect } from "react";
import { dashboardActions, useDashboardStore } from "../store/useDashboardStore";

export function useTelemetryPlayback() {
  const playback = useDashboardStore((state) => state.playback);

  useEffect(() => {
    if (playback.mode !== "replay" || !playback.isPlaying) {
      return;
    }

    const intervalMs = Math.max(60, Math.round(1000 / playback.speed));
    const timer = window.setInterval(() => {
      dashboardActions.advancePlayback();
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [playback.mode, playback.isPlaying, playback.speed]);
}
