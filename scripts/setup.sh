#!/usr/bin/env bash
# KouTube one-shot setup — avoids PEP 668 externally-managed-environment
# by always installing into a project-local .venv via uv (no sudo needed).
set -euo pipefail
cd "$(dirname "$0")/.."
uv venv .venv --seed
.venv/bin/pip install -r backend/requirements.txt
.venv/bin/pip install -q pytest httpx
echo "OK: run 'source .venv/bin/activate' then 'make backend' (or 'make test')."
