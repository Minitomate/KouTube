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
3. Queue/Batch (`screens/e324da2c3292444f905945583c3f53b8`) — playlist header, global defaults pill bar (MP4/1080p/Opus/CC), rows: downloading 64% + merging 98% + completed, sticky Start-all + Clear-finished.
   Screenshot: `https://lh3.googleusercontent.com/aida/AEtjO1XSjs0xCogEk4w0q747cj3DkgUE0o23ijMMExJ2IUu3fxQBZojVhuUUhOE8oQcvyYSzetLEFTXbrXt3DIwzkqUKB-WCETvygJi2uXZkP9grt1tPXtnNagyPWS90AqBljfv4n9EkXSwpSnab1QWpD4Z-LUS0Q2cCXasYgnMHmc6KKjy6RcVDdrsb_L2JWOouz8WbYzp_rcY2u2jFDR5CnTlZcf-AfwuGB_QZ5NlTByD45KuaGSQgPwc3veo`

## Frontend mapping (`frontend/src/theme.css`)
Pill radius 999px, h 48–56px, filled/tonal/outlined/text/segmented variants mirror Stitch tokens. Upgrade path: `@language-lit/material3-expressive`.
