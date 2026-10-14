# KouTube Development

Stack: React + Vite + TypeScript + Zustand (frontend) · Rust + Tauri sidecar core driving `yt-dlp`/`ffmpeg` (desktop) · Python + FastAPI relay backend (web fallback).

## Layout

- `frontend/src` — UI (`routes/` Home/Settings, `components/`, `lib/` store/api/transfer/desktop/settings/i18n).
- `src-tauri/src` — desktop core: `jobs.rs` (resolve + downloads + progress), `tools.rs` (one-time `yt-dlp`/`ffmpeg` fetch), `media.rs` (play/reveal/trash guards).
- `backend/app` — relay API: `resolve` → `prepare` → `stream` / `mux` (+ `mux-progress`) / `subs` / `health`.
- `e2e/` — Playwright specs (mocked API routes) + README screenshot spec.
- `docs/screenshots/` — wide UI captures embedded in the README.

## How it is done

Resolving a URL returns video metadata (formats, audio tracks grouped by language with original detection, manual captions only) or, for `list=` URLs, a playlist with up to 50 flat entries. The desktop sidecar shells out to `yt-dlp --dump-single-json` with an NDJSON fallback; the backend uses the `yt-dlp` Python API. Both shapes converge on one frontend normalizer.

Preparing picks direct stream URLs (progressive single file preferred, merged pairs otherwise, manifests only as fallback). Downloads stream to disk with ranged resume, parallel parts for large files, and server-side merge when needed. Playlist batches filter the user's video selection and run at the Settings concurrency; desktop saves per-file outputs, web zips them. The queue is virtualized, progress aggregates done/total · % · speed, and cancel flips rows to `cancelled` (kept until cleared).

## Setup

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

Ports: frontend `:5173` (strict), backend `:8000`. Only `youtube.com` / `youtu.be` / `music.youtube.com` URLs are accepted (SSRF allowlist).

## Settings reference

`maxConcurrent` 1–8 (default 4, paces every batch) · `showThumbnails` (default on, gates every thumbnail surface) · `outDir` + `splitKinds` (desktop folder) · `showAdvanced` · download defaults (format/quality/containers/codecs) · theme/seed/variant · locale · auto-update check.

## Tests (everything must stay green)

```bash
cd frontend && npx vitest run        # unit (incl. QueueView render smoke test)
cd src-tauri && cargo test           # sidecar
./.venv/bin/pytest backend -q        # relay backend
cd e2e && npx playwright test        # end-to-end + a11y
```

README screenshots (wide, mocked, English):

```bash
cd e2e && npx playwright test -c screenshots.config.ts   # writes docs/screenshots/
```

## Releases (manual)

Test, approve, bump versions (`frontend/package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`), commit, push, then run the **Release** workflow (Actions → Release → Run workflow with a version like `v1.1.0`). It attaches the artifacts to a **draft** release — publish the draft by hand after testing the builds.

## Troubleshooting

- **First-launch tool fetch fails:** check connectivity; retry from a fresh launch (one-time `yt-dlp`/`ffmpeg` download).
- **Blank window:** open the console — render throws are covered by the `QueueView` smoke test, so re-run `npx vitest run src/components/QueueView.test.tsx`.
- **Port taken:** `:5173` is strict on purpose (the Tauri webview targets it); free it instead of drifting.
- **Backend API details:** see [`backend/README.md`](./backend/README.md).
