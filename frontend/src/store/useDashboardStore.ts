import { useMemo, useSyncExternalStore } from "react";
import type { TelemetrySample } from "../types/telemetry";

export type WidgetKind = "map" | "chart" | "status";
export type ConnectionState = "disconnected" | "connecting" | "connected" | "demo" | "error";
export type PlaybackMode = "live" | "replay";
export type TelemetrySource = "live" | "demo";

export type PlaybackState = {
  mode: PlaybackMode;
  isPlaying: boolean;
  speed: number;
  cursor: number;
};

export type WidgetLayout = {
  id: string;
  kind: WidgetKind;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  docked: boolean;
  fullScreen: boolean;
};

type DashboardState = {
  telemetrySource: TelemetrySource;
  connectionState: ConnectionState;
  latest: TelemetrySample | null;
  history: TelemetrySample[];
  liveLatest: TelemetrySample | null;
  liveHistory: TelemetrySample[];
  archive: TelemetrySample[];
  playback: PlaybackState;
  widgets: WidgetLayout[];
};

type DashboardListener = () => void;

const defaultWidgets: WidgetLayout[] = [
  { id: "map", kind: "map", title: "Flight Map", x: 24, y: 24, width: 680, height: 520, docked: true, fullScreen: true },
  { id: "chart", kind: "chart", title: "Velocity & Altitude", x: 728, y: 24, width: 420, height: 260, docked: true, fullScreen: false },
  { id: "status", kind: "status", title: "Telemetry Status", x: 728, y: 308, width: 420, height: 236, docked: true, fullScreen: false },
];

let state: DashboardState = {
  telemetrySource: "demo",
  connectionState: "demo",
  latest: null,
  history: [],
  liveLatest: null,
  liveHistory: [],
  archive: [],
  playback: {
    mode: "live",
    isPlaying: false,
    speed: 1,
    cursor: -1,
  },
  widgets: defaultWidgets,
};

const listeners = new Set<DashboardListener>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function setState(updater: (current: DashboardState) => DashboardState) {
  state = updater(state);
  emit();
}

function clampLayout(widget: WidgetLayout): WidgetLayout {
  return {
    ...widget,
    width: Math.max(320, widget.width),
    height: Math.max(180, widget.height),
  };
}

function clampPlaybackCursor(cursor: number, archiveLength: number) {
  if (archiveLength <= 0) {
    return -1;
  }

  return Math.max(0, Math.min(cursor, archiveLength - 1));
}

function buildPlaybackView(archive: TelemetrySample[], cursor: number) {
  const safeCursor = clampPlaybackCursor(cursor, archive.length);
  const history = safeCursor >= 0 ? archive.slice(0, safeCursor + 1) : [];
  const latest = safeCursor >= 0 ? archive[safeCursor] ?? null : null;

  return { latest, history, cursor: safeCursor };
}

function resolveLiveView(current: DashboardState) {
  return {
    latest: current.liveLatest,
    history: current.liveHistory,
  };
}

function resetTelemetryPlayback(current: DashboardState) {
  return {
    ...current,
    latest: null,
    history: [],
    liveLatest: null,
    liveHistory: [],
    archive: [],
    playback: {
      ...current.playback,
      mode: "live" as PlaybackMode,
      isPlaying: false,
      cursor: -1,
    },
  };
}

