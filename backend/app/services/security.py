"""SSRF allowlist + filename sanitizing."""
from __future__ import annotations
import re
from urllib.parse import urlparse

ALLOWED_HOSTS = {
    "youtube.com", "www.youtube.com", "m.youtube.com",
    "youtu.be", "www.youtu.be",
    "music.youtube.com", "www.music.youtube.com",
}

_YT_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
_BAD_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def validate_url(url: str) -> str:
    """Allowlist check (SSRF guard). Returns normalized URL or raises ValueError."""
    url = (url or "").strip()
    if not url:
        raise ValueError("empty url")
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    try:
        host = (urlparse(url).hostname or "").lower()
    except Exception:
        raise ValueError("invalid url")
    if host not in ALLOWED_HOSTS:
        raise ValueError(f"host not allowed: {host}")
    return url


def normalize_to_url(video_id_or_url: str) -> str:
    s = (video_id_or_url or "").strip()
    if _YT_ID.match(s):
        return f"https://www.youtube.com/watch?v={s}"
    return validate_url(s)


def sanitize_filename(name: str, max_len: int = 120) -> str:
    name = _BAD_CHARS.sub("", name).strip().strip(".")
    name = re.sub(r"\s+", " ", name) or "video"
    if len(name) > max_len:
        name = name[:max_len].rstrip()
    return name


def safe_job_id(job_id: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_-]{8,64}", job_id or ""):
        raise ValueError("invalid job id")
    return job_id
