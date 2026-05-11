import { useDashboardStore } from "../store/useDashboardStore";
import { useTelemetrySocket } from "../hooks/useTelemetrySocket";
import { useTelemetryPlayback } from "../hooks/useTelemetryPlayback";
import { useEffect, useRef } from "react";

export function GroundStationDashboard() {
  useTelemetrySocket();
  useTelemetryPlayback();
  const latest = useDashboardStore((state) => state.latest);
  const history = useDashboardStore((state) => state.history);
  const connectionState = useDashboardStore((state) => state.connectionState);

  if (!latest) {
    return <div className="gs-container" style={{ color: "#475569" }}>Waiting for telemetry...</div>;
  }

  const packet = latest.packet;
  const derived = latest.derived;

  // Flight phase calculation
  const timeS = packet.time / 1000;
  let phase = "PAD";
  if (timeS > 0.8 && timeS <= 6.3) phase = "BOOST";
  else if (timeS > 6.3 && timeS <= 28.0) phase = "COAST";
  else if (timeS > 28.0 && timeS <= 42.0) phase = "APOGEE";
  else if (timeS > 42.0 && timeS <= 78.0) phase = "DESCENT";
  else if (timeS > 78.0) phase = "LANDED";

  const maxAltitude = history.length > 0 ? Math.max(...history.map((s) => s.packet.altitude)) : 0;
  const maxVelocity = history.length > 0 ? Math.max(...history.map((s) => s.derived.velocity)) : 0;
  const gForce = packet.accZ / 9.80665;

  // Status color
  const statusColor =
    connectionState === "connected"
      ? "#4ade80"
      : connectionState === "error"
        ? "#ef4444"
        : "#f97316";

  return (
    <div className="gs-container">
      {/* Header */}
      <HeaderBar phase={phase} statusColor={statusColor} timeS={timeS} />

      {/* Metric Cards Row */}
      <div className="gs-row-metrics">
        <MetricCard label="ALTITUDE" value={Math.round(packet.altitude)} unit="ft" accent="#60a5fa" />
        <MetricCard label="VELOCITY" value={derived.velocity.toFixed(1)} unit="mph" accent="#4ade80" />
        <MetricCard label="G-FORCE" value={gForce.toFixed(1)} unit="G" accent={gForce > 3 ? "#ef4444" : "#facc15"} />
        <MetricCard label="PRESSURE" value={(packet.pressure / 1000).toFixed(1)} unit="hPa" accent="#60a5fa" />
        <MetricCard label="MAX ALT" value={Math.round(maxAltitude)} unit="ft" accent="#f97316" />
        <MetricCard label="MAX VEL" value={maxVelocity.toFixed(1)} unit="mph" accent="#f97316" />
      </div>

      {/* Altitude Chart */}
      <AltitudeChart history={history} maxAltitude={maxAltitude} />

      {/* Instruments Row */}
      <div className="gs-row-instruments">
        <AttitudeIndicator accX={packet.accX} accY={packet.accY} accZ={packet.accZ} />
        <CompassRose azimuth={derived.azimuth_deg} />
        <AccelerationPanel accX={packet.accX} accY={packet.accY} accZ={packet.accZ} />
        <AngularVelocityPanel angX={packet.angVelX} angY={packet.angVelY} angZ={packet.angVelZ} />
      </div>

      {/* Data Row */}
      <div className="gs-row-data">
        <PositionPanel derived={derived} />
        <TemperaturesPanel bmpTemp={packet.bmpTemp} imuTemp={packet.imuTemp} />
        <FlightStatsPanel phase={phase} timeS={timeS} maxAltitude={maxAltitude} maxVelocity={maxVelocity} />
      </div>

      {/* Footer */}
      <FooterBar history={history} />
    </div>
  );
}

