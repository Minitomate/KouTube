# KouTube

Paste a YouTube link, pick format / quality / audio / manual captions, download.

## Features

- Format: video (mp4) or audio-only (mp3)
- Quality: best / 1080 / 720 / 480 (video only)
- Audio: original track or dubbed track picker
- Manual captions only — auto-generated captions are never listed
- Captions: embed + optional `.srt` sidecar
- Playlist expand + batched queue with cancel / retry

## Stack

- Backend: FastAPI + yt-dlp + ffmpeg (`backend/`, port `8000`)
- Frontend: React + Vite + TanStack Query + Zustand (`frontend/`, port `5173`)
- E2E: Playwright (`e2e/`)

## Quickstart (Ubuntu/Debian — avoids PEP 668 `externally-managed-environment`)

```bash
# one-shot setup (creates project-local .venv via uv, no sudo)
bash scripts/setup.sh
source .venv/bin/activate

# backend
make backend   # uvicorn app.main:app --port 8000

# frontend (new terminal)
cd frontend
npm install
npm run dev -- --port 5173
```

> Never `pip install` system-wide on Ubuntu 24.04+: it is PEP 668
> externally-managed. Always use the `.venv` above (`source .venv/bin/activate`)
> or `uv pip install --python .venv/bin/python ...`.
> `make setup` / `scripts/setup.sh` does this for you.

## Filename template

```text
%(title)s [%(id)s].%(ext)s
```

## Stitch design note

UI follows the Stitch mobile-first mock (see Stitch project link in the parent task).
Do not restyle outside `frontend/src/theme.css` tokens.

## Playwright

```bash
cd e2e
npm install
npx playwright install --with-deps chromium
npm test
```

Config starts both servers (`playwright.config.ts`): frontend `:5173`, backend `:8000`.
Trace on retry, screenshots on failure.

## Legal

YouTube ToS: download only videos you own or that permit offline use.
This tool is for personal, lawful use.
