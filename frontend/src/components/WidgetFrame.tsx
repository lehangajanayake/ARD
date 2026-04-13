import { useRef } from "react";
import type { ReactNode, PointerEvent, CSSProperties } from "react";
import type { WidgetLayout } from "../store/useDashboardStore";
import { dashboardActions } from "../store/useDashboardStore";

type WidgetFrameProps = {
  widget: WidgetLayout;
  children: ReactNode;
};

export function WidgetFrame({ widget, children }: WidgetFrameProps) {
  const dragState = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const resizeState = useRef<{ pointerId: number; startX: number; startY: number; originWidth: number; originHeight: number } | null>(null);

  const onDragStart = (event: PointerEvent<HTMLDivElement>) => {
    if (!widget.docked) {
      return;
    }
    dragState.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: widget.x,
      originY: widget.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onDragMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragState.current || dragState.current.pointerId !== event.pointerId) {
      return;
    }
    const dx = event.clientX - dragState.current.startX;
    const dy = event.clientY - dragState.current.startY;
    dashboardActions.moveWidget(widget.id, dragState.current.originX + dx, dragState.current.originY + dy);
  };

  const onDragEnd = () => {
    dragState.current = null;
  };

  const onResizeStart = (event: PointerEvent<HTMLButtonElement>) => {
    resizeState.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originWidth: widget.width,
      originHeight: widget.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onResizeMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!resizeState.current || resizeState.current.pointerId !== event.pointerId) {
      return;
    }
    const dx = event.clientX - resizeState.current.startX;
    const dy = event.clientY - resizeState.current.startY;
    dashboardActions.resizeWidget(widget.id, resizeState.current.originWidth + dx, resizeState.current.originHeight + dy);
  };

  const onResizeEnd = () => {
    resizeState.current = null;
  };

  const style: CSSProperties = widget.fullScreen
    ? { left: 0, top: 0, width: "100%", height: "100%", zIndex: 1000 }
    : widget.docked
      ? { left: widget.x, top: widget.y, width: widget.width, height: widget.height, zIndex: 20 }
      : { left: widget.x, top: widget.y, width: widget.width, height: widget.height, zIndex: 40 };

  return (
    <article className={`widget-frame ${widget.fullScreen ? "is-fullscreen" : ""}`} style={style}>
      <header className="widget-header" onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd}>
        <div>
          <div className="widget-title">{widget.title}</div>
          <div className="widget-subtitle">{widget.kind.toUpperCase()}</div>
        </div>
      </header>
      <div className="widget-body">{children}</div>
      <button
        className="widget-resize-handle"
        aria-label="Resize widget"
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
      />
    </article>
  );
}
