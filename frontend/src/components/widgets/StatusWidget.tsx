import { useDashboardStore } from "../../store/useDashboardStore";

export function StatusWidget() {
  const telemetrySource = useDashboardStore((state) => state.telemetrySource);
  const connectionState = useDashboardStore((state) => state.connectionState);
  const latest = useDashboardStore((state) => state.latest);
  const playback = useDashboardStore((state) => state.playback);
  const archiveCount = useDashboardStore((state) => state.archive.length);

  return (
    <div className="widget-panel widget-panel-status">
      <div className="status-row"><span>Feed</span><strong>{telemetrySource === "demo" ? "Demo data" : "Live feed"}</strong></div>
      <div className="status-row"><span>Connection</span><strong>{connectionState}</strong></div>
      <div className="status-row"><span>Mode</span><strong>{playback.mode === "live" ? "Live" : playback.isPlaying ? "Replay ▶" : "Replay ⏸"}</strong></div>
      <div className="status-row"><span>Archive</span><strong>{archiveCount} samples</strong></div>
      <div className="status-row"><span>Replay speed</span><strong>{playback.speed.toFixed(1)}x</strong></div>
      <div className="status-row"><span>Time</span><strong>{latest ? `${latest.packet.time} ms` : "--"}</strong></div>
      <div className="status-row"><span>Altitude</span><strong>{latest ? `${latest.packet.altitude.toFixed(1)} m` : "--"}</strong></div>
      <div className="status-row"><span>Velocity</span><strong>{latest ? `${latest.derived.velocity.toFixed(1)} m/s` : "--"}</strong></div>
      <div className="status-row"><span>Lat / Lon</span><strong>{latest ? `${latest.derived.latitude.toFixed(5)}, ${latest.derived.longitude.toFixed(5)}` : "--"}</strong></div>
    </div>
  );
}
