# KouTube frontend

Vite + React 18 + TS. Compact M3-Expressive-style UI (max-w 640px).

## Run

```sh
cd frontend
npm install
npm run dev      # proxied /api -> http://localhost:8000
npm run build
```

## API contract (backend)

- `POST /api/resolve {url}` → `MediaInfo`
- `POST /api/download {url, format, quality, audioTrack, captions[]}` → `{job_id}`
- `GET /api/jobs/:id/events` (SSE `{progress, status, file?}`)
- `GET /api/jobs/:id/files` → `{files: {name, url}[]}`
- `DELETE /api/jobs/:id`, `POST /api/jobs/:id/retry`

## Upgrade path to @language-lit/material3-expressive

CSS tokens in `src/theme.css` mirror M3 roles (`--primary`, `--surface-container`, pill radius 999px).
To migrate: `npm i @language-lit/material3-expressive`, swap `.pill-btn` → `md-filled-button`,
`.chip` → `md-filter-chip`, `.segmented` → `md-segmented-button`; keep aria-labels as-is.
