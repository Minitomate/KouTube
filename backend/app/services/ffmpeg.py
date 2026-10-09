"""FFmpeg version probe."""
from __future__ import annotations
import shutil
import subprocess


def get_ffmpeg_version() -> str | None:
    exe = shutil.which("ffmpeg")
    if not exe:
        return None
    try:
        p = subprocess.run([exe, "-version"], capture_output=True, text=True, timeout=10)
        line = (p.stdout or "").splitlines()[0] if p.stdout else ""
        return line.strip() or "ffmpeg"
    except Exception:
        return "ffmpeg (unprobeable)"
