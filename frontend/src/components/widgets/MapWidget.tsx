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
  const [viewerReady, setViewerReady] = useState(false);
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

    const initViewer = () => {
      try {
        const terrainProvider = new Cesium.EllipsoidTerrainProvider();

        const viewer = new Cesium.Viewer(containerRef.current!, {
          baseLayer: new Cesium.ImageryLayer(
            new Cesium.UrlTemplateImageryProvider({
              url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
              credit: "© Esri, DigitalGlobe, Earthstar Geographics",
              maximumLevel: 18,
            })
          ),
          terrainProvider: terrainProvider,
          baseLayerPicker: false,
          homeButton: false,
          fullscreenButton: false,
          vrButton: false,
          geocoder: false,
          navigationHelpButton: false,
          infoBox: false,
          selectionIndicator: false,
          animation: false,
          timeline: false,
        });

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
        setViewerReady(true);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error("Failed to initialize Cesium viewer", err);
        setError(errorMsg);
        setIsLoading(false);
      }
    };

    initViewer();

    return () => {
      if (viewerRef.current && !viewerRef.current.isDestroyed()) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
      setViewerReady(false);
    };
  }, []);

  // Create path entity once after viewer is initialized.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewerReady || !viewer || viewer.isDestroyed()) return;

    try {
      if (!pathEntityRef.current) {
        pathEntityRef.current = viewer.entities.add({
          polyline: {
            positions: [],
            width: 5,
            material: Cesium.Color.fromCssColorString("#ff0000").withAlpha(0.95),
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
  }, [viewerReady]);

  // Keep the path in sync with incoming telemetry samples using CallbackProperty to prevent flickering.
  useEffect(() => {
    const pathEntity = pathEntityRef.current;
    if (!viewerReady || !pathEntity || !pathEntity.polyline) return;

    pathEntity.polyline.positions = new Cesium.CallbackProperty(() => {
      return historyRef.current
        .filter((sample) => Number.isFinite(sample.derived.longitude) && Number.isFinite(sample.derived.latitude))
        .map((sample) =>
          Cesium.Cartesian3.fromDegrees(sample.derived.longitude, sample.derived.latitude, sample.packet.altitude)
        );
    }, false);
  }, [viewerReady]);

  // Update rocket marker with callback
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewerReady || !viewer || viewer.isDestroyed()) return;

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
            pixelSize: 16,
            color: Cesium.Color.fromCssColorString("#ff7d7d"),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 3,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: new Cesium.CallbackProperty(() => {
              const currentLatest = latestRef.current;
              return currentLatest ? `${currentLatest.packet.altitude.toFixed(0)}m` : "--";
            }, false),
            font: "12px sans-serif",
            fillColor: Cesium.Color.WHITE,
            pixelOffset: new Cesium.Cartesian2(0, -20),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      }

      // Keep camera fully user-controlled (no auto-follow).
    } catch (e) {
      console.warn("Error updating rocket marker:", e);
    }
  }, [latest, viewerReady]);

  const focusRocket = () => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || !latest) return;

    const rocketPosition = Cesium.Cartesian3.fromDegrees(
      latest.derived.longitude,
      latest.derived.latitude,
      latest.packet.altitude
    );

    const heading = Cesium.Math.toRadians(latest.derived.azimuth_deg);
    const chaseDistance = Math.max(120, Math.min(450, latest.packet.altitude * 0.12));
    const chaseHeight = Math.max(40, Math.min(180, latest.packet.altitude * 0.05));

    // Local ENU offset for a third-person camera: behind rocket + slightly above.
    const forwardEast = Math.sin(heading);
    const forwardNorth = Math.cos(heading);
    const offsetEast = -forwardEast * chaseDistance;
    const offsetNorth = -forwardNorth * chaseDistance;
    const localOffset = new Cesium.Cartesian3(offsetEast, offsetNorth, chaseHeight);

    const enuFrame = Cesium.Transforms.eastNorthUpToFixedFrame(rocketPosition);
    const cameraDestination = Cesium.Matrix4.multiplyByPoint(enuFrame, localOffset, new Cesium.Cartesian3());

    viewer.camera.flyTo({
      destination: cameraDestination,
      orientation: {
        heading,
        pitch: Cesium.Math.toRadians(-18),
        roll: 0,
      },
      duration: 1.0,
    });
  };

  return (
    <div className="widget-panel widget-panel-map widget-panel-cesium">
      <div ref={containerRef} className="cesium-container" style={{ background: "#dfe8f2" }} />
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
      {latest && (
        <div className="map-caption">
          <span>Time {latest.packet.time} ms</span>
          <span>
            Phase{" "}
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
