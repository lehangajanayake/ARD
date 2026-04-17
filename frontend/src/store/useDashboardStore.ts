import { useMemo, useSyncExternalStore } from "react";
import type { TelemetrySample } from "../types/telemetry";

export type WidgetKind = "map" | "chart" | "status";
export type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

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
  connectionState: ConnectionState;
  latest: TelemetrySample | null;
  history: TelemetrySample[];
  widgets: WidgetLayout[];
};

type DashboardListener = () => void;

const defaultWidgets: WidgetLayout[] = [
  { id: "map", kind: "map", title: "Flight Map", x: 24, y: 24, width: 680, height: 520, docked: true, fullScreen: true },
  { id: "chart", kind: "chart", title: "Velocity & Altitude", x: 728, y: 24, width: 420, height: 260, docked: true, fullScreen: false },
  { id: "status", kind: "status", title: "Telemetry Status", x: 728, y: 308, width: 420, height: 236, docked: true, fullScreen: false },
];

let state: DashboardState = {
  connectionState: "disconnected",
  latest: null,
  history: [],
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
  setConnectionState(connectionState: ConnectionState) {
    setState((current) => ({ ...current, connectionState }));
  },
  pushTelemetry(sample: TelemetrySample) {
    setState((current) => {
      const nextHistory = [...current.history, sample].slice(-180);
      return {
        ...current,
        latest: sample,
        history: nextHistory,
      };
    });
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
