<p align="center">
  <img src="src-tauri/icons/icon.svg" width="120" alt="KouTube logo">
</p>

<h1 align="center">KouTube</h1>

<p align="center">A local-only YouTube downloader for desktop. Paste a link, pick what you want, save it straight to your disk — no accounts, no servers, no uploads.</p>

## Download

Get the latest release for your system here:

**[⬇ Download KouTube (latest release)](https://github.com/Minitomate/KouTube/releases/latest)**

- **Linux:** AppImage (runs anywhere), `.deb`, `.rpm`
- **Windows:** installer (`setup.exe`) and `.msi`

On first launch the app fetches its tools (`yt-dlp` + `ffmpeg`, one-time download) and then works fully offline-capable — everything runs on your machine.

## Features

- **Three download modes** — full video, audio-only, or captions-only (subtitle files, no media)
- **Video options** — quality up to 4K, container (MP4/WebM/MKV), codec (AVC/HEVC/VP9/AV1)
- **Audio options** — container (MP3/M4A/Opus/WAV/FLAC), codec, bitrate; original-language detection with multi-track dubs
- **Captions** — manual tracks only (auto-generated are never listed), SRT or VTT, embedded or sidecar
- **Batch queue** — playlists and multi-track picks download together, with a tunable concurrency limit, live progress (MB + speed), overwrite confirmation, and Play / Show-in-folder actions
- **Your defaults** — save preferred format, quality, containers, and codecs; collapse the rest behind *Show advanced settings*
- **Extras** — offline banner, dark/light/auto Material themes, debug log

## Development

**Stack:** React + Vite + TypeScript + Zustand (frontend) · Rust + Tauri sidecar core driving `yt-dlp`/`ffmpeg` (desktop) · Python + FastAPI relay backend (web fallback).

```bash
# project setup (creates a local .venv, no sudo)
bash scripts/setup.sh
source .venv/bin/activate

# desktop app (primary)
cargo tauri dev

# web fallback: backend + frontend in two terminals
make backend            # uvicorn app.main:app --port 8000 (from backend/)
cd frontend && npm install && npm run dev -- --port 5173
```

**Tests** (everything must stay green):

```bash
cd frontend && npx vitest run        # unit
cd src-tauri && cargo test           # sidecar
./.venv/bin/pytest backend -q        # relay backend
cd e2e && npx playwright test        # end-to-end + a11y
```

Project layout: `frontend/src` (UI), `src-tauri/src` (`jobs.rs` downloads, `tools.rs` setup), `backend/app` (resolve/prepare/stream/mux/subs API), `e2e/tests` (Playwright incl. axe checks).

Releases are manual: test, approve, then run the **Release** workflow (Actions → Release → Run workflow with a version like `v0.1.0`). It attaches the artifacts to a **draft** release — publish the draft by hand after testing.

## Legal

KouTube is for **personal, lawful use**. Download only videos you own or that permit offline use, respect creators' rights, and comply with [YouTube's Terms of Service](https://www.youtube.com/t/terms). Not affiliated with or endorsed by YouTube or Google. Provided as-is under the [MIT License](LICENSE).
