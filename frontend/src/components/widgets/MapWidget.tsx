import { useEffect, useRef, useState } from "react";
import * as Cesium from "cesium";
import { useDashboardStore } from "../../store/useDashboardStore";
import "cesium/Build/Cesium/Widgets/widgets.css";

const DEFAULT_CENTER = { latitude: 35.0, longitude: -117.0, altitude: 150000 };

export function MapWidget() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const history = useDashboardStore((state) => state.history);
  const latest = history.at(-1) ?? null;
  const historyRef = useRef(history);
  const latestRef = useRef(latest);
  const pathEntityRef = useRef<Cesium.Entity | null>(null);
  const rocketEntityRef = useRef<Cesium.Entity | null>(null);

  useEffect(() => {
    historyRef.current = history;
    latestRef.current = latest;
  }, [history, latest]);

  // Initialize Cesium viewer
  useEffect(() => {
    if (!containerRef.current || viewerRef.current) {
      return;
    }

    try {
      Cesium.Ion.defaultAccessToken = "";

      const viewer = new Cesium.Viewer(containerRef.current, {
        baseLayerPicker: false,
        homeButton: false,
        fullscreenButton: false,
        vrButton: false,
        geocoder: false,
        navigationHelpButton: false,
        infoBox: false,
        selectionIndicator: false,
      });

      // Set OpenStreetMap as base layer
      viewer.imageryLayers.removeAll();
      viewer.imageryLayers.addImageryProvider(
        new Cesium.OpenStreetMapImageryProvider({
          url: "https://tile.openstreetmap.org/",
        })
      );

      viewer.scene.globe.depthTestAgainstTerrain = false;
      viewer.scene.globe.enableLighting = true;

      // Initial view
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(
          DEFAULT_CENTER.longitude,
          DEFAULT_CENTER.latitude,
          DEFAULT_CENTER.altitude
        ),
        orientation: {
          heading: Cesium.Math.toRadians(0),
          pitch: Cesium.Math.toRadians(-45),
        },
      });

      viewerRef.current = viewer;
      setError(null);
      setIsLoading(false);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error("Failed to initialize Cesium viewer", err);
      setError(errorMsg);
      setIsLoading(false);
    }

    return () => {
      if (viewerRef.current && !viewerRef.current.isDestroyed()) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
    };
  }, []);

  // Create path entity once with callback
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    try {
      if (!pathEntityRef.current) {
        pathEntityRef.current = viewer.entities.add({
          polyline: {
            positions: new Cesium.CallbackProperty(() => {
              const currentHistory = historyRef.current;
              if (currentHistory.length < 2) return [];
              return currentHistory.map((sample) =>
                Cesium.Cartesian3.fromDegrees(
                  sample.derived.longitude,
                  sample.derived.latitude,
                  sample.packet.altitude
                )
              );
            }, false),
            width: 3,
            material: Cesium.Color.fromCssColorString("#51d2ff").withAlpha(0.9),
            clampToGround: false,
          },
        });
      }
    } catch (e) {
      console.error("Error creating flight path entity:", e);
    }

    return () => {
      // Cleanup happens in the other useEffect
    };
  }, []);

  // Update rocket marker with callback
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    try {
      if (!rocketEntityRef.current) {
        rocketEntityRef.current = viewer.entities.add({
          position: new Cesium.CallbackPositionProperty(() => {
            const currentLatest = latestRef.current;
            if (!currentLatest) return Cesium.Cartesian3.fromDegrees(DEFAULT_CENTER.longitude, DEFAULT_CENTER.latitude, 0);
            return Cesium.Cartesian3.fromDegrees(
              currentLatest.derived.longitude,
              currentLatest.derived.latitude,
              currentLatest.packet.altitude
            );
          }, false),
          point: {
            pixelSize: 10,
            color: Cesium.Color.fromCssColorString("#ff7d7d"),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
          },
          label: {
            text: new Cesium.CallbackProperty(() => {
              const currentLatest = latestRef.current;
              return currentLatest ? `${currentLatest.packet.altitude.toFixed(0)}m` : "--";
            }, false),
            font: "12px sans-serif",
            fillColor: Cesium.Color.WHITE,
            pixelOffset: new Cesium.Cartesian2(0, -20),
          },
        });
      }

      // Auto-track rocket
      if (latest) {
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(
            latest.derived.longitude,
            latest.derived.latitude,
            Math.max(500, latest.packet.altitude * 3.5)
          ),
          orientation: {
            heading: Cesium.Math.toRadians(15),
            pitch: Cesium.Math.toRadians(-45),
          },
          duration: 0.5,
        });
      }
    } catch (e) {
      console.warn("Error updating rocket marker:", e);
    }
  }, [latest]);

  return (
    <div className="widget-panel widget-panel-map widget-panel-cesium">
      <div ref={containerRef} className="cesium-container" style={{ background: "#000" }} />
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
          <p>Loading 3D map...</p>
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
      <div className="map-caption">
        <span>Alt {latest ? `${latest.packet.altitude.toFixed(0)} m` : "--"}</span>
        <span>Vel {latest ? `${latest.derived.velocity.toFixed(1)} m/s` : "--"}</span>
        <span>Az {latest ? `${latest.derived.azimuth_deg.toFixed(1)}°` : "--"}</span>
      </div>
    </div>
  );
}
