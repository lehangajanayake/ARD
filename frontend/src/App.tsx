import { Routes, Route, useNavigate, useParams } from "react-router-dom";
import { dashboardActions, useDashboardStore } from "./store/useDashboardStore";
import { useTelemetryFeed } from "./hooks/useTelemetryFeed";
import { useTelemetryPlayback } from "./hooks/useTelemetryPlayback";
import { Dashboard } from "./components/Dashboard";
import { GroundStationDashboard } from "./components/GroundStationDashboard";
import { MapWidget } from "./components/widgets/MapWidget";
import { TelemetryChartWidget } from "./components/widgets/TelemetryChartWidget";
import { StatusWidget } from "./components/widgets/StatusWidget";
import { TelemetryPlaybackControls } from "./components/TelemetryPlaybackControls";

function FullScreenWidget() {
  const widgets = useDashboardStore((state) => state.widgets);
  const fullScreenWidget = widgets.find((widget) => widget.fullScreen) ?? null;

  if (!fullScreenWidget) {
    return null;
  }

  return (
    <div className="fullscreen-overlay">
      <button className="fullscreen-close" onClick={() => dashboardActions.closeFullScreen()}>
        Close
      </button>
      {fullScreenWidget.kind === "map" ? <MapWidget /> : null}
      {fullScreenWidget.kind === "chart" ? <TelemetryChartWidget /> : null}
      {fullScreenWidget.kind === "status" ? <StatusWidget /> : null}
    </div>
  );
}

function StandaloneWidgetPage() {
  useTelemetryFeed();
  useTelemetryPlayback();
  const navigate = useNavigate();
  const { widgetId } = useParams();
  const widget = useDashboardStore((state) => state.widgets.find((item) => item.id === widgetId) ?? null);

  if (!widget) {
    return (
      <main className="app-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">ARD Ground Station</p>
            <h1>Widget not found</h1>
          </div>
          <button onClick={() => navigate("/")}>Back to dashboard</button>
        </header>
      </main>
    );
  }

  return (
    <main className="app-shell standalone-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">ARD Ground Station</p>
          <h1>{widget.title}</h1>
        </div>
        <button onClick={() => navigate("/")}>Back to dashboard</button>
      </header>
      <section className="standalone-widget-stage">
        <article className="standalone-widget-card">
          <div className="widget-header">
            <div>
              <div className="widget-title">{widget.title}</div>
              <div className="widget-subtitle">{widget.kind.toUpperCase()}</div>
            </div>
          </div>
          <div className="widget-body">
            {widget.kind === "map" ? <MapWidget /> : null}
            {widget.kind === "chart" ? <TelemetryChartWidget /> : null}
            {widget.kind === "status" ? <StatusWidget /> : null}
          </div>
        </article>
      </section>
    </main>
  );
}

function DashboardPage() {
  useTelemetryFeed();
  useTelemetryPlayback();
  const navigate = useNavigate();

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">ARD Ground Station</p>
          <h1>Mission Control</h1>
        </div>
        <div className="topbar-actions">
          <button onClick={() => navigate("/dashboard")}>View Dashboard</button>
          <button data-primary="true" onClick={() => dashboardActions.setTelemetrySource("demo")}>Use demo data</button>
          <button onClick={() => dashboardActions.setTelemetrySource("live")}>Use live feed</button>
        </div>
      </header>
      <GroundStationDashboard />
    </main>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/dashboard" element={<LegacyDashboardPage />} />
      <Route path="/widget/:widgetId" element={<StandaloneWidgetPage />} />
      <Route path="*" element={<DashboardPage />} />
    </Routes>
  );
}

function LegacyDashboardPage() {
  useTelemetryFeed();
  useTelemetryPlayback();
  const navigate = useNavigate();

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">ARD Ground Station</p>
          <h1>Hobby Rocket Mission Dashboard</h1>
        </div>
        <div className="topbar-actions">
          <button onClick={() => navigate("/")}>Back to Mission Control</button>
          <button data-primary="true" onClick={() => dashboardActions.setTelemetrySource("demo")}>Use demo data</button>
          <button onClick={() => dashboardActions.setTelemetrySource("live")}>Use live feed</button>
          <button onClick={() => dashboardActions.addWidget("map")}>Add map</button>
          <button onClick={() => dashboardActions.addWidget("chart")}>Add chart</button>
          <button onClick={() => dashboardActions.addWidget("status")}>Add status</button>
        </div>
      </header>
      <div className="demo-banner">
        <strong>DEMO MODE</strong>
        <span>Auto-generated rocket telemetry is running so you can show the map and replay without the backend.</span>
      </div>
      <TelemetryPlaybackControls />
      <Dashboard />
      <FullScreenWidget />
    </main>
  );
}
