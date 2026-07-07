import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import * as THREE from "three";
import { useDashboardStore } from "../../store/useDashboardStore";
import type { TelemetrySample } from "../../types/telemetry";

// White Cliffs, NSW — corrected from (-30.670535, 143.189884) which was ~25 km NE of the actual town
const DEFAULT_CENTER = { latitude: -30.855, longitude: 143.082, zoom: 12.0 };

// Three.js scene units from nozzle bottom to nose tip — used for zoom-adaptive rocket scale.
const ROCKET_MODEL_HEIGHT_UNITS = 4.5;
// Altitude-gradient trail colours: launch orange at sea level → plasma cyan at apogee.
const LAUNCH_ORANGE = "#ff8a1f";
const PLASMA_CYAN = "#31e6ff";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

// Zoom range tuned for a 0–3 050 m sub-orbital hop: close on the pad, open at apogee
function computeRocketZoom(altitudeMeters: number) {
  const t = clamp(altitudeMeters / 3050, 0, 1);
  return 14.5 - t * 3.0; // 14.5 on the pad → 11.5 near apogee
}

// Dynamic pitch: steep near the pad (pushes rocket dramatically into the sky),
// shallower at apogee (shows the full arc). White Cliffs is flat, so high
// near-pad pitch won't cause camera-terrain clipping.
function computeRocketPitch(altitudeMeters: number) {
  const t = clamp(altitudeMeters / 3050, 0, 1);
  return 70 - t * 32; // 70° on the pad → 38° near apogee
}

function buildPointGeometry(longitude: number, latitude: number, altitude: number, heading = 0) {
  return {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        properties: { heading },
        geometry: {
          type: "Point" as const,
          coordinates: [longitude, latitude, altitude],
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Three.js rocket mesh built from geometry primitives.
// "Up" in the Three.js scene is +Y. The render transform rotates the whole
// scene so Three.js +Y maps to Mapbox's altitude (Z) axis.
// ---------------------------------------------------------------------------
function buildRocketMesh(): THREE.Group {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshPhongMaterial({
    color: 0xe0e0e0,
    emissive: 0xff5500,
    emissiveIntensity: 0.3,
    shininess: 80,
  });
  const accentMat = new THREE.MeshPhongMaterial({
    color: 0xff6622,
    emissive: 0xff3300,
    emissiveIntensity: 0.55,
    shininess: 60,
  });

  // Body cylinder: height 2.5 units, radius 0.4; centred at scene origin
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.42, 2.5, 14), bodyMat));

  // Nose cone: THREE.ConeGeometry tip is at +Y; align base to top of body
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.8, 14), bodyMat);
  nose.position.y = 2.5 / 2 + 1.8 / 2; // body-half (1.25) + nose-half (0.9) = 2.15
  group.add(nose);

  // Nozzle bell at the base
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.15, 0.5, 10), accentMat);
  nozzle.position.y = -(2.5 / 2 + 0.5 / 2); // −1.5
  group.add(nozzle);

  // Four fins evenly spaced around the base of the body
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2;
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.85, 0.55), accentMat);
    fin.position.set(
      Math.cos(angle) * 0.44,
      -(2.5 / 2 - 0.42), // near body base (≈ −0.83)
      Math.sin(angle) * 0.44,
    );
    fin.rotation.y = angle;
    group.add(fin);
  }

  // Total span: nose-tip ≈ +3.05, nozzle-bottom ≈ −1.75 → ~4.8 units
  return group;
}

