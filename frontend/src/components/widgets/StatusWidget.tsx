import { useDashboardStore } from "../../store/useDashboardStore";

export function StatusWidget() {
  const connectionState = useDashboardStore((state) => state.connectionState);
  const latest = useDashboardStore((state) => state.latest);

  return (
    <div className="widget-panel widget-panel-status">
      <div className="status-row"><span>Connection</span><strong>{connectionState}</strong></div>
      <div className="status-row"><span>Time</span><strong>{latest ? `${latest.packet.time} ms` : "--"}</strong></div>
      <div className="status-row"><span>Altitude</span><strong>{latest ? `${latest.packet.altitude.toFixed(1)} m` : "--"}</strong></div>
      <div className="status-row"><span>Velocity</span><strong>{latest ? `${latest.derived.velocity.toFixed(1)} m/s` : "--"}</strong></div>
      <div className="status-row"><span>Lat / Lon</span><strong>{latest ? `${latest.derived.latitude.toFixed(5)}, ${latest.derived.longitude.toFixed(5)}` : "--"}</strong></div>
    </div>
  );
}