function HeaderBar({ phase, statusColor, timeS }: { phase: string; statusColor: string; timeS: number }) {
  return (
    <div className="gs-header">
      <div className="gs-header-left">
        <div className="gs-logo">↑ ARD GROUND</div>
        <div className="gs-logo-sub">STATION</div>
      </div>

      <div className="gs-header-middle">
        <div className="gs-version">v2.0 · HIGH POWER ROCKETRY</div>
        <div className="gs-phase-ribbon">
          {["PAD", "BOOST", "COAST", "APOGEE", "DESCENT", "LANDED"].map((p, i, arr) => {
            const phaseIndex = arr.indexOf(phase);
            let state = "future";
            if (arr.indexOf(p) < phaseIndex) state = "past";
            else if (arr.indexOf(p) === phaseIndex) state = "active";
            return (
              <div key={p}>
                <div className={`gs-phase-pill gs-phase-${p.toLowerCase()} gs-phase-${state}`}>{p}</div>
                {i < arr.length - 1 && <div className={`gs-phase-connector gs-connector-${state}`} />}
              </div>
            );
          })}
        </div>
      </div>

      <div className="gs-header-right">
        <div className="gs-status" style={{ color: statusColor }}>
          <div className="gs-status-dot" style={{ backgroundColor: statusColor }} />
          {statusColor === "#4ade80" ? "OK" : statusColor === "#f97316" ? "WARNING" : "ERROR"}
        </div>
        <div className="gs-time">T+{timeS.toFixed(1)}s</div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, unit, accent }: { label: string; value: string | number; unit: string; accent: string }) {
  return (
    <div className="gs-metric-card">
      <div className="gs-metric-label">{label}</div>
      <div className="gs-metric-value" style={{ color: accent }}>
        {value}
      </div>
      <div className="gs-metric-unit">{unit}</div>
    </div>
  );
}

function AltitudeChart({ history, maxAltitude }: { history: any[]; maxAltitude: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const padding = 40;

    // Clear
    ctx.fillStyle = "#0a0f1e";
    ctx.fillRect(0, 0, width, height);

    // Gridlines
    ctx.setLineDash([3, 6]);
    ctx.strokeStyle = "rgba(51,65,85,0.8)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padding + (height - padding * 2) * (i / 4);
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - 20, y);
      ctx.stroke();

      // Altitude labels
      const altLabel = Math.round((maxAltitude * (4 - i)) / 4 / 100) * 100;
      ctx.fillStyle = "#475569";
      ctx.font = "10px monospace";
      ctx.textAlign = "right";
      ctx.fillText(`${altLabel}ft`, padding - 8, y + 3);
    }
    ctx.setLineDash([]);

    // Draw fill gradient
    if (history.length > 1) {
      const grad = ctx.createLinearGradient(0, padding, 0, height - padding);
      grad.addColorStop(0, "rgba(96,165,250,0.4)");
      grad.addColorStop(1, "rgba(96,165,250,0)");

      ctx.beginPath();
      ctx.moveTo(padding, height - padding);
      for (let i = 0; i < history.length; i++) {
        const x = padding + ((i / Math.max(history.length - 1, 1)) * (width - padding - 20));
        const y = height - padding - ((history[i].packet.altitude / maxAltitude) * (height - padding * 2));
        if (i === 0) ctx.lineTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(width - 20, height - padding);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
    }

    // Draw line
    ctx.strokeStyle = "#60a5fa";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < history.length; i++) {
      const x = padding + ((i / Math.max(history.length - 1, 1)) * (width - padding - 20));
      const y = height - padding - ((history[i].packet.altitude / maxAltitude) * (height - padding * 2));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }, [history, maxAltitude]);

  return (
    <div className="gs-chart-section">
      <div className="gs-chart-label">ALTITUDE PROFILE · LAST 30s</div>
      <canvas ref={canvasRef} width={600} height={180} className="gs-altitude-canvas" />
    </div>
  );
}

