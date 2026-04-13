import { useDashboardStore } from "../../store/useDashboardStore";

export function MapWidget() {
  const history = useDashboardStore((state) => state.history);
  const latest = history.at(-1) ?? null;
  const tail = history.slice(-24);

  return (
    <div className="widget-panel widget-panel-map">
      <div className="map-viewport">
        <div className="map-grid" />
        <div className="earth-glow" />
        <svg className="flight-track" viewBox="0 0 1000 600" preserveAspectRatio="none">
          <path
            d={tail
              .map((sample, index) => {
                const x = 180 + sample.derived.east_m * 2.2;
                const y = 450 - sample.derived.north_m * 1.8 - sample.packet.altitude * 0.25;
                return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
              })
              .join(" ")}
          />
          {latest ? <circle cx={180 + latest.derived.east_m * 2.2} cy={450 - latest.derived.north_m * 1.8 - latest.packet.altitude * 0.25} r="7" /> : null}
        </svg>
      </div>
      <div className="map-caption">
        <span>Lat {latest ? latest.derived.latitude.toFixed(5) : "--"}</span>
        <span>Lon {latest ? latest.derived.longitude.toFixed(5) : "--"}</span>
        <span>Az {latest ? latest.derived.azimuth_deg.toFixed(1) : "--"}°</span>
      </div>
    </div>
  );
}
