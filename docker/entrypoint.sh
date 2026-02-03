#!/usr/bin/env bash
set -euo pipefail

DATA_DIR="${DATA_DIR:-/data}"

XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$DATA_DIR/.config}"
XDG_DATA_HOME="${XDG_DATA_HOME:-$DATA_DIR/.local/share}"
XDG_STATE_HOME="${XDG_STATE_HOME:-$DATA_DIR/.local/state}"
XDG_CACHE_HOME="${XDG_CACHE_HOME:-$DATA_DIR/.cache}"

export XDG_CONFIG_HOME XDG_DATA_HOME XDG_STATE_HOME XDG_CACHE_HOME

mkdir -p \
  "$DATA_DIR" \
  "$XDG_CONFIG_HOME" \
  "$XDG_DATA_HOME" \
  "$XDG_STATE_HOME" \
  "$XDG_CACHE_HOME"

if [ "$#" -eq 0 ]; then
  set -- node dist/server/standalone.js
fi

if [ -n "${LOG_DIR:-}" ] && [ "$1" = "node" ] && [ "${2:-}" = "dist/server/standalone.js" ]; then
  mkdir -p "$LOG_DIR"
  exec "$@" >>"$LOG_DIR/claudeproxy.log" 2>&1
fi

exec "$@"
