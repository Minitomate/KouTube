# KouTube

Paste a YouTube link, pick format / quality / audio / manual captions, download.

## Features

- Format: video (mp4/mkv) or audio-only (mp3/m4a/opus/wav/flac)
- Quality: full range incl. 4K (progressive streams direct, dash merged on the fly)
- Audio: original track or dubbed track picker
- Manual captions only — auto-generated captions are never listed; embedded into video
- Playlist expand + single-ZIP batch (max 10, skip-and-report failures)
- **User-end downloads**: files stream straight to your disk (File System Access
  streaming, anchor fallback). The server stores nothing — no jobs, no waiting.

## Stack

- Backend (stateless): FastAPI + yt-dlp + ffmpeg — `resolve`/`prepare`/`stream`/`mux` (`backend/`, port `8000`)
- Frontend: React + Vite + TanStack Query + Zustand + JSZip (`frontend/`, port `5173`)
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
npx playwright install chromium
npx playwright test -c smoke.config.ts --project=chromium
```

`playwright.config.ts` starts both servers (frontend `:5173`, backend via
`../.venv/bin/python -m uvicorn`); `smoke.config.ts` reuses your running servers.
Trace on retry, screenshots on failure, downloads accepted.

## Desktop app (Tauri, local-only)

No server: the React UI talks to Rust commands that drive `yt-dlp`/`ffmpeg`
sidecars, saving straight to your disk.

```bash
# one-time system deps (Debian/Ubuntu; needs sudo)
sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev \
  librsvg2-dev patchelf pkg-config
# Rust toolchain: https://rustup.rs

# dev (auto-downloads yt-dlp/ffmpeg/ffprobe into the app-data dir on first run)
cargo tauri dev
# release bundle (per-OS; notarize/sign for distribution)
cargo tauri build
```

Behavior notes:

- First run streams missing tools from GitHub Releases with progress
  (`tools://progress`): yt-dlp (~30MB) + BtbN ffmpeg bundle (Linux `.tar.xz`
  ~150MB, Windows `.zip` ~190MB — one-time cost). A partial ffmpeg install
  (no `ffprobe`) re-runs setup.
- Cancel/watchdog kills the whole process tree (Unix groups, Windows Job
  Objects) — yt-dlp forks ffmpeg for merges, killing one orphan the other.
- ffmpeg progress arrives on stderr, yt-dlp on stdout; `queue://updated`
  snapshots are the status source of truth.
- Sidecar binaries for packaging go in `src-tauri/binaries/<name>-<triple>`
  (`rustc --print host-tuple`); dev falls back to app-data bins, then PATH.
- App icons: `cargo tauri icon src-tauri/icons/icon.svg` regenerates the set.
- Web fallback (`make backend` + `npm run dev`) still works; the UI picks
  Tauri commands only under `__TAURI_INTERNALS__`.

## Releases

Manual only: push nothing automatically. When builds are tested and approved,
run the **Release** workflow (Actions → Release → Run workflow, enter a
version like `v0.1.0`). It builds Linux (AppImage + deb) and Windows
(installer) and attaches them to a **draft** release — publish the draft by
hand after testing the artifacts.

## Legal

YouTube ToS: download only videos you own or that permit offline use.
This tool is for personal, lawful use.