export function subscribe(listener: DashboardListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot() {
  return state;
}

export function useDashboardStore<T>(selector: (state: DashboardState) => T): T {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return useMemo(() => selector(snapshot), [selector, snapshot]);
}

export const dashboardActions = {
  setTelemetrySource(telemetrySource: TelemetrySource) {
    setState((current) => {
      const base = resetTelemetryPlayback(current);
      return {
        ...base,
        telemetrySource,
        connectionState: telemetrySource === "demo" ? "demo" : "disconnected",
      };
    });
  },
  setConnectionState(connectionState: ConnectionState) {
    setState((current) => ({ ...current, connectionState }));
  },
  pushTelemetry(sample: TelemetrySample) {
    setState((current) => {
      const liveHistory = [...current.liveHistory, sample].slice(-180);
      const archive = [...current.archive, sample].slice(-5000);

      if (current.playback.mode === "replay") {
        return {
          ...current,
          liveLatest: sample,
          liveHistory,
          archive,
        };
      }

      return {
        ...current,
        latest: sample,
        history: liveHistory,
        liveLatest: sample,
        liveHistory,
        archive,
        playback: {
          ...current.playback,
          cursor: archive.length - 1,
        },
      };
    });
  },
  setPlaybackMode(mode: PlaybackMode) {
    setState((current) => {
      if (mode === "live") {
        const liveView = resolveLiveView(current);
        return {
          ...current,
          playback: {
            ...current.playback,
            mode,
            isPlaying: false,
            cursor: current.liveHistory.length - 1,
          },
          latest: liveView.latest,
          history: liveView.history,
        };
      }

      const { latest, history, cursor } = buildPlaybackView(current.archive, current.playback.cursor);
      return {
        ...current,
        playback: {
          ...current.playback,
          mode,
          cursor,
          isPlaying: current.archive.length > 0,
        },
        latest,
        history,
      };
    });
  },
  setPlaybackSpeed(speed: number) {
    setState((current) => ({
      ...current,
      playback: {
        ...current.playback,
        speed: Math.max(0.25, Math.min(speed, 16)),
      },
    }));
  },
  setPlaybackPlaying(isPlaying: boolean) {
    setState((current) => ({
      ...current,
      playback: {
        ...current.playback,
        isPlaying,
      },
    }));
  },
  seekPlayback(cursor: number) {
    setState((current) => {
      const { latest, history, cursor: safeCursor } = buildPlaybackView(current.archive, cursor);
      return {
        ...current,
        playback: {
          ...current.playback,
          mode: current.archive.length > 0 ? "replay" : current.playback.mode,
          cursor: safeCursor,
          isPlaying: false,
        },
        latest,
        history,
      };
    });
  },
  advancePlayback() {
    setState((current) => {
      if (current.playback.mode !== "replay" || !current.playback.isPlaying) {
        return current;
      }

      const nextCursor = clampPlaybackCursor(current.playback.cursor + 1, current.archive.length);
      const { latest, history, cursor } = buildPlaybackView(current.archive, nextCursor);
      const isPlaying = cursor < current.archive.length - 1;

      return {
        ...current,
        playback: {
          ...current.playback,
          cursor,
          isPlaying,
        },
        latest,
        history,
      };
    });
  },
  stopPlayback() {
    setState((current) => ({
      ...current,
      playback: {
        ...current.playback,
        isPlaying: false,
      },
    }));
  },
  clearArchive() {
    setState((current) => ({
      ...current,
      archive: [],
      playback: {
        ...current.playback,
        mode: "live",
        isPlaying: false,
        cursor: -1,
      },
      latest: current.liveLatest,
      history: current.liveHistory,
    }));
  },
  moveWidget(id: string, x: number, y: number) {
    setState((current) => ({
      ...current,
      widgets: current.widgets.map((widget) => (widget.id === id ? clampLayout({ ...widget, x, y }) : widget)),
    }));
  },
  resizeWidget(id: string, width: number, height: number) {
    setState((current) => ({
      ...current,
      widgets: current.widgets.map((widget) => (widget.id === id ? clampLayout({ ...widget, width, height }) : widget)),
    }));
  },
  toggleDock(id: string) {
    setState((current) => ({
      ...current,
      widgets: current.widgets.map((widget) => (widget.id === id ? { ...widget, docked: !widget.docked } : widget)),
    }));
  },
  toggleFullScreen(id: string) {
    setState((current) => ({
      ...current,
      widgets: current.widgets.map((widget) => ({
        ...widget,
        fullScreen: widget.id === id ? !widget.fullScreen : false,
      })),
    }));
  },
  closeFullScreen() {
    setState((current) => ({
      ...current,
      widgets: current.widgets.map((widget) => ({ ...widget, fullScreen: false })),
    }));
  },
  addWidget(kind: WidgetKind) {
    const id = `${kind}-${Date.now()}`;
    const template: Record<WidgetKind, Omit<WidgetLayout, "id" | "kind">> = {
      map: { title: "Flight Map", x: 80, y: 80, width: 720, height: 520, docked: false, fullScreen: false },
      chart: { title: "Telemetry Chart", x: 120, y: 120, width: 440, height: 280, docked: false, fullScreen: false },
      status: { title: "Status", x: 160, y: 160, width: 360, height: 220, docked: false, fullScreen: false },
    };
    setState((current) => ({
      ...current,
      widgets: [...current.widgets, { id, kind, ...template[kind] }],
    }));
  },
};
