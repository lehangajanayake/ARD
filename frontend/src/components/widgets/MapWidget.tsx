import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useDashboardStore } from "../../store/useDashboardStore";
import type { TelemetrySample } from "../../types/telemetry";

const DEFAULT_CENTER = { latitude: 35.0, longitude: -117.0, zoom: 6 };

function scaleTrailAltitude(altitudeMeters: number) {
  return Math.max(8, altitudeMeters * 0.85);
}

function buildFlightPathGeoJSON(history: TelemetrySample[]) {
  const features: Array<{
    type: "Feature";
    properties: { startZ: number; endZ: number };
    geometry: { type: "LineString"; coordinates: [number, number][] };
  }> = [];

  for (let index = 1; index < history.length; index += 1) {
    const start = history[index - 1];
    const end = history[index];
    const startLon = start?.derived?.longitude;
    const startLat = start?.derived?.latitude;
    const endLon = end?.derived?.longitude;
    const endLat = end?.derived?.latitude;

    if (![startLon, startLat, endLon, endLat].every(Number.isFinite)) {
      continue;
    }

    features.push({
      type: "Feature",
      properties: {
        startZ: scaleTrailAltitude(Number.isFinite(start.packet.altitude) ? start.packet.altitude : 0),
        endZ: scaleTrailAltitude(Number.isFinite(end.packet.altitude) ? end.packet.altitude : 0),
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [startLon, startLat],
          [endLon, endLat],
        ],
      },
    });
  }

  return {
    type: "FeatureCollection",
    features,
  };
}

