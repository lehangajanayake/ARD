import { useDashboardStore } from "../../store/useDashboardStore";

function chartPath(values: number[], width: number, height: number) {
  if (values.length === 0) {
    return "";
  }
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = Math.max(max - min, 1);
  return values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * width;
      const y = height - ((value - min) / span) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

export function TelemetryChartWidget() {
  const history = useDashboardStore((state) => state.history);
  const altitudeValues = history.map((sample) => sample.packet.altitude);
  const velocityValues = history.map((sample) => sample.derived.velocity);
  const altitudeLine = chartPath(altitudeValues, 620, 140);
  const velocityLine = chartPath(velocityValues, 620, 140);

  return (
    <div className="widget-panel widget-panel-chart">
      <svg viewBox="0 0 620 160" className="mini-chart" aria-label="Telemetry trend chart">
        <path d={altitudeLine} className="chart-line altitude" />
        <path d={velocityLine} className="chart-line velocity" />
      </svg>
      <div className="chart-legend">
        <span><i className="dot altitude" />Altitude</span>
        <span><i className="dot velocity" />Velocity</span>
      </div>
    </div>
  );
}
