# ARD Ground Station Dashboard

Browser-based ground station dashboard for a hobby rocket club.

## What is in this scaffold

- React + TypeScript frontend
- FastAPI backend with a realtime WebSocket telemetry stream
- Widget-based dashboard shell with drag, resize, dock, and fullscreen behavior
- Shared telemetry schema based on the provided `TelemetryPacket`

## Project layout

- `backend/` Python API and telemetry broadcaster
- `frontend/` Browser dashboard app

## Telemetry shape

The initial packet is modeled after:

```c
struct TelemetryPacket {
  uint32_t time;
  float altitude;
  float bmpTemp;
  float imuTemp;
  float pressure;
  float accX, accY, accZ;
  float angVelX, angVelY, angVelZ;
} __attribute__((packed));
```

The backend wraps that packet in a JSON envelope and adds derived flight values for charts and the future map track.

## Run locally

Backend:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

The frontend expects the backend at `http://localhost:8000` and `ws://localhost:8000/ws/telemetry`.

## Next steps

1. Replace the placeholder flight visualization with Mapbox GL / react-map-gl.
2. Add charting components for velocity, altitude, and sensor trends.
3. Add server-side telemetry ingestion from radio or serial input.
4. Add saved layouts and operator accounts later.