// Exhaust plume: two translucent cones trailing below the nozzle exit.
// Visibility is toggled in the render function based on flight phase.
function buildPlumeMesh(): THREE.Group {
  const group = new THREE.Group();

  // Outer glow envelope — wide, orange, semi-transparent
  const outerCone = new THREE.Mesh(
    new THREE.ConeGeometry(0.55, 3.2, 10, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xff6600,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  // rotation.x = π flips the cone so its wide end (radius 0.55) is at the nozzle
  // exit (top) and the apex points downward, trailing below the rocket
  outerCone.rotation.x = Math.PI;
  outerCone.position.y = -(2.5 / 2 + 0.5 + 3.2 / 2); // below nozzle bottom ≈ −3.35
  group.add(outerCone);

  // Bright inner core — narrow, yellow-white
  const innerCone = new THREE.Mesh(
    new THREE.ConeGeometry(0.18, 2.2, 6, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffee55,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  innerCone.rotation.x = Math.PI;
  innerCone.position.y = -(2.5 / 2 + 0.5 + 2.2 / 2); // ≈ −2.85
  group.add(innerCone);

  return group;
}

export function MapWidget() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const cameraFrameRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [autoFollow, setAutoFollow] = useState(true);

  // Current rocket position in Mapbox Mercator coordinates + orientation.
  // Written by the latest useEffect; read by the Three.js custom layer render function.
  const rocketStateRef = useRef<{
    mercX: number;
    mercY: number;
    mercZ: number;
    headingRad: number;
    showPlume: boolean;
  } | null>(null);

  // The Three.js Line mesh for the 3D trajectory trail.
  // Set in the custom layer's onAdd; vertex data (Mercator-space positions + vertex colours)
  // is written by the history useEffect so the trail renders at true flight altitude.
  const trailLineRef = useRef<THREE.Line | null>(null);

  const history = useDashboardStore((state) => state.history);
  const latest = useDashboardStore((state) => state.latest);

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
        pitch: 60,
        bearing: 0,
      });

      map.on("load", () => {
        // White Cliffs is flat outback — no terrain drama; leave exaggeration at 1.0
        if (!map.getSource("mapbox-dem")) {
          map.addSource("mapbox-dem", {
            type: "raster-dem",
            url: "mapbox://mapbox.mapbox-terrain-dem-v1",
            tileSize: 512,
          });
          map.setTerrain({ source: "mapbox-dem", exaggeration: 1.0 });
        }

        // Atmosphere appropriate for a sub-10 000 ft flight over flat arid terrain:
        // warm ochre haze at the horizon (outback dust), clear desert-blue sky above,
        // no star field (we never reach orbital altitudes).
        map.setFog({
          color: "rgb(180, 155, 120)",
          "high-color": "rgb(85, 145, 210)",
          "horizon-blend": 0.06,
          "star-intensity": 0.0,
        } as any);

        if (!map.getSource("kronos-shadow")) {
          map.addSource("kronos-shadow", {
            type: "geojson",
            data: buildPointGeometry(DEFAULT_CENTER.longitude, DEFAULT_CENTER.latitude, 0) as any,
          });

          map.addLayer({
            id: "kronos-trail-shadow",
            type: "circle",
            source: "kronos-shadow",
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 6, 10, 11, 14, 18, 18, 24],
              "circle-color": "#000000",
              "circle-opacity": 0.34,
              "circle-blur": 0.8,
              "circle-stroke-width": 0,
            },
          } as any);
        }

        // -- Three.js custom layer: trail (3D) + rocket model ---------------------------
        // A single CustomLayerInterface with two render passes sharing one WebGL context.
        // Pass 1 renders the trail; Pass 2 renders the rocket. Both use the same
        // THREE.Camera but different projectionMatrix values (see render() below).
        const layerState = {
          camera: null as THREE.Camera | null,
          rocketScene: null as THREE.Scene | null, // local space, placed via model matrix
          trailScene: null as THREE.Scene | null,  // vertices in Mercator world space
          renderer: null as THREE.WebGLRenderer | null,
          plumeGroup: null as THREE.Group | null,
        };

        // Capture stable ref objects so the render/onAdd callbacks close over them.
        // These refs are written by React useEffects and read on every GL frame.
        const rocketPosRef = rocketStateRef;
        const trailRef = trailLineRef;

        const rocketLayer = {
          id: "kronos-rocket-3d",
          type: "custom" as const,
          renderingMode: "3d" as const,

          onAdd(_map: mapboxgl.Map, gl: WebGLRenderingContext) {
            layerState.camera = new THREE.Camera();

            // --- Rocket scene: local Three.js space, transformed per-frame via model matrix ---
            layerState.rocketScene = new THREE.Scene();
            const rocketGroup = buildRocketMesh();
            const plumeGroup = buildPlumeMesh();
            rocketGroup.add(plumeGroup);
            layerState.plumeGroup = plumeGroup;
            layerState.rocketScene.add(rocketGroup);
            // Warm-white angled sun + ochre ambient fill for arid midday light
            const sun = new THREE.DirectionalLight(0xfff0e0, 2.5);
            sun.position.set(1, 2, 1).normalize();
            layerState.rocketScene.add(sun);
            layerState.rocketScene.add(new THREE.AmbientLight(0xffd4a0, 1.2));

            // --- Trail scene: vertices stored in Mercator world space ---
            // Because the trail camera projection = mapMatrix (no extra model transform),
            // storing positions as MercatorCoordinate.{x,y,z} renders them at the exact
            // 3D altitude — the path arcs through real airspace, not draped on the surface.
            layerState.trailScene = new THREE.Scene();
            const trailLine = new THREE.Line(
              new THREE.BufferGeometry(),
              new THREE.LineBasicMaterial({
                vertexColors: true,
                blending: THREE.AdditiveBlending, // neon glow effect against dark map
                depthWrite: false,
              }),
            );
            layerState.trailScene.add(trailLine);
            trailRef.current = trailLine; // expose for history useEffect updates

            // Share the map canvas's existing WebGL context.
            // autoClear MUST be false so Three.js never erases Mapbox's framebuffer.
            layerState.renderer = new THREE.WebGLRenderer({
              canvas: _map.getCanvas(),
              context: gl as any,
              antialias: true,
            });
            layerState.renderer.autoClear = false;
          },

          onRemove(_map: mapboxgl.Map, _gl: WebGLRenderingContext) {
            if (trailRef.current) {
              trailRef.current.geometry.dispose();
              (trailRef.current.material as THREE.Material).dispose();
              trailRef.current = null;
            }
            layerState.renderer?.dispose();
            layerState.camera = null;
            layerState.rocketScene = null;
            layerState.trailScene = null;
            layerState.renderer = null;
            layerState.plumeGroup = null;
          },

          render(_gl: WebGLRenderingContext, matrix: number[]) {
            const { camera, rocketScene, trailScene, renderer, plumeGroup } = layerState;
            if (!camera || !rocketScene || !trailScene || !renderer) return;

            // Mapbox supplies a column-major 4×4 float array: Mercator world coords → clip space
            const mapMatrix = new THREE.Matrix4().fromArray(matrix);

            // ── Pass 1: 3D flight trail ────────────────────────────────────────────────────
            // Trail vertices are already in Mercator world coordinates (set by history useEffect).
            // Using mapMatrix directly (no model transform) means each vertex is projected from
            // its exact Mercator position — the line floats at the encoded altitude.
            camera.projectionMatrix = mapMatrix.clone();
            renderer.resetState();
            renderer.render(trailScene, camera);

            // ── Pass 2: rocket model ───────────────────────────────────────────────────────
            const pos = rocketPosRef.current;
            if (!pos) return;

            const { mercX, mercY, mercZ, headingRad, showPlume } = pos;

            // -----------------------------------------------------------------------
            // Zoom-adaptive scale — keeps the rocket at ~80 CSS pixels tall across
            // the full zoom range (14.5 on the pad → 11.5 at apogee).
            //
            // Mapbox internally maps 1 Mercator unit to (2^zoom × 512) CSS pixels.
            // Therefore, to make the rocket span TARGET_PX pixels on screen:
            //
            //   scale  =  TARGET_PX / (ROCKET_MODEL_HEIGHT_UNITS × 2^zoom × 512)
            //           [Mercator units per Three.js scene unit]
            //
            // Example: zoom 14.5 → scale ≈ 1.47e-6  → ~80px rocket height ✓
            //          zoom 11.5 → scale ≈ 1.18e-5  → ~80px rocket height ✓
            // (Does not account for perspective foreshortening, but gives consistent legibility.)
            // -----------------------------------------------------------------------
            const zoom = map.getZoom();
            const TARGET_ROCKET_PX = 80;
            const scale = TARGET_ROCKET_PX / (ROCKET_MODEL_HEIGHT_UNITS * Math.pow(2, zoom) * 512);

            // Model transform (applied right-to-left per vertex through the chain):
            //
            //  T(mercX,mercY,mercZ) × S(s,−s,s) × R_x(+π/2) × R_y(−heading) × vertex
            //
            //  R_y(−heading): rotate rocket in its local horizontal plane (0°=north, CW)
            //  R_x(+π/2):     tilt Three.js +Y → Mercator +Z (altitude axis)
            //  S(s,−s,s):     scale to Mercator units; −Y corrects Mercator Y inversion
            //                 (Mercator Y increases southward, opposite to Three.js +Y)
            //  T:             translate to rocket's Mercator world position
            const modelMatrix = new THREE.Matrix4()
              .makeTranslation(mercX, mercY, mercZ)
              .multiply(new THREE.Matrix4().makeScale(scale, -scale, scale))
              .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
              .multiply(new THREE.Matrix4().makeRotationY(-headingRad));

            camera.projectionMatrix = mapMatrix.clone().multiply(modelMatrix);

            if (plumeGroup) {
              plumeGroup.visible = showPlume;
            }

            // resetState restores any WebGL state Three.js modified so Mapbox renders correctly
            renderer.resetState();
            renderer.render(rocketScene, camera);
          },
        };

        if (!map.getLayer("kronos-rocket-3d")) {
          map.addLayer(rocketLayer as any);
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
      if (cameraFrameRef.current !== null) {
        window.cancelAnimationFrame(cameraFrameRef.current);
        cameraFrameRef.current = null;
      }

      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const line = trailLineRef.current;
    // Guard: both the map and the custom-layer trail line must be initialized.
    // trailLineRef.current is set in the custom layer's onAdd(), so it may be null
    // on the first few renders before the map has loaded.
    if (!map || !line) return;

    try {
      const orangeColor = new THREE.Color(LAUNCH_ORANGE);
      const cyanColor = new THREE.Color(PLASMA_CYAN);

      // Pre-compute altitude range so vertex colours span the full flight arc
      const altitudes = history
        .map(s => s?.packet?.altitude)
        .filter((a): a is number => Number.isFinite(a));
      const minAlt = altitudes.length ? Math.min(...altitudes) : 0;
      const maxAlt = altitudes.length ? Math.max(...altitudes) : 1;
      const altSpan = Math.max(1, maxAlt - minAlt);

      const positions: number[] = [];
      const colors: number[] = [];

      for (const sample of history) {
        const lon = sample?.derived?.longitude;
        const lat = sample?.derived?.latitude;
        const alt = sample?.packet?.altitude;
        if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(alt)) continue;

        // MercatorCoordinate.fromLngLat(lngLat, altMeters) converts to Mapbox Mercator space:
        //   .x, .y ∈ [0, 1]  (global Mercator tile coordinates)
        //   .z = altMeters × meterInMercatorCoordinateUnits()  (altitude above ellipsoid)
        //
        // The trail scene camera uses mapMatrix directly (world Mercator → clip space),
        // so storing vertex positions in Mercator space renders the trail at the correct
        // 3D altitude — it arcs through the air, NOT draped flat on the terrain surface.
        const coord = mapboxgl.MercatorCoordinate.fromLngLat({ lng: lon, lat }, alt);
        positions.push(coord.x, coord.y, coord.z);

        // Altitude → colour: launch orange at sea level → plasma cyan at apogee
        const t = clamp((alt - minAlt) / altSpan, 0, 1);
        const c = new THREE.Color().lerpColors(orangeColor, cyanColor, t);
        colors.push(c.r, c.g, c.b);
      }

      // Update geometry in-place (avoids re-allocating the Line object each frame)
      line.geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      line.geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      line.geometry.computeBoundingSphere();
      map.triggerRepaint();
    } catch (e) {
      console.warn("Failed to update 3D trajectory ribbon", e);
    }
  }, [history]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !latest) return;

    try {
      const lon = latest.derived.longitude;
      const lat = latest.derived.latitude;
      const altitude = latest.packet.altitude;
      const heading = Number.isFinite(latest.derived.azimuth_deg) ? latest.derived.azimuth_deg : 0;

      // Update the Three.js rocket position via ref.
      // The custom layer reads rocketStateRef.current on every render frame — no React re-render needed.
      //
      // MercatorCoordinate.fromLngLat converts [lng, lat, altMeters] to Mapbox Mercator space.
      // meterInMercatorCoordinateUnits() gives Mercator units per real metre at this latitude;
      // it varies with cos(lat) and must be re-fetched every update for correct sizing.
      if (Number.isFinite(lon) && Number.isFinite(lat)) {
        const coord = mapboxgl.MercatorCoordinate.fromLngLat({ lng: lon, lat }, altitude);
        // Powered ascent heuristic: boost phase ends ~6 300 ms; velocity threshold filters GPS jumps
        const isPowered = latest.packet.time <= 6300 && latest.derived.velocity > 30;

        rocketStateRef.current = {
          mercX: coord.x,
          mercY: coord.y,
          mercZ: coord.z,
          headingRad: (heading * Math.PI) / 180,
          showPlume: isPowered,
        };

        map.triggerRepaint();
      }

      const shadowSource = map.getSource("kronos-shadow") as mapboxgl.GeoJSONSource | undefined;
      if (shadowSource) {
        shadowSource.setData(buildPointGeometry(lon, lat, 0, heading) as any);
      }

      if (cameraFrameRef.current !== null) {
        window.cancelAnimationFrame(cameraFrameRef.current);
      }

      cameraFrameRef.current = window.requestAnimationFrame(() => {
        cameraFrameRef.current = null;
        if (!mapRef.current || !autoFollow) {
          return;
        }

        mapRef.current.easeTo({
          center: [lon, lat],
          zoom: computeRocketZoom(altitude),
          bearing: heading,
          pitch: computeRocketPitch(altitude),
          offset: [0, -90],
          duration: 260,
          easing: (t) => 1 - Math.pow(1 - t, 3),
          essential: true,
        });
      });
    } catch (e) {
      console.warn("Failed to update Kronos model and camera", e);
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

    map.easeTo({
      center: [lon, lat],
      zoom,
      bearing: heading,
      pitch: computeRocketPitch(alt),
      offset: [0, -90],
      duration: 300,
      easing: (t) => 1 - Math.pow(1 - t, 3),
      essential: true,
    });
  };

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
          {autoFollow ? "Chase Camera: On" : "Chase Camera: Off"}
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
          Mission Control
        </div>
        <div style={{ fontSize: "0.85rem", marginBottom: "0.45rem" }}>
          {latest ? "Kronos follows backend telemetry with a cinematic chase camera" : "Waiting for telemetry"}
        </div>
        <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
          The ribbon is altitude-colored and the shadow stays pinned to ground level.
        </div>
      </div>
    </div>
  );
}
