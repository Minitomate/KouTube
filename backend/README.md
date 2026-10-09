# KouTube Backend

FastAPI + yt-dlp + FFmpeg. Python 3.11+.

## Run

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Requires `ffmpeg` on PATH for merge/embed.

## API

- `POST /api/resolve {url}` → title, thumbnail, duration, formats,
  audioTracks (grouped by language, first = original default),
  manualCaptions (**only** `info['subtitles']`, never `automatic_captions`, `live_chat` excluded),
  is_playlist + entries (max 50).
- `POST /api/download {url|videoId, container, quality, audioTrackLang, embedCaptions[], separateCaptions, subFormat}` → `{jobId, batchId}`.
  Format: `bestvideo[height<=Q]+bestaudio/best`; outtmpl `%(title)s [%(id)s].%(ext)s` sanitized to 120 chars.
  Only `youtube.com` / `youtu.be` / `music.youtube.com` (SSRF allowlist).
- `GET /api/jobs/{id}` status · `GET /api/jobs/{id}/events` SSE progress
  (`queued/downloading/merging/postprocessing/done/error` + `percent`, explicit `done` event).
- `GET /api/files/{id}` download with `Content-Disposition` (traversal-guarded).
- `GET /api/health` → yt-dlp + ffmpeg versions.

Queue: asyncio, concurrency 3, 2GB disk cap, 24h TTL cleanup (apscheduler).

## Test

```bash
python3 -m pytest tests/ -q
python3 -m py_compile $(find app tests -name '*.py')
```
