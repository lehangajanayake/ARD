import { useDashboardStore } from "../../store/useDashboardStore";

export function StatusWidget() {
  const connectionState = useDashboardStore((state) => state.connectionState);
  const backendStatus = useDashboardStore((state) => state.backendStatus);
  const latest = useDashboardStore((state) => state.latest);
  const playback = useDashboardStore((state) => state.playback);
  const archiveCount = useDashboardStore((state) => state.archive.length);

  const statusMode = backendStatus?.mode ?? "--";
  const streamState = backendStatus?.stream ?? "--";
  const serialPort = backendStatus?.serial_port ?? "--";
  const serialConnected = backendStatus?.serial_connected ? "yes" : "no";
  const packetAge = backendStatus?.last_packet_age_ms;
  const packetAgeText = packetAge == null ? "--" : `${(packetAge / 1000).toFixed(1)} s`;
  const parseFailures = backendStatus?.stats?.parse_failures ?? 0;
  const packetLoss = backendStatus?.stats?.packet_loss_percent ?? 0;
  const lastError = backendStatus?.last_error ?? "none";

  return (
    <div className="widget-panel widget-panel-status">
      <div className="status-row"><span>Feed</span><strong>Backend replay</strong></div>
      <div className="status-row"><span>Connection</span><strong>{connectionState}</strong></div>
      <div className="status-row"><span>Backend mode</span><strong>{statusMode}</strong></div>
      <div className="status-row"><span>Stream state</span><strong>{streamState}</strong></div>
      <div className="status-row"><span>Serial connected</span><strong>{serialConnected}</strong></div>
      <div className="status-row"><span>Serial port</span><strong>{serialPort}</strong></div>
      <div className="status-row"><span>Mode</span><strong>{playback.mode === "live" ? "Live" : playback.isPlaying ? "Replay ▶" : "Replay ⏸"}</strong></div>
      <div className="status-row"><span>Archive</span><strong>{archiveCount} samples</strong></div>
      <div className="status-row"><span>Last packet age</span><strong>{packetAgeText}</strong></div>
      <div className="status-row"><span>Parse failures</span><strong>{parseFailures}</strong></div>
      <div className="status-row"><span>Packet loss</span><strong>{packetLoss.toFixed(2)}%</strong></div>
      <div className="status-row"><span>Last backend error</span><strong>{lastError}</strong></div>
      <div className="status-row"><span>Replay speed</span><strong>{playback.speed.toFixed(1)}x</strong></div>
      <div className="status-row"><span>Time</span><strong>{latest ? `${latest.packet.time} ms` : "--"}</strong></div>
      <div className="status-row"><span>Altitude</span><strong>{latest ? `${latest.packet.altitude.toFixed(1)} m` : "--"}</strong></div>
      <div className="status-row"><span>Velocity</span><strong>{latest ? `${latest.derived.velocity.toFixed(1)} m/s` : "--"}</strong></div>
      <div className="status-row"><span>Lat / Lon</span><strong>{latest ? `${latest.derived.latitude.toFixed(5)}, ${latest.derived.longitude.toFixed(5)}` : "--"}</strong></div>
    </div>
  );
}