function AttitudeIndicator({ accX, accY, accZ }: { accX: number; accY: number; accZ: number }) {
  const roll = (Math.atan2(accY, accZ) * 180) / Math.PI;
  const pitch = (Math.atan2(-accX, Math.sqrt(accY * accY + accZ * accZ)) * 180) / Math.PI;

  return (
    <div className="gs-instrument-card">
      <div className="gs-instrument-label">ATTITUDE</div>
      <svg viewBox="0 0 120 120" className="gs-attitude-svg">
        <circle cx="60" cy="60" r="55" fill="none" stroke="#334155" strokeWidth="1" />
        <defs>
          <clipPath id="horizon-clip">
            <circle cx="60" cy="60" r="50" />
          </clipPath>
        </defs>
        <g clipPath="url(#horizon-clip)">
          <g transform={`rotate(${roll} 60 60) translate(0 ${pitch * 0.5})`}>
            <rect x="0" y="0" width="120" height="60" fill="#1e3a5f" />
            <rect x="0" y="60" width="120" height="60" fill="#7c3a00" />
          </g>
        </g>
        <line x1="35" y1="60" x2="85" y2="60" stroke="#facc15" strokeWidth="2" />
        <circle cx="60" cy="60" r="3" fill="#facc15" />
      </svg>
    </div>
  );
}

function CompassRose({ azimuth }: { azimuth: number }) {
  const getCardinalPos = (angle: number) => {
    const rad = (angle * Math.PI) / 180;
    return { x: 40 + 28 * Math.sin(rad), y: 40 - 28 * Math.cos(rad) + 3.5 };
  };

  return (
    <div className="gs-instrument-card">
      <div className="gs-instrument-label">BEARING</div>
      <svg viewBox="0 0 80 80" className="gs-compass-svg">
        <circle cx="40" cy="40" r="38" fill="rgba(10,15,30,0.5)" stroke="#334155" strokeWidth="1" />
        {[
          { label: "N", angle: 0, color: "#f97316" },
          { label: "E", angle: 90, color: "#64748b" },
          { label: "S", angle: 180, color: "#64748b" },
          { label: "W", angle: 270, color: "#64748b" },
        ].map(({ label, angle, color }) => {
          const pos = getCardinalPos(angle);
          return (
            <text key={label} x={pos.x} y={pos.y} textAnchor="middle" fill={color} fontSize="11" fontWeight="600">
              {label}
            </text>
          );
        })}
        <g transform={`rotate(${azimuth} 40 40)`}>
          <polygon points="40,15 43,40 40,38 37,40" fill="#f97316" />
          <polygon points="40,65 43,40 40,42 37,40" fill="#334155" />
          <circle cx="40" cy="40" r="2" fill="#f97316" />
        </g>
        <text x="40" y="62" textAnchor="middle" fill="#475569" fontSize="9">
          {azimuth.toFixed(0)}°
        </text>
      </svg>
    </div>
  );
}

function AccelerationPanel({ accX, accY, accZ }: { accX: number; accY: number; accZ: number }) {
  const maxAccel = 15;
  return (
    <div className="gs-instrument-card">
      <div className="gs-instrument-label">ACCELERATION (m/s²)</div>
      <div className="gs-bar-group">
        <ProgressBar label="ACC X" value={accX} max={maxAccel} color="#ff7c7c" />
        <ProgressBar label="ACC Y" value={accY} max={maxAccel} color="#4ade80" />
        <ProgressBar label="ACC Z" value={accZ} max={maxAccel} color="#60a5fa" />
      </div>
    </div>
  );
}

function AngularVelocityPanel({ angX, angY, angZ }: { angX: number; angY: number; angZ: number }) {
  const maxAng = 1;
  return (
    <div className="gs-instrument-card">
      <div className="gs-instrument-label">ANGULAR VEL (rad/s)</div>
      <div className="gs-bar-group">
        <ProgressBar label="ω X" value={angX} max={maxAng} color="#ff7c7c" displayValue={angX.toFixed(3)} />
        <ProgressBar label="ω Y" value={angY} max={maxAng} color="#fb7185" displayValue={angY.toFixed(3)} />
        <ProgressBar label="ω Z" value={angZ} max={maxAng} color="#34d399" displayValue={angZ.toFixed(3)} />
      </div>
    </div>
  );
}

