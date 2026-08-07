# Telemetry API Guide

This document explains how to get rocket telemetry data out of the ARD backend. It covers the REST endpoints, the real-time Socket.IO stream, and the exact shape of every payload you'll receive.

The backend is a Flask + Flask-SocketIO app (see [main.py](app/main.py)). By default it runs on `http://localhost:5000` (or whatever host/port you start it with, e.g. `flask --app app.main run`).

## Table of Contents

- [Two ways to get data](#two-ways-to-get-data)
- [Data model](#data-model)
- [REST endpoints](#rest-endpoints)
- [Real-time stream (Socket.IO)](#real-time-stream-socketio)
- [Data quality / packet-loss info](#data-quality--packet-loss-info)
- [Simulation vs. real serial data](#simulation-vs-real-serial-data)
- [Quick start examples](#quick-start-examples)
- [Notes / things to be aware of](#notes--things-to-be-aware-of)

---

## Two ways to get data

| Method | Use case |
|---|---|
| **REST (`GET`/`POST`)** | One-off reads: latest sample, recent history, pipeline stats, controlling the serial port. |
| **Socket.IO (WebSocket)** | Live, continuous telemetry as it arrives (recommended for dashboards/real-time consumers). |

Both return the same underlying "telemetry envelope" JSON shape described below.

---

## Data model

Every telemetry sample — whether from REST or the socket — is a **telemetry envelope**:

```jsonc
{
  "type": "telemetry",
  "timestamp": 1723027200000,       // ms since epoch, when the server emitted this sample
  "packet": {
    "time": 4123,                   // ms since flight/stream start (device clock, not wall clock)
    "altitude": 812.4,              // meters, AGL
    "bmpTemp": 21.8,                // °C, barometer temperature
    "imuTemp": 30.1,                // °C, IMU temperature
    "pressure": 92500.0,            // Pascals
    "accX": 0.12,                   // m/s^2, body-frame accelerometer
    "accY": -0.08,
    "accZ": 9.9,
    "angVelX": 0.02,                // rad/s (or deg/s depending on source; see note below), gyro
    "angVelY": -0.01,
    "angVelZ": 0.03
  },
  "derived": {
    "velocity": 235.4,              // m/s, vertical velocity (derived from altitude delta)
    "downrange_m": 612.0,           // meters traveled horizontally from launch site
    "east_m": 337.0,                // meters east of launch site
    "north_m": 153.0,               // meters north of launch site
    "latitude": 35.00138,           // decimal degrees
    "longitude": -117.00187,        // decimal degrees
    "azimuth_deg": 65.6             // degrees, bearing from launch site (0 = north)
  },
  "quality": {                      // only present for real serial data, not simulation
    "status": "OK",                 // "OK" | "WARN" | "BAD"
    "warnings": [],                 // list of warning strings, see Data Quality section
    "received_at": 1723027200.123,  // server-side unix timestamp (seconds, float)
    "rssi": -72,                    // radio signal strength, if available
    "snr": 8.5,                     // radio signal-to-noise ratio, if available
    "packet_id": 4102               // sequence number from the device, if available
  }
}
```

> **Note on `angVelX/Y/Z` units:** the simulator and pipeline don't convert or label units explicitly — treat them as "whatever unit your sensor/firmware emits" unless you've confirmed otherwise. This is worth locking down and documenting at the source if you want this API to be trustworthy for external consumers.

### TypeScript equivalent

The frontend's canonical types live in [telemetry.ts](../frontend/src/types/telemetry.ts) — use these if you're writing a JS/TS client:

```ts
type TelemetryPacket = {
  time: number; altitude: number; bmpTemp: number; imuTemp: number; pressure: number;
  accX: number; accY: number; accZ: number;
  angVelX: number; angVelY: number; angVelZ: number;
};

type DerivedTelemetry = {
  velocity: number; downrange_m: number; east_m: number; north_m: number;
  latitude: number; longitude: number; azimuth_deg: number;
};

type TelemetryEnvelope = {
  type: "telemetry"; timestamp: number;
  packet: TelemetryPacket; derived: DerivedTelemetry;
};
```

---

## REST endpoints

All responses are JSON. Successful responses include `"success": true`; failures include `"success": false` and an `"error"` message (and an appropriate non-200 status code).

### `GET /health`
Simple liveness check.

```json
{ "status": "ok" }
```

### `GET /telemetry/latest`
Returns the most recent telemetry envelope, or `null` if nothing has been received yet.

```json
{ "success": true, "data": { "type": "telemetry", "timestamp": ..., "packet": {...}, "derived": {...} } }
```

### `GET /telemetry/history`
Returns the buffered history (last 500 samples, oldest first) as a list of telemetry envelopes.

```json
{ "success": true, "data": [ { ...envelope }, { ...envelope } ] }
```

> ⚠️ This buffer is only populated from **real serial data** (via `pipeline.process_line`), not from the built-in simulator. If you're running in simulation mode, `/telemetry/history` and `/telemetry/latest` will be empty — use the Socket.IO stream instead to see simulated data.

### `GET /telemetry/stats`
Returns data-quality statistics tracked by the interference monitor (see [Data quality](#data-quality--packet-loss-info)).

```json
{
  "success": true,
  "data": {
    "total_frames": 1500,
    "parse_failures": 3,
    "dropout_count": 1,
    "duplicate_count": 0,
    "missing_packets": 2,
    "packet_loss_percent": 0.13
  }
}
```

### `GET /ports`
Lists available serial ports on the server host.

```json
{ "success": true, "ports": ["/dev/tty.usbserial-0001", "/dev/tty.Bluetooth"] }
```

### `POST /set_port`
Body: `{ "port": "/dev/tty.usbserial-0001" }`. Selects (but doesn't open) a serial port.

```json
{ "success": true, "message": "Serial port /dev/tty.usbserial-0001 has been set" }
```

### `POST /open_port`
Opens the previously-set serial port and switches the stream from simulation to live serial data.

```json
{ "success": true, "message": "Serial port /dev/tty.usbserial-0001 opened" }
```
On failure (e.g. port busy/not found): `HTTP 500`, `{ "success": false, "error": "<reason>" }`.

### `POST /stop_port`
Closes the serial port and falls back to simulated telemetry.

```json
{ "success": true, "message": "Serial port closed" }
```

### `POST /telemetry/restart`
Restarts the simulated flight from the beginning (t=0). No effect on real serial data.

```json
{ "success": true, "message": "Simulation restarted" }
```

---

## Real-time stream (Socket.IO)

This is the recommended way to consume telemetry continuously. The backend uses **Socket.IO** (not raw WebSockets) — you need a Socket.IO client library (e.g. `socket.io-client` for JS, `python-socketio` for Python).

Connect to the same host/port as the REST API (default `http://localhost:5000`).

### Events emitted by the server

| Event | Payload | When |
|---|---|---|
| `telemetry_data` | telemetry envelope (see [Data model](#data-model)) | Every new sample (~20ms in simulation, or as fast as serial data arrives) |
| `telemetry_status` | status object (below) | On connect, on state changes, and throttled to ~1/sec while streaming |
| `pipeline_stats` | same shape as `/telemetry/stats` data | Alongside real serial packets, and on `request_telemetry` |
| `port_opened` | `{ "port": "<name>" }` | After `/open_port` succeeds |
| `simulation_restarted` | `{ "success": true }` | After a simulation restart (REST or socket-triggered) |

#### `telemetry_status` payload

```jsonc
{
  "type": "telemetry_status",
  "mode": "simulation",              // "simulation" | "serial"
  "stream": "running",               // "idle" | "starting" | "running" | "waiting_data" | "error"
  "serial_port": null,               // string | null
  "serial_connected": false,
  "last_packet_at_ms": 1723027200000,
  "last_packet_age_ms": 42,
  "last_error": null,
  "last_error_at_ms": null,
  "note": "simulation",
  "timestamp_ms": 1723027200042,
  "stats": { "total_frames": 1500, "parse_failures": 0, "dropout_count": 0,
             "duplicate_count": 0, "missing_packets": 0, "packet_loss_percent": 0 }
}
```

### Events you can send to the server

| Event | Payload | Effect |
|---|---|---|
| `request_telemetry` | *(none)* | Server replies with up to the last 100 buffered `telemetry_data` events, plus `pipeline_stats` and `telemetry_status`. Useful right after connecting to backfill a chart. |
| `restart_simulation` | *(none)* | Same as `POST /telemetry/restart`, but broadcasts `simulation_restarted` + `telemetry_status` to **all** connected clients. |

### Example (JavaScript / browser)

```js
import { io } from "socket.io-client";

const socket = io("http://localhost:5000");

socket.on("connect", () => {
  socket.emit("request_telemetry"); // backfill recent history
});

socket.on("telemetry_data", (envelope) => {
  console.log(envelope.packet.altitude, envelope.derived.velocity);
});

socket.on("telemetry_status", (status) => {
  console.log("stream state:", status.mode, status.stream);
});
```

### Example (Python client)

```python
import socketio

sio = socketio.Client()

@sio.on("telemetry_data")
def on_telemetry(data):
    print(data["packet"]["altitude"], data["derived"]["velocity"])

sio.connect("http://localhost:5000")
sio.emit("request_telemetry")
sio.wait()
```

---

## Data quality / packet-loss info

Real serial packets are checked by an `InterferenceMonitor` (see [quality.py](app/pipeline/quality.py)) which flags:

- `bad_numeric_value` — NaN/Inf in a numeric field
- `pressure_out_of_expected_range` — outside 20,000–120,000 Pa
- `altitude_out_of_expected_range` — outside -1,000–10,000 m
- `weak_rssi_possible_interference` — RSSI < -115
- `low_snr_possible_interference` — SNR < 0
- `duplicate_packet`, `packet_gap_missing_<n>`, `packet_id_went_backwards` — from packet sequence numbers
- `timestamp_not_increasing`, `telemetry_dropout_or_large_gap` (>1s between packets)
- `altitude_spike_check_sensor_or_packet_error` (implied vertical speed > 350 m/s)
- `acceleration_spike_check_sensor_or_packet_error` (accel magnitude > 200 m/s²)

`quality.status` is `"BAD"` if 3+ warnings fire, `"WARN"` if 1–2, otherwise `"OK"`. **This block is only present on real serial-sourced envelopes** — simulated envelopes have no `quality` key at all, so consumers must treat its absence as "no quality info / simulated data," not as an error.

---

## Simulation vs. real serial data

The server always has *something* streaming:

- **No serial port opened** (default): a built-in flight simulator generates a realistic ~80-second high-power rocket flight (`build_sample` in [telemetry.py](app/telemetry.py)), or replays a recorded CSV flight if [generated_blue_raven_test_data.csv](TestData/generated_blue_raven_test_data.csv) is present.
- **After `POST /open_port`**: real data from the serial device is parsed, quality-checked, logged to `flight_log.csv`, and streamed instead.

Check `telemetry_status.mode` (`"simulation"` or `"serial"`) to know which you're getting.

---

## Quick start examples

**cURL — check status and latest sample:**
```bash
curl http://localhost:5000/health
curl http://localhost:5000/telemetry/latest
curl http://localhost:5000/telemetry/stats
```

**cURL — connect to a real rocket:**
```bash
curl http://localhost:5000/ports
curl -X POST http://localhost:5000/set_port -H "Content-Type: application/json" -d '{"port":"/dev/tty.usbserial-0001"}'
curl -X POST http://localhost:5000/open_port
```

---

## Notes / things to be aware of

A few things worth knowing (or fixing) if you're building against this API long-term:

1. **No authentication/authorization.** CORS is wide open (`origins: "*"`) and there's no API key or auth check on any route. Fine for local dev, but don't expose this server on a public network as-is.
2. **`/telemetry/history` and `/telemetry/latest` are empty during simulation.** Only real serial data populates the pipeline buffer. If you need historical simulated data, consume `telemetry_data` over Socket.IO and buffer it client-side.
3. **`quality` block is conditionally present.** Don't assume every envelope has a `quality` key — check for it.
4. **Units for gyro (`angVelX/Y/Z`) aren't explicitly documented in code** (deg/s vs rad/s). Confirm against your actual firmware/sensor if precision matters.
5. **No pagination on `/telemetry/history`** — it always returns up to the last 500 buffered samples with no offset/limit query params.
6. **No `Content-Type` validation on POST bodies** — `request.json` will raise if the body isn't valid JSON; consider adding explicit `400` handling for malformed requests.
