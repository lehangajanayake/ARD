#!/usr/bin/env bash
set -euo pipefail

BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:5000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
FRONTEND_ORIGIN="${FRONTEND_ORIGIN:-http://localhost:${FRONTEND_PORT}}"

fail() {
  echo "[FAIL] $1"
  exit 1
}

pass() {
  echo "[PASS] $1"
}

info() {
  echo "[INFO] $1"
}

if ! command -v lsof >/dev/null 2>&1; then
  fail "lsof is required for port checks"
fi

if ! command -v curl >/dev/null 2>&1; then
  fail "curl is required for HTTP checks"
fi

info "Checking Vite listener on port ${FRONTEND_PORT}"
vite_listeners="$(lsof -nP -iTCP:${FRONTEND_PORT} -sTCP:LISTEN 2>/dev/null || true)"
vite_count="$(printf '%s\n' "${vite_listeners}" | tail -n +2 | sed '/^$/d' | wc -l | tr -d ' ')"

if [[ "${vite_count}" -eq 0 ]]; then
  fail "No listener found on port ${FRONTEND_PORT}. Start frontend with: cd frontend && npm run dev"
fi

if [[ "${vite_count}" -gt 1 ]]; then
  echo "${vite_listeners}"
  fail "Multiple listeners found on port ${FRONTEND_PORT}. Kill stale frontend servers"
fi

pass "Exactly one listener on port ${FRONTEND_PORT}"

info "Checking for accidental fallback server on port 5174"
fallback_listeners="$(lsof -nP -iTCP:5174 -sTCP:LISTEN 2>/dev/null || true)"
fallback_count="$(printf '%s\n' "${fallback_listeners}" | tail -n +2 | sed '/^$/d' | wc -l | tr -d ' ')"
if [[ "${fallback_count}" -gt 0 ]]; then
  echo "${fallback_listeners}"
  fail "Port 5174 is also in use. This often indicates a second Vite server causing HMR/socket confusion"
fi
pass "No fallback Vite listener detected on port 5174"

info "Checking backend health endpoint"
health_body="$(curl -fsS "${BACKEND_URL}/health")" || fail "Backend health endpoint unreachable at ${BACKEND_URL}/health"
if [[ "${health_body}" != *"ok"* ]]; then
  fail "Unexpected backend health response: ${health_body}"
fi
pass "Backend health endpoint is reachable"

info "Checking Socket.IO polling handshake and CORS"
socket_headers="$(curl -sS -D - -o /tmp/ard_socketio_body.$$ -H "Origin: ${FRONTEND_ORIGIN}" "${BACKEND_URL}/socket.io/?EIO=4&transport=polling")" || {
  rm -f /tmp/ard_socketio_body.$$
  fail "Socket.IO polling endpoint unreachable"
}

status_line="$(printf '%s\n' "${socket_headers}" | head -n 1)"
if [[ "${status_line}" != *" 200 "* ]]; then
  rm -f /tmp/ard_socketio_body.$$
  fail "Socket.IO handshake failed with status: ${status_line}"
fi

if ! printf '%s\n' "${socket_headers}" | grep -qi "Access-Control-Allow-Origin: ${FRONTEND_ORIGIN}"; then
  rm -f /tmp/ard_socketio_body.$$
  fail "Socket.IO CORS header does not allow ${FRONTEND_ORIGIN}"
fi

if ! grep -q '"sid"' /tmp/ard_socketio_body.$$; then
  rm -f /tmp/ard_socketio_body.$$
  fail "Socket.IO handshake body did not return a session id"
fi

rm -f /tmp/ard_socketio_body.$$
pass "Socket.IO handshake and CORS check passed"

echo ""
echo "All startup checks passed. You can open ${FRONTEND_ORIGIN} safely."