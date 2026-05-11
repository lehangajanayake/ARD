import { useNavigate } from "react-router-dom";
import { useDashboardStore } from "../store/useDashboardStore";
import { useTelemetrySocket } from "../hooks/useTelemetrySocket";
import { useTelemetryPlayback } from "../hooks/useTelemetryPlayback";
import { TelemetryPlaybackControls } from "./TelemetryPlaybackControls";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";

export function ChartsPage() {
  useTelemetrySocket();
  useTelemetryPlayback();
  const navigate = useNavigate();
  const history = useDashboardStore((state) => state.history);

  // Prepare chart data
  const chartData = history.map((sample, index) => ({
    time: sample.packet.time,
    index,
    altitude: Number(sample.packet.altitude.toFixed(2)),
    velocity: Number(sample.derived.velocity.toFixed(2)),
    accX: Number(sample.packet.accX.toFixed(3)),
    accY: Number(sample.packet.accY.toFixed(3)),
    accZ: Number(sample.packet.accZ.toFixed(3)),
    angVelX: Number(sample.packet.angVelX.toFixed(3)),
    angVelY: Number(sample.packet.angVelY.toFixed(3)),
    angVelZ: Number(sample.packet.angVelZ.toFixed(3)),
    bmpTemp: Number(sample.packet.bmpTemp.toFixed(2)),
    imuTemp: Number(sample.packet.imuTemp.toFixed(2)),
    pressure: Number((sample.packet.pressure / 1000).toFixed(2)), // Convert to kPa
    latitude: Number(sample.derived.latitude.toFixed(5)),
    longitude: Number(sample.derived.longitude.toFixed(5)),
  }));

  const chartContainerStyle: React.CSSProperties = {
    width: "100%",
    height: 350,
    marginBottom: "2rem",
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">ARD Ground Station</p>
          <h1>Telemetry Charts</h1>
        </div>
        <button onClick={() => navigate("/")} style={{ padding: "0.5rem 1rem" }}>
          Back to Dashboard
        </button>
      </header>

      <div className="demo-banner">
        <strong>DEMO MODE</strong>
        <span>Auto-generated rocket telemetry is running.</span>
      </div>

      <div style={{ padding: "1rem", backgroundColor: "#f5f5f5" }}>
        <TelemetryPlaybackControls />
      </div>

      <div style={{ padding: "2rem", backgroundColor: "white", overflowY: "auto" }}>
        {chartData.length === 0 ? (
          <div style={{ textAlign: "center", padding: "2rem", color: "#666" }}>
            <p>Waiting for telemetry data...</p>
          </div>
        ) : (
          <>
            {/* Altitude & Velocity */}
            <section style={{ marginBottom: "2rem" }}>
              <h2 style={{ fontSize: "1.2rem", marginBottom: "1rem" }}>Altitude & Velocity</h2>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="index" label={{ value: "Sample #", position: "insideBottomRight", offset: -5 }} />
                  <YAxis yAxisId="left" label={{ value: "Altitude (m)", angle: -90, position: "insideLeft" }} />
                  <YAxis yAxisId="right" orientation="right" label={{ value: "Velocity (m/s)", angle: 90, position: "insideRight" }} />
                  <Tooltip />
                  <Legend />
                  <Line yAxisId="left" type="monotone" dataKey="altitude" stroke="#8884d8" name="Altitude (m)" strokeWidth={2} />
                  <Line yAxisId="right" type="monotone" dataKey="velocity" stroke="#82ca9d" name="Velocity (m/s)" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </section>

            {/* Linear Acceleration */}
            <section style={{ marginBottom: "2rem" }}>
              <h2 style={{ fontSize: "1.2rem", marginBottom: "1rem" }}>Linear Acceleration (3-axis)</h2>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="index" label={{ value: "Sample #", position: "insideBottomRight", offset: -5 }} />
                  <YAxis label={{ value: "Acceleration (m/s²)", angle: -90, position: "insideLeft" }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="accX" stroke="#ff7300" name="Acc-X" strokeWidth={1.5} />
                  <Line type="monotone" dataKey="accY" stroke="#00c49f" name="Acc-Y" strokeWidth={1.5} />
                  <Line type="monotone" dataKey="accZ" stroke="#0088fe" name="Acc-Z" strokeWidth={1.5} />
                </LineChart>
              </ResponsiveContainer>
            </section>

            {/* Angular Velocity */}
            <section style={{ marginBottom: "2rem" }}>
              <h2 style={{ fontSize: "1.2rem", marginBottom: "1rem" }}>Angular Velocity (3-axis)</h2>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="index" label={{ value: "Sample #", position: "insideBottomRight", offset: -5 }} />
                  <YAxis label={{ value: "Angular Velocity (rad/s)", angle: -90, position: "insideLeft" }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="angVelX" stroke="#ff7300" name="AngVel-X" strokeWidth={1.5} />
                  <Line type="monotone" dataKey="angVelY" stroke="#00c49f" name="AngVel-Y" strokeWidth={1.5} />
                  <Line type="monotone" dataKey="angVelZ" stroke="#0088fe" name="AngVel-Z" strokeWidth={1.5} />
                </LineChart>
              </ResponsiveContainer>
            </section>

            {/* Temperature */}
            <section style={{ marginBottom: "2rem" }}>
              <h2 style={{ fontSize: "1.2rem", marginBottom: "1rem" }}>Sensor Temperatures</h2>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="index" label={{ value: "Sample #", position: "insideBottomRight", offset: -5 }} />
                  <YAxis label={{ value: "Temperature (°C)", angle: -90, position: "insideLeft" }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="bmpTemp" stroke="#ff7300" name="BMP Temp (°C)" strokeWidth={2} />
                  <Line type="monotone" dataKey="imuTemp" stroke="#0088fe" name="IMU Temp (°C)" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </section>

            {/* Pressure */}
            <section style={{ marginBottom: "2rem" }}>
              <h2 style={{ fontSize: "1.2rem", marginBottom: "1rem" }}>Atmospheric Pressure</h2>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="index" label={{ value: "Sample #", position: "insideBottomRight", offset: -5 }} />
                  <YAxis label={{ value: "Pressure (kPa)", angle: -90, position: "insideLeft" }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="pressure" stroke="#8884d8" name="Pressure (kPa)" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </section>

            {/* GPS Coordinates */}
            <section style={{ marginBottom: "2rem" }}>
              <h2 style={{ fontSize: "1.2rem", marginBottom: "1rem" }}>GPS Coordinates Drift</h2>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="index" label={{ value: "Sample #", position: "insideBottomRight", offset: -5 }} />
                  <YAxis yAxisId="left" label={{ value: "Latitude", angle: -90, position: "insideLeft" }} />
                  <YAxis yAxisId="right" orientation="right" label={{ value: "Longitude", angle: 90, position: "insideRight" }} />
                  <Tooltip />
                  <Legend />
                  <Line yAxisId="left" type="monotone" dataKey="latitude" stroke="#ff7300" name="Latitude" strokeWidth={2} />
                  <Line yAxisId="right" type="monotone" dataKey="longitude" stroke="#0088fe" name="Longitude" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
