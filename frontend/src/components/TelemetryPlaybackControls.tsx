import { dashboardActions, useDashboardStore } from "../store/useDashboardStore";
import { telemetrySamplesToCsv } from "../lib/telemetryExport";

function downloadText(filename: string, content: string, mimeType = "text/plain") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function TelemetryPlaybackControls() {
  const playback = useDashboardStore((state) => state.playback);
  const archive = useDashboardStore((state) => state.archive);
  const liveCount = useDashboardStore((state) => state.liveHistory.length);

  const currentLabel = playback.mode === "replay" ? `${Math.max(playback.cursor + 1, 0)} / ${archive.length}` : `${liveCount} live`;

  return (
    <div className="playback-controls" aria-label="Telemetry playback controls">
      <div className="playback-controls__group">
        <button onClick={() => dashboardActions.setPlaybackMode("live")} disabled={playback.mode === "live"}>
          Live
        </button>
        <button
          onClick={() => dashboardActions.setPlaybackPlaying(!playback.isPlaying)}
          disabled={playback.mode !== "replay" || archive.length === 0}
        >
          {playback.isPlaying ? "Pause" : "Play"}
        </button>
        <button
          onClick={() => dashboardActions.setPlaybackMode("replay")}
          disabled={archive.length === 0 || playback.mode === "replay"}
        >
          Enter replay
        </button>
        <button onClick={() => dashboardActions.seekPlayback(playback.cursor - 1)} disabled={playback.mode !== "replay" || playback.cursor <= 0}>
          Step back
        </button>
        <button
          onClick={() => dashboardActions.seekPlayback(playback.cursor + 1)}
          disabled={playback.mode !== "replay" || playback.cursor >= archive.length - 1}
        >
          Step forward
        </button>
      </div>

      <div className="playback-controls__group playback-controls__group--wide">
        <label>
          <span>Speed</span>
          <select value={playback.speed} onChange={(event) => dashboardActions.setPlaybackSpeed(Number(event.target.value))}>
            <option value={0.5}>0.5x</option>
            <option value={1}>1x</option>
            <option value={2}>2x</option>
            <option value={4}>4x</option>
            <option value={8}>8x</option>
          </select>
        </label>

        <label className="playback-controls__slider">
          <span>Replay position</span>
          <input
            type="range"
            min={0}
            max={Math.max(archive.length - 1, 0)}
            value={Math.max(playback.cursor, 0)}
            disabled={archive.length === 0}
            onChange={(event) => dashboardActions.seekPlayback(Number(event.target.value))}
          />
        </label>
      </div>

      <div className="playback-controls__group playback-controls__group--right">
        <button
          onClick={() => downloadText(`telemetry-${Date.now()}.csv`, telemetrySamplesToCsv(archive), "text/csv")}
          disabled={archive.length === 0}
        >
          Export CSV
        </button>
        <button onClick={() => dashboardActions.clearArchive()} disabled={archive.length === 0}>
          Clear archive
        </button>
        <span className="playback-controls__status">{currentLabel}</span>
      </div>
    </div>
  );
}
