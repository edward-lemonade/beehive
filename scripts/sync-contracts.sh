#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cp -R "$ROOT/backend/src/contracts/." "$ROOT/frontend/src/contracts/"
