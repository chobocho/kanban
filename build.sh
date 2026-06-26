#!/usr/bin/env bash
# Build the Kanban Board into a single self-contained release/index.html.
# Requirements: node + tsc (TypeScript). No runtime dependencies are bundled.
set -e

cd "$(dirname "$0")"

echo "[1/2] Compiling TypeScript..."
npx tsc

echo "[2/2] Bundling into a single index.html..."
node tools/bundle.mjs

echo "Build complete -> release/index.html"
echo "Run it with: (cd release && python -m http.server 8001)"
