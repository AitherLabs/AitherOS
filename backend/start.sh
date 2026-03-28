#!/bin/bash
# Wrapper script for PM2: builds the Go binary then exec's it.
# PM2 restarts trigger a rebuild automatically.
set -e

cd /opt/AitherOS/backend

echo "[aitherd] Building..."
go build -o bin/aitherd ./cmd/aitherd/ 2>&1
echo "[aitherd] Build complete — starting."

exec ./bin/aitherd
