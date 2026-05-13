import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useDashboardStore } from "../../store/useDashboardStore";
import type { TelemetrySample } from "../../types/telemetry";

const DEFAULT_CENTER = { latitude: -30.670535341898105, longitude: 143.18988386875418, zoom: 8.25 };

function scaleTrailAltitude(altitudeMeters: number) {
  return Math.max(8, altitudeMeters * 0.85);
}

function metersPerDegreeLatitude() {
  return 111_320;
}

function metersPerDegreeLongitude(latitude: number) {
  return 111_320 * Math.cos((latitude * Math.PI) / 180);
}

function buildCylinderPolygon([longitude, latitude]: [number, number], radiusMeters: number, segments = 16) {
  const latScale = metersPerDegreeLatitude();
  const lonScale = Math.max(1, metersPerDegreeLongitude(latitude));
  const coordinates: [number, number][] = [];

  for (let index = 0; index <= segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2;
    const offsetLon = (Math.cos(angle) * radiusMeters) / lonScale;
    const offsetLat = (Math.sin(angle) * radiusMeters) / latScale;
    coordinates.push([longitude + offsetLon, latitude + offsetLat]);
  }

  return coordinates;
}

function buildFlightPathGeoJSON(history: TelemetrySample[]) {
  const features: Array<{
    type: "Feature";
    properties: { height: number; radius: number };
    geometry: { type: "Polygon"; coordinates: [number, number][][] };
  }> = [];

  for (const sample of history) {
    const longitude = sample?.derived?.longitude;
    const latitude = sample?.derived?.latitude;

    if (![longitude, latitude].every(Number.isFinite)) {
      continue;
    }

    const height = scaleTrailAltitude(Number.isFinite(sample.packet.altitude) ? sample.packet.altitude : 0);
    const radius = Math.max(1.8, Math.min(10, height * 0.03));

    features.push({
      type: "Feature",
      properties: {
        height,
        radius,
      },
      geometry: {
        type: "Polygon",
        coordinates: [buildCylinderPolygon([longitude, latitude], radius)],
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
  const latest = useDashboardStore((state) => state.latest);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // Clean any leftover Mapbox DOM nodes from previous mounts to avoid
    // duplicate maps stacking in the same container (causes ghost maps at
    // stale zoom/position).
    try {
      containerRef.current.innerHTML = "";
    } catch (e) {
      // ignore
    }
    let onZoom: (() => void) | null = null;

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
        style: "mapbox://styles/mapbox/satellite-v9",
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
          map.setTerrain({ source: "mapbox-dem", exaggeration: 2 });
        }

        // Add a 3D cylinder-like trail source for the full flight path
        if (!map.getSource("flight-path-cylinders")) {
          map.addSource("flight-path-cylinders", {
            type: "geojson",
            data: buildFlightPathGeoJSON([]) as any,
          });

          map.addLayer({
            id: "flight-path-cylinders-fill",
            type: "fill-extrusion",
            source: "flight-path-cylinders",
            layout: {
              "visibility": "visible",
            },
            paint: {
              "fill-extrusion-color": "#ff2a2a",
              "fill-extrusion-opacity": 0.8,
              "fill-extrusion-height": ["get", "height"] as any,
              "fill-extrusion-base": 0,
              "fill-extrusion-vertical-gradient": true,
            },
          });

          map.addLayer({
            id: "flight-path-cylinders-outline",
            type: "line",
            source: "flight-path-cylinders",
            layout: {
              "line-join": "round",
              "line-cap": "round",
            },
            paint: {
              "line-color": "#ff5858",
              "line-width": 1.25,
              "line-opacity": 0.9,
            },
          });
        }

        if (!markerRef.current) {
          const markerElement = document.createElement("div");
          markerElement.style.width = "14px";
          markerElement.style.height = "14px";
          markerElement.style.borderRadius = "999px";
          markerElement.style.border = "2px solid rgba(255,255,255,0.9)";
          markerElement.style.background = "#ff2a2a";

          markerRef.current = new mapboxgl.Marker({ element: markerElement, anchor: "bottom" })
            .setLngLat([DEFAULT_CENTER.longitude, DEFAULT_CENTER.latitude])
            .addTo(map);
        }

        // ensure keyframes exist
        if (!document.getElementById("mapbox-pulse-style")) {
          const style = document.createElement("style");
          style.id = "mapbox-pulse-style";
          style.innerHTML = `@keyframes map-pulse { 0% { transform: translate(-50%,-50%) scale(0.7); opacity: 0.9 } 70% { transform: translate(-50%,-50%) scale(1.8); opacity: 0 } 100% { opacity: 0 } }`;
          document.head.appendChild(style);
        }

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
      if (mapRef.current) {
        if (onZoom) {
          try {
            mapRef.current.off("zoom", onZoom);
          } catch (e) {
            // ignore
          }
        }
        mapRef.current.remove();
        mapRef.current = null;
      }
      markerRef.current = null;
    };
  }, []);

  // Update the flight path whenever history updates
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getSource) return;

    try {
      const source = map.getSource("flight-path-cylinders") as mapboxgl.GeoJSONSource | undefined;
      if (source) {
        source.setData(buildFlightPathGeoJSON(history) as any);
      }
    } catch (e) {
      console.warn("Failed to update flight path cylinders", e);
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
    if (!map || !marker || !latest) return;

    try {
      const lon = latest.derived.longitude;
      const lat = latest.derived.latitude;
      const altitude = latest.packet.altitude;
      const heading = Number.isFinite(latest.derived.azimuth_deg) ? latest.derived.azimuth_deg : 0;

      marker.setLngLat([lon, lat]);
      (marker as any).setAltitude?.(altitude);
      marker.setRotation(heading);

      // If auto-follow enabled, smoothly fly to the rocket
      if (autoFollow) {
        map.flyTo({
          center: [lon, lat],
          zoom: computeRocketZoom(altitude),
          bearing: heading,
          pitch: 62,
          speed: 0.9,
          curve: 1.2,
        });
      }
    } catch (e) {
      console.warn("Failed to update rocket 3D model", e);
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

      <div
        style={{
          position: "absolute",
          right: "0.75rem",
          bottom: "0.75rem",
          zIndex: 3,
          width: "min(18rem, calc(100% - 1.5rem))",
          padding: "1rem",
          borderRadius: "1rem",
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(6, 12, 24, 0.84)",
          backdropFilter: "blur(10px)",
          color: "var(--text)",
        }}
      >
        <div style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)", marginBottom: "0.35rem" }}>
          Marker Status
        </div>
        <div style={{ fontSize: "0.85rem", marginBottom: "0.45rem" }}>
          {latest ? "Rocket position follows backend replay" : "Waiting for telemetry"}
        </div>
        <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
          Use Find Rocket to refocus the backend-driven flight path.
        </div>
      </div>
    </div>
  );
}
