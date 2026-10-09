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

## Quickstart

```bash
# backend
cd backend
pip install -r requirements.txt
uvicorn app.main:app --port 8000

# frontend (new terminal)
cd frontend
npm install
npm run dev -- --port 5173
```

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
