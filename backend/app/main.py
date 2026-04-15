from __future__ import annotations

import asyncio
import contextlib
import json
import time
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .telemetry import build_sample, sample_to_dict


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections.add(websocket)

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections.discard(websocket)

    async def broadcast(self, payload: dict[str, Any]) -> None:
        message = json.dumps(payload)
        async with self._lock:
            connections = list(self._connections)
        stale: list[WebSocket] = []
        for connection in connections:
            try:
                await connection.send_text(message)
            except Exception:
                stale.append(connection)
        if stale:
            async with self._lock:
                for connection in stale:
                    self._connections.discard(connection)


manager = ConnectionManager()

MAX_ALTITUDE_FEET = 11_000.0
FEET_TO_METERS = 0.3048
MAX_ALTITUDE_METERS = MAX_ALTITUDE_FEET * FEET_TO_METERS


async def telemetry_loop() -> None:
    start = time.monotonic()
    while True:
        elapsed_ms = int((time.monotonic() - start) * 1000)
        sample = build_sample(elapsed_ms)

        # Restart the simulation once it reaches club max altitude.
        if sample.packet.altitude >= MAX_ALTITUDE_METERS:
            start = time.monotonic()
            elapsed_ms = 0
            sample = build_sample(elapsed_ms)

        await manager.broadcast(sample_to_dict(sample))
        await asyncio.sleep(0.1)


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(telemetry_loop())
    try:
        yield
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


app = FastAPI(title="ARD Ground Station API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.websocket("/ws/telemetry")
async def telemetry_websocket(websocket: WebSocket) -> None:
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await manager.disconnect(websocket)
    except Exception:
        await manager.disconnect(websocket)
