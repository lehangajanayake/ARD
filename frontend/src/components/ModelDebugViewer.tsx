import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { color } from "three/src/nodes/tsl/TSLCore";

const DEFAULT_POSITION = { lon: -117.0, lat: 35.0, alt: 1000, heading: 0 };

function computeRocketZoom(altitudeMeters: number) {
  const altitude = Math.max(1, altitudeMeters);
  const logScale = Math.log2(altitude / 300 + 1);
  return Math.max(8.5, Math.min(12.5, 12.8 - logScale * 1.2));
}

export function ModelDebugViewer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const resizeHandlerRef = useRef<(() => void) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [autoFollow, setAutoFollow] = useState(true);
  const [modelScale, setModelScale] = useState(10000);
  const [position, setPosition] = useState(DEFAULT_POSITION);

  const statusText = useMemo(() => {
    if (error) return `Error: ${error}`;
    if (isLoading) return "Loading map...";
    return "Map ready";
  }, [error, isLoading]);

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
        center: [DEFAULT_POSITION.lon, DEFAULT_POSITION.lat],
        zoom: 6,
        pitch: 45,
        bearing: 0,
      });

      map.on("load", () => {
        map.resize();

        if (!map.getSource("mapbox-dem")) {
          map.addSource("mapbox-dem", {
            type: "raster-dem",
            url: "mapbox://mapbox.mapbox-terrain-dem-v1",
            tileSize: 512,
          });
          map.setTerrain({ source: "mapbox-dem", exaggeration: 1.5 });
        }

        if (!map.getSource("rocket-model")) {
          map.addSource("rocket-model", {
            type: "geojson",
            data: {
              type: "FeatureCollection",
              features: [
                {
                  type: "Feature",
                  geometry: {
                    type: "Point",
                    coordinates: [position.lon, position.lat, position.alt],
                  },
                  properties: {
                    heading: position.heading,
                  },
                },
              ],
            },
          });
        }

        if (!map.getSource("rocket-debug-point")) {
          map.addSource("rocket-debug-point", {
            type: "geojson",
            data: {
              type: "FeatureCollection",
              features: [
                {
                  type: "Feature",
                  geometry: {
                    type: "Point",
                    coordinates: [position.lon, position.lat, position.alt],
                  },
                  properties: {color: "#ff3b3b"},
                },
              ],
            },
          });
        }

        try {
          if (!map.hasModel("rocket-model")) {
            map.addModel("rocket-model", "/models/rocket.glb");
          }

          if (!map.getLayer("rocket-3d-layer")) {
            map.addLayer({
              id: "rocket-3d-layer",
              type: "model",
              source: "rocket-model",
              layout: {
                "model-id": "rocket-model",
                "model-rotation": [0, 0, ["get", "heading"]],
                "model-scale": [modelScale, modelScale, modelScale],
              },
            } as mapboxgl.LayerSpecification);
          }

          if (!map.getLayer("rocket-debug-point-layer")) {
            map.addLayer({
              id: "rocket-debug-point-layer",
              type: "circle",
              source: "rocket-debug-point",
              paint: {
                "circle-radius": 1,
                "circle-color": "#ffffff",
                "circle-stroke-width": 4,
                "circle-stroke-color": "#ff3b3b",
                "circle-opacity": 1,
                "circle-emissive-strength": 1,
              },
            });
          }

          console.log("✅ Rocket model layer added successfully");
        } catch (e) {
          console.error("❌ Failed to add rocket model layer:", e);
          setError(`Failed to add rocket model layer: ${e}`);
        }

        mapRef.current = map;
        setError(null);
        setIsLoading(false);
      });

      map.on("error", (e) => {
        console.error("Mapbox error:", e);
      });

      const handleResize = () => {
        map.resize();
        map.triggerRepaint();
      };

      resizeHandlerRef.current = handleResize;
      window.addEventListener("resize", handleResize);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error("Failed to initialize Mapbox map", err);
      setError(errorMsg);
      setIsLoading(false);
    }

    return () => {
      if (resizeHandlerRef.current) {
        window.removeEventListener("resize", resizeHandlerRef.current);
      }

      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const source = map.getSource("rocket-model") as mapboxgl.GeoJSONSource | undefined;
    if (source) {
      source.setData({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: {
              type: "Point",
              coordinates: [position.lon, position.lat, position.alt],
            },
            properties: {
              heading: position.heading,
            },
          },
        ],
      });
    }

    const debugSource = map.getSource("rocket-debug-point") as mapboxgl.GeoJSONSource | undefined;
    if (debugSource) {
      debugSource.setData({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: {
              type: "Point",
              coordinates: [position.lon, position.lat, position.alt],
            },
            properties: {},
          },
        ],
      });
    }

    if (map.getLayer("rocket-3d-layer")) {
      map.removeLayer("rocket-3d-layer");
      map.addLayer({
        id: "rocket-3d-layer",
        type: "model",
        source: "rocket-model",
        layout: {
          "model-id": "rocket-model",
          "model-rotation": [0, 0, ["get", "heading"]],
          "model-scale": [modelScale, modelScale, modelScale],
        },
      } as mapboxgl.LayerSpecification);
    }

    map.triggerRepaint();

    if (autoFollow) {
      map.flyTo({
        center: [position.lon, position.lat],
        zoom: computeRocketZoom(position.alt),
        bearing: position.heading,
        pitch: 60,
        speed: 0.8,
        curve: 1.2,
      });
    }
  }, [autoFollow, modelScale, position]);

  const focusRocket = () => {
    const map = mapRef.current;
    if (!map) return;

    map.flyTo({
      center: [position.lon, position.lat],
      zoom: computeRocketZoom(position.alt),
      bearing: position.heading,
      pitch: 60,
      speed: 0.8,
      curve: 1.2,
    });
  };

  return (
    <div className="widget-panel widget-panel-map" style={{ position: "relative", height: "100vh", background: "#0a0e1a" }}>
      <div ref={containerRef} className="mapbox-container" style={{ width: "100%", height: "100%" }} />

      <div style={{ position: "absolute", top: "0.75rem", right: "0.75rem", zIndex: 3, display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={focusRocket}
          style={{
            padding: "0.45rem 0.75rem",
            borderRadius: "0.6rem",
            border: "1px solid rgba(255, 255, 255, 0.2)",
            background: "rgba(7, 16, 30, 0.8)",
            color: "var(--text)",
            fontSize: "0.8rem",
            cursor: "pointer",
          }}
        >
          Find Rocket
        </button>

        <button
          type="button"
          onClick={() => setAutoFollow((value) => !value)}
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
          Visibility Controls
        </div>
        <div style={{ fontSize: "0.85rem", marginBottom: "0.45rem" }}>Model scale: {modelScale.toFixed(0)}x</div>
        <input
          type="range"
          min="1"
          max="50"
          step="1"
          value={modelScale}
          onChange={(e) => setModelScale(parseInt(e.target.value, 10))}
          style={{ width: "100%" }}
        />
        <div style={{ marginTop: "0.6rem", fontSize: "0.75rem", color: "var(--muted)" }}>
          White point marks the exact map coordinate.
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: "0.75rem",
          top: "0.75rem",
          zIndex: 3,
          width: "min(20rem, calc(100% - 1.5rem))",
          padding: "1rem",
          borderRadius: "1rem",
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(6, 12, 24, 0.84)",
          backdropFilter: "blur(10px)",
          color: "var(--text)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", marginBottom: "0.75rem" }}>
          <div>
            <div style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)" }}>Debug View</div>
            <div style={{ fontSize: "1rem", fontWeight: 700, color: "#ff7d7d" }}>Rocket Model</div>
          </div>
          <div style={{ fontSize: "0.75rem", color: error ? "#ff8080" : isLoading ? "#ffd700" : "#8ef08e", alignSelf: "center" }}>
            {statusText}
          </div>
        </div>

        <div style={{ display: "grid", gap: "0.75rem" }}>
          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: "0.4rem" }}>Longitude: {position.lon.toFixed(4)}</div>
            <input type="range" min="-180" max="180" step="0.01" value={position.lon} onChange={(e) => setPosition((current) => ({ ...current, lon: parseFloat(e.target.value) }))} style={{ width: "100%" }} />
          </div>

          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: "0.4rem" }}>Latitude: {position.lat.toFixed(4)}</div>
            <input type="range" min="-90" max="90" step="0.01" value={position.lat} onChange={(e) => setPosition((current) => ({ ...current, lat: parseFloat(e.target.value) }))} style={{ width: "100%" }} />
          </div>

          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: "0.4rem" }}>Altitude: {position.alt.toFixed(0)}m</div>
            <input type="range" min="0" max="10000" step="100" value={position.alt} onChange={(e) => setPosition((current) => ({ ...current, alt: parseFloat(e.target.value) }))} style={{ width: "100%" }} />
          </div>

          <div>
            <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: "0.4rem" }}>Heading: {position.heading.toFixed(0)}°</div>
            <input type="range" min="0" max="360" step="5" value={position.heading} onChange={(e) => setPosition((current) => ({ ...current, heading: parseFloat(e.target.value) }))} style={{ width: "100%" }} />
          </div>
        </div>

        <div style={{ marginTop: "0.95rem", paddingTop: "0.9rem", borderTop: "1px solid rgba(255,255,255,0.08)", fontSize: "0.8rem", color: "var(--muted)", display: "grid", gap: "0.25rem" }}>
          <div>Map style: dark-v11</div>
          <div>Terrain: enabled</div>
          <div>Model: /models/rocket.glb</div>
          <div>Rendering: Mapbox WebGL</div>
        </div>
      </div>
    </div>
  );
}
