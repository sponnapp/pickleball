#!/usr/bin/env bash
# Start (or restart) the local Pickleball dev stack: API (wrangler dev) + Web (vite).
# Usage: ./dev.sh [start|restart|stop|status]
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$ROOT_DIR/apps/api"
WEB_DIR="$ROOT_DIR/apps/web"
LOG_DIR="$ROOT_DIR/.local-logs"
API_PORT=8787
WEB_PORT=5173
API_PID_FILE="$LOG_DIR/api.pid"
WEB_PID_FILE="$LOG_DIR/web.pid"

mkdir -p "$LOG_DIR"

kill_port() {
  local port="$1"
  local pids
  pids=$(lsof -ti tcp:"$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "Stopping process(es) on port $port: $pids"
    kill $pids 2>/dev/null || true
    sleep 1
    kill -9 $pids 2>/dev/null || true
  fi
}

stop_stack() {
  echo "== Stopping local dev stack =="
  kill_port "$API_PORT"
  kill_port "$WEB_PORT"
  rm -f "$API_PID_FILE" "$WEB_PID_FILE"
}

start_stack() {
  echo "== Starting API on :$API_PORT =="
  (cd "$API_DIR" && nohup npx wrangler dev --port "$API_PORT" > "$LOG_DIR/api.log" 2>&1 &)
  sleep 1

  echo "== Starting Web on :$WEB_PORT =="
  (cd "$WEB_DIR" && nohup npx vite --port "$WEB_PORT" > "$LOG_DIR/web.log" 2>&1 &)
  sleep 1

  echo
  echo "API log: $LOG_DIR/api.log"
  echo "Web log: $LOG_DIR/web.log"
  echo "API:  http://localhost:$API_PORT"
  echo "Web:  http://localhost:$WEB_PORT"
  echo
  echo "Tail logs with: tail -f $LOG_DIR/api.log $LOG_DIR/web.log"
}

status_stack() {
  echo "== Status =="
  if lsof -ti tcp:"$API_PORT" >/dev/null 2>&1; then
    echo "API:  RUNNING on :$API_PORT"
  else
    echo "API:  stopped"
  fi
  if lsof -ti tcp:"$WEB_PORT" >/dev/null 2>&1; then
    echo "Web:  RUNNING on :$WEB_PORT"
  else
    echo "Web:  stopped"
  fi
}

action="${1:-restart}"

case "$action" in
  start)
    start_stack
    ;;
  stop)
    stop_stack
    ;;
  restart)
    stop_stack
    start_stack
    ;;
  status)
    status_stack
    ;;
  *)
    echo "Usage: $0 [start|restart|stop|status]"
    exit 1
    ;;
esac