export function MapWidget() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const history = useDashboardStore((state) => state.history);
  const latest = history.at(-1) ?? null;
  const historyRef = useRef(history);
  const latestRef = useRef(latest);

  useEffect(() => {
    historyRef.current = history;
    latestRef.current = latest;
  }, [history, latest]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const token = (import.meta as any).env?.VITE_MAPBOX_TOKEN;
    if (!token) {
      setError("Missing VITE_MAPBOX_TOKEN in environment");
      setIsLoading(false);
      return;
    }

    try {
      mapboxgl.accessToken = token;

      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/dark-v11",
        center: [DEFAULT_CENTER.longitude, DEFAULT_CENTER.latitude],
        zoom: DEFAULT_CENTER.zoom,
        pitch: 45,
        bearing: 0,
      });

      map.on("load", () => {
        // Add 3D terrain
        if (!map.getSource("mapbox-dem")) {
          map.addSource("mapbox-dem", {
            type: "raster-dem",
            url: "mapbox://mapbox.mapbox-terrain-dem-v1",
            tileSize: 512,
          });
          map.setTerrain({ source: "mapbox-dem", exaggeration: 1.5 });
        }

        // Add an empty GeoJSON source for the flight path
        if (!map.getSource("flight-path")) {
          map.addSource("flight-path", {
            type: "geojson",
            lineMetrics: true,
            data: buildFlightPathGeoJSON([]),
          });

          map.addLayer({
            id: "flight-path-line",
            type: "line",
            source: "flight-path",
            layout: {
              "line-join": "round",
              "line-cap": "round",
              "line-elevation-reference": "ground",
              "line-width-unit": "meters",
              "line-z-offset": ["interpolate", ["linear"], ["line-progress"], 0, ["get", "startZ"], 1, ["get", "endZ"]] as any,
            },
            paint: {
              "line-color": "#ff2a2a",
              "line-width": 12,
              "line-opacity": 0.98,
              "line-emissive-strength": 1,
            },
          });
        }

        // Create a marker for the rocket (with pulsing inner)
        const el = document.createElement("div");
        el.className = "rocket-marker";
        el.style.width = "22px";
        el.style.height = "22px";
        el.style.display = "flex";
        el.style.alignItems = "center";
        el.style.justifyContent = "center";

        const dot = document.createElement("div");
        dot.style.width = "12px";
        dot.style.height = "12px";
        dot.style.borderRadius = "50%";
        dot.style.background = "#ff7d7d";
        dot.style.border = "2px solid white";
        dot.style.boxSizing = "border-box";
        dot.style.boxShadow = "0 0 6px rgba(0,0,0,0.4)";
        dot.style.position = "relative";

        const pulse = document.createElement("div");
        pulse.style.position = "absolute";
        pulse.style.left = "50%";
        pulse.style.top = "50%";
        pulse.style.transform = "translate(-50%, -50%)";
        pulse.style.width = "12px";
        pulse.style.height = "12px";
        pulse.style.borderRadius = "50%";
        pulse.style.background = "rgba(255,125,125,0.4)";
        pulse.style.zIndex = "-1";
        pulse.style.animation = "map-pulse 1.6s infinite";

        el.appendChild(pulse);
        el.appendChild(dot);

        // ensure keyframes exist
        if (!document.getElementById("mapbox-pulse-style")) {
          const style = document.createElement("style");
          style.id = "mapbox-pulse-style";
          style.innerHTML = `@keyframes map-pulse { 0% { transform: translate(-50%,-50%) scale(0.7); opacity: 0.9 } 70% { transform: translate(-50%,-50%) scale(1.8); opacity: 0 } 100% { opacity: 0 } }`;
          document.head.appendChild(style);
        }

        const marker = new mapboxgl.Marker(el).setLngLat([DEFAULT_CENTER.longitude, DEFAULT_CENTER.latitude]).addTo(map);
        markerRef.current = marker;

        mapRef.current = map;
        setError(null);
        setIsLoading(false);
      });

      map.on("error", (e) => {
        console.error("Mapbox error:", e);
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error("Failed to initialize Mapbox map", err);
      setError(errorMsg);
      setIsLoading(false);
    }

    return () => {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Update the flight path whenever history updates
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getSource || !historyRef.current) return;

    try {
      const source = map.getSource("flight-path") as mapboxgl.GeoJSONSource | undefined;
      if (source) {
        source.setData(buildFlightPathGeoJSON(historyRef.current));
      }
    } catch (e) {
      console.warn("Failed to update flight path", e);
    }
  }, [history]);

  const [autoFollow, setAutoFollow] = useState(true);

  function computeRocketZoom(altitudeMeters: number) {
    const altitude = Math.max(1, altitudeMeters);
    const logScale = Math.log2(altitude / 300 + 1);
    return Math.max(8.5, Math.min(12.5, 12.8 - logScale * 1.2));
  }

  // Update rocket marker when latest changes
  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;

    try {
      if (!latest) return;
      const lon = latest.derived.longitude;
      const lat = latest.derived.latitude;

      marker.setLngLat([lon, lat]);

      // Optionally update a small popup with altitude
      const altitude = latest.packet.altitude != null ? `${latest.packet.altitude.toFixed(0)}m` : "--";
      // Use a title attribute for simple hover tooltip
      const el = marker.getElement();
      el.setAttribute("title", altitude);
      // If auto-follow enabled, smoothly fly to the rocket
      if (autoFollow) {
        const heading = Number.isFinite(latest.derived.azimuth_deg) ? latest.derived.azimuth_deg : 0;
        map.flyTo({
          center: [lon, lat],
          zoom: computeRocketZoom(latest.packet.altitude),
          bearing: heading,
          pitch: 62,
          speed: 0.9,
          curve: 1.2,
        });
      }
    } catch (e) {
      console.warn("Failed to update rocket marker", e);
    }
  }, [latest, autoFollow]);

  const focusRocket = () => {
    const map = mapRef.current;
    if (!map || !latest) return;

    const lon = latest.derived.longitude;
    const lat = latest.derived.latitude;
    const heading = Number.isFinite(latest.derived.azimuth_deg) ? latest.derived.azimuth_deg : 0;
    const alt = latest.packet.altitude ?? 1000;
    const zoom = computeRocketZoom(alt);

    map.flyTo({
      center: [lon, lat],
      zoom,
      bearing: heading,
      pitch: 60,
      speed: 0.8,
      curve: 1.2,
    });
  };

  const toggleAutoFollow = () => setAutoFollow((v) => !v);

  return (
    <div className="widget-panel widget-panel-map">
      <div ref={containerRef} className="mapbox-container" style={{ width: "100%", height: "100%", minHeight: 360 }} />

      <div style={{ position: "absolute", top: "0.75rem", right: "0.75rem", zIndex: 3, display: "flex", gap: "0.5rem" }}>
        {!error ? (
        <button
          type="button"
          onClick={focusRocket}
          disabled={!latest}
          style={{
            position: "absolute",
            top: "0.75rem",
            right: "0.75rem",
            zIndex: 2,
            padding: "0.45rem 0.75rem",
            borderRadius: "0.6rem",
            border: "1px solid rgba(255, 255, 255, 0.2)",
            background: "rgba(7, 16, 30, 0.8)",
            color: "var(--text)",
            fontSize: "0.8rem",
            cursor: latest ? "pointer" : "not-allowed",
            opacity: latest ? 1 : 0.55,
          }}
        >
          Find Rocket
        </button>
        ) : null}

        <button
          type="button"
          onClick={toggleAutoFollow}
          style={{
            padding: "0.45rem 0.75rem",
            borderRadius: "0.6rem",
            border: "1px solid rgba(255, 255, 255, 0.2)",
            background: autoFollow ? "rgba(20,120,20,0.85)" : "rgba(7, 16, 30, 0.8)",
            color: "var(--text)",
            fontSize: "0.8rem",
            cursor: "pointer",
          }}
        >
          {autoFollow ? "Auto-follow: On" : "Auto-follow: Off"}
        </button>
      </div>

      {isLoading && !error ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--muted)",
            background: "rgba(0, 0, 0, 0.35)",
            pointerEvents: "none",
          }}
        >
          <p>Loading map...</p>
        </div>
      ) : null}

      {error ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            padding: "1rem",
            color: "var(--danger)",
            overflow: "auto",
            background: "rgba(0, 0, 0, 0.85)",
          }}
        >
          <p style={{ marginTop: 0 }}>Map Error</p>
          <p style={{ fontSize: "0.85rem", wordBreak: "break-word" }}>{error}</p>
          <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Check the browser console for details.</p>
        </div>
      ) : null}

      {latest && (
        <div className="map-caption">
          <span>Time {latest.packet.time} ms</span>
          <span>
            Phase {" "}
            {latest.packet.time <= 800
              ? "PAD"
              : latest.packet.time <= 6300
                ? "BOOST"
                : latest.packet.time <= 28000
                  ? "COAST"
                  : latest.packet.time <= 42000
                    ? "APOGEE"
                    : latest.packet.time <= 78000
                      ? "DESCENT"
                      : "LANDED"}
          </span>
          <span>Alt {latest.packet.altitude.toFixed(0)} m</span>
          <span>Vel {latest.derived.velocity.toFixed(1)} m/s</span>
          <span>Az {latest.derived.azimuth_deg.toFixed(1)}°</span>
        </div>
      )}
    </div>
  );
}