function ProgressBar({
  label,
  value,
  max,
  color,
  displayValue,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  displayValue?: string;
}) {
  const percent = Math.min(Math.abs(value) / max, 1) * 100;
  return (
    <div className="gs-bar-row">
      <div className="gs-bar-label">{label}</div>
      <div className="gs-bar-track">
        <div className="gs-bar-fill" style={{ width: `${percent}%`, backgroundColor: color }} />
      </div>
      <div className="gs-bar-value" style={{ color }}>
        {displayValue || value.toFixed(2)}
      </div>
    </div>
  );
}

function PositionPanel({ derived }: { derived: any }) {
  return (
    <div className="gs-data-card gs-data-card-position">
      <div className="gs-data-label">POSITION & TRAJECTORY</div>
      <div className="gs-data-grid">
        <DataRow label="Downrange" value={derived.downrange_m.toFixed(1)} unit="m" color="#60a5fa" />
        <DataRow label="East" value={derived.east_m.toFixed(1)} unit="m" color="#4ade80" />
        <DataRow label="North" value={derived.north_m.toFixed(1)} unit="m" color="#60a5fa" />
        <DataRow label="Latitude" value={derived.latitude.toFixed(6)} unit="" color="#f97316" />
        <DataRow label="Longitude" value={derived.longitude.toFixed(6)} unit="" color="#f97316" />
        <DataRow label="Azimuth" value={derived.azimuth_deg.toFixed(1)} unit="°" color="#facc15" />
      </div>
    </div>
  );
}

function TemperaturesPanel({ bmpTemp, imuTemp }: { bmpTemp: number; imuTemp: number }) {
  return (
    <div className="gs-data-card">
      <div className="gs-data-label">TEMPERATURES</div>
      <div className="gs-temp-row">
        <div className="gs-temp-name">BMP Sensor</div>
        <div className="gs-temp-bar">
          <div className="gs-temp-fill" style={{ width: `${Math.min((bmpTemp + 20) * 2, 100)}%`, backgroundColor: "#f97316" }} />
        </div>
        <div className="gs-temp-value">{bmpTemp.toFixed(1)}°C</div>
      </div>
      <div className="gs-temp-row">
        <div className="gs-temp-name">IMU Sensor</div>
        <div className="gs-temp-bar">
          <div className="gs-temp-fill" style={{ width: `${Math.min((imuTemp + 20) * 2, 100)}%`, backgroundColor: "#a78bfa" }} />
        </div>
        <div className="gs-temp-value">{imuTemp.toFixed(1)}°C</div>
      </div>
    </div>
  );
}

function FlightStatsPanel({ phase, timeS, maxAltitude, maxVelocity }: { phase: string; timeS: number; maxAltitude: number; maxVelocity: number }) {
  return (
    <div className="gs-data-card">
      <div className="gs-data-label">FLIGHT STATS</div>
      <div className="gs-stats-table">
        <StatRow label="Phase" value={phase} color="#4ade80" />
        <StatRow label="Elapsed" value={`T+${timeS.toFixed(1)}s`} color="#475569" />
        <StatRow label="Peak Alt" value={`${Math.round(maxAltitude)} ft`} color="#f97316" />
        <StatRow label="Peak Vel" value={`${maxVelocity.toFixed(1)} mph`} color="#f97316" />
        <StatRow label="Apogee T" value="--" color="#475569" />
      </div>
    </div>
  );
}

function DataRow({ label, value, unit, color }: { label: string; value: string; unit: string; color: string }) {
  return (
    <div className="gs-data-row" style={{ borderLeftColor: `${color}30` }}>
      <div className="gs-data-row-label">{label}</div>
      <div className="gs-data-row-value" style={{ color }}>
        {value}
        {unit && <span className="gs-data-row-unit">{unit}</span>}
      </div>
    </div>
  );
}

function StatRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="gs-stat-row">
      <div className="gs-stat-label">{label}</div>
      <div className="gs-stat-value" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

function FooterBar({ history }: { history: any[] }) {
  return (
    <div className="gs-footer">
      <div className="gs-footer-left">ARD GROUND STATION · ws://localhost:8000/ws/telemetry</div>
      <div className="gs-footer-right">UPDATE RATE: 10 Hz · HISTORY: {history.length} SAMPLES</div>
    </div>
  );
}
