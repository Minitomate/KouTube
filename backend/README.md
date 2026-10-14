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

- `POST /api/resolve {url}` → video metadata (title, thumbnail, duration, formats,
  audioTracks grouped by language with original detection, manualCaptions **only**)
  or a playlist (`is_playlist` + up to 50 flat entries with duration/thumbnail).
  Only `youtube.com` / `youtu.be` / `music.youtube.com` (SSRF allowlist).
- `POST /api/prepare {url, container, quality, codec, audioTrackLang, embedCaptions[], subFormat}` → `{filename, mergeRequired, sizeEstimate, streamToken, muxToken?, videoUrl?, audioUrl?}` (direct upstream URLs when usable).
- `GET /api/stream?token=` → proxied bytes (ranged, resumable).
- `GET /api/mux?token=` → server-merged output; `GET /api/mux-progress?rid=` staging ticks.
- `GET /api/subs?url=&lang=&fmt=[srt|vtt][&auto=1]` → subtitle text.
- `GET /api/health` → yt-dlp + ffmpeg versions.

Requires `ffmpeg` on PATH for merge/embed. Filenames are sanitized to 120 chars.

## Test

```bash
python3 -m pytest tests/ -q
python3 -m py_compile $(find app tests -name '*.py')
```
