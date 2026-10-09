# KouTube — Stitch UI mockups (Material 3 Expressive, pill-like)

Stitch project: `projects/10660069281690267134` — title `KouTube`
Design system: `assets/17027348178686597966` — `KouTube M3 Expressive`
- Seed `#6750A4`, variant `EXPRESSIVE`, roundness `ROUND_FULL`, fonts `Inter`
- Tokens applied to screens v2 (light). Dark variant pending.

## Screens generated
1. Home (`screens/ac1b99d98e4f40de8d8d59279a10159b`) — compact 640px column, 56px pill URL input + Paste, filled Inspect CTA, tonal/outlined preset pills, recent downloads cards.
   Screenshot: `https://lh3.googleusercontent.com/aida/AEtjO1WOLigxKZ5vSQc1qKXJjHglfrd5ZBPnq_nTCRZdng0DVC1ScxxW63DjAlXPbIPBwn4gFHyQf5tSm8ixHssyuN_LP7S0e6RsYZI-iPC7ApGPZ-ctsa0VAzePKB1a1qZAfeSCqEFooEqdAGuq6etvOqUM-BCvZ8x3ReyipveHtpgl_XQ63JY2SMONLIJqR4RVfh-w5SnRBG_EePG6MvD5GpWEQumfpgJtqToiMYDucXuE5B3y7R5-6kYP1boS`
2. Inspect & Customize (`screens/f0a07ab181b34ac0bb7497d1593cea60`) — thumbnail + meta, segmented Video|Audio pill, quality tonal chips 360p–4K + codec badges, audio outlined dropdown (original default), captions chips + `Manual Captions Only` badge, embed/sidecar switches, sticky Download CTA.
   Screenshot: `https://lh3.googleusercontent.com/aida/AEtjO1UMXGZbL8kmajjyA0Y5PHQBZ4kqO1vhz7LmA2HCA5ob2rFBl-Nl_sjUIS1lMm_EqpgMFFHv8fWuaaMK4GU1KzmAEmtTh-alaaMudz1yHHuJjMxCr6EyXR97rJukH9g9K-2HDmVSosXrnak8mm-AisfE6KH5tAJXbGCPJD9UqHmBt9i7Vu_JAUVlIRonSx86t_4U9aU_awSKXM_JlXvO3yc5OgqKHVafIGyqAfhFhaKikeav2ZjxLNgE-HyT`
3. Queue/Batch — generation hit Stitch `service unavailable`; retry with same prompt + designSystem above. Must include: playlist header, global defaults pill bar, per-row pickers + progress pills (downloading/merging/done/error+retry), Start-all + Clear-finished sticky bar. Request dark-mode tokens in retry.

## Frontend mapping (`frontend/src/theme.css`)
Pill radius 999px, h 48–56px, filled/tonal/outlined/text/segmented variants mirror Stitch tokens. Upgrade path: `@language-lit/material3-expressive`.
