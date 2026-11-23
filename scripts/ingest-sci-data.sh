#!/usr/bin/env bash
# Sequential full-dataset ingestion script for broworkshop sci-atlas showcases.
# Usage: scripts/ingest-sci-data.sh [demo-name ...]
# Runs purely on bro-headless (NO Python) and sequentially to fit within 16 GB RAM.

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

HEADLESS="${BRO_HEADLESS:-}"
if [ -z "$HEADLESS" ]; then
    for c in ../bro/build*/Release/bro-headless.exe ../bro/build*/bro-headless.exe ../bro/build*/bro-headless; do
        { [ -f "$c" ] && [ -x "$c" ]; } || continue
        if [ -z "$HEADLESS" ] || [ "$c" -nt "$HEADLESS" ]; then HEADLESS="$c"; fi
    done
fi
if [ -z "$HEADLESS" ] || [ ! -x "$HEADLESS" ]; then
    echo "ingest-sci-data.sh: bro-headless not found; set BRO_HEADLESS" >&2
    exit 2
fi

if [ $# -gt 0 ]; then
    TARGETS=("$@")
else
    TARGETS=(connectome-atlas gaia-phase-space cosmic-web planetary-thermo)
fi

for name in "${TARGETS[@]}"; do
    app="demos/${name}"
    script="${app}/ingest.js"
    if [ ! -f "$script" ]; then
        echo "ingest-sci-data.sh: missing $script" >&2
        exit 2
    fi
    echo "============================================================"
    echo "[sci-atlas] Ingesting $name via $HEADLESS"
    echo "============================================================"
    "$HEADLESS" --grant declared,net,files,spawn "$app" "$script"
done

echo "[sci-atlas] All requested ingestions complete."
