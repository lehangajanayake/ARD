import { dashboardActions, useDashboardStore } from "../store/useDashboardStore";
import { useTelemetrySocket } from "../hooks/useTelemetrySocket";
import { WidgetFrame } from "./WidgetFrame";
import { MapWidget } from "./widgets/MapWidget";
import { TelemetryChartWidget } from "./widgets/TelemetryChartWidget";
import { StatusWidget } from "./widgets/StatusWidget";
import { useNavigate } from "react-router-dom";

export function Dashboard() {
  useTelemetrySocket();
  const widgets = useDashboardStore((state) => state.widgets);
  const navigate = useNavigate();

  return (
    <section className="dashboard-stage">
      {widgets.map((widget) => (
        <WidgetFrame key={widget.id} widget={widget}>
          {widget.kind === "map" ? <MapWidget /> : null}
          {widget.kind === "chart" ? <TelemetryChartWidget /> : null}
          {widget.kind === "status" ? <StatusWidget /> : null}
          <div className="widget-hint">Drag by the header, resize from the corner, and dock or fullscreen from the controls.</div>
          <div className="widget-actions">
            <button onClick={() => dashboardActions.toggleDock(widget.id)}>{widget.docked ? "Undock" : "Dock"}</button>
            <button onClick={() => dashboardActions.toggleFullScreen(widget.id)}>Fullscreen</button>
            <button onClick={() => navigate(`/widget/${widget.id}`)}>Open page</button>
          </div>
        </WidgetFrame>
      ))}
    </section>
  );
}
