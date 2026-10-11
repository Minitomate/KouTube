"""yt-dlp helpers: resolve filtering, error taxonomy, download opts."""
from __future__ import annotations
import structlog
from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError

from app.models import (
    AudioTrack, CaptionTrack, FormatInfo, PlaylistEntry,
    AUDIO_ONLY,
)
from app.services.security import sanitize_filename

log = structlog.get_logger()

BASE_OPTS: dict = {
    "quiet": True,
    "no_warnings": True,
    "noplaylist": True,
    "socket_timeout": 15,
    "retries": 2,
    "writeautomaticsub": False,  # never auto captions
}

# (match substring in lowered yt-dlp message) -> (code, friendly message, http status)
ERROR_TAXONOMY: list[tuple[str, str, str]] = [
    ("private video", "private", "This video is private."),
    ("video unavailable", "deleted", "This video is unavailable or deleted."),
    ("this video is unavailable", "deleted", "This video is unavailable or deleted."),
    ("this video is no longer available", "deleted", "This video is no longer available."),
    ("age", "age-restricted", "This video is age-restricted and cannot be downloaded anonymously."),
    ("sign in to confirm your age", "age-restricted", "This video is age-restricted."),
    ("not available in your country", "region-blocked", "This video is blocked in your region."),
    ("geo restricted", "region-blocked", "This video is blocked in your region."),
    ("requested format is not available", "no-formats", "No downloadable formats found for this video."),
    ("no video formats found", "no-formats", "No downloadable formats found for this video."),
    ("live stream recording is not available", "live-upcoming", "Live stream recording is not available."),
    ("this live event will begin", "live-upcoming", "This live event has not started yet."),
    ("premiere will begin", "live-upcoming", "This premiere has not started yet."),
]


def classify_error(exc: Exception) -> tuple[str, str]:
    msg = str(exc).lower()
    for needle, code, friendly in ERROR_TAXONOMY:
        if needle in msg:
            return code, friendly
    if isinstance(exc, DownloadError):
        return "download-error", f"Download failed: {exc}"
    return "download-error", f"Unexpected error: {exc}"


def filter_manual_captions(info: dict) -> list[CaptionTrack]:
    """Manual captions ONLY from info['subtitles']; never automatic_captions; exclude live_chat."""
    subs = info.get("subtitles") or {}
    out: list[CaptionTrack] = []
    for lang, tracks in subs.items():
        if lang == "live_chat":
            continue
        label = lang
        try:
            if tracks and isinstance(tracks, list) and tracks[0].get("name"):
                label = f"{lang} - {tracks[0]['name']}"
        except Exception:
            pass
        out.append(CaptionTrack(lang=lang, label=label))
    return sorted(out, key=lambda c: c.lang)


def group_audio_tracks(info: dict) -> list[AudioTrack]:
    """Group audio streams by language; original via format_note marker, else first."""
    seen: dict[str, AudioTrack] = {}
    candidates = list(info.get("requested_formats") or []) + list(info.get("formats") or [])
    for f in candidates:
        lang = (f.get("language") or "").strip() or "und"
        marked = "original" in (f.get("format_note") or "").lower()
        if lang not in seen:
            seen[lang] = AudioTrack(lang=lang, label=lang, is_default=False, is_original=marked)
        elif marked:
            seen[lang].is_original = True
    tracks = list(seen.values())
    if tracks and not any(t.is_original for t in tracks):
        tracks[0].is_default = True
        tracks[0].is_original = True
    try:
        import pycountry  # nicer labels when available
        for t in tracks:
            if len(t.lang) in (2, 3) and t.lang != "und":
                try:
                    lang = pycountry.languages.get(alpha_2=t.lang) or pycountry.languages.get(alpha_3=t.lang)
                    if lang and hasattr(lang, "name"):
                        t.label = f"{lang.name} ({t.lang})"
                except Exception:
                    pass
    except ImportError:
        pass
    return tracks


def collect_formats(info: dict) -> list[FormatInfo]:
    seen: set[int] = set()
    out: list[FormatInfo] = []
    for f in info.get("formats") or []:
        h = f.get("height")
        if h and h not in seen and (f.get("vcodec") or "none") != "none":
            seen.add(h)
            out.append(FormatInfo(
                height=h, ext=f.get("ext") or "",
                fps=f.get("fps"), filesize=f.get("filesize") or f.get("filesize_approx"),
                vcodec=f.get("vcodec"), acodec=f.get("acodec"),
            ))
    return sorted(out, key=lambda x: x.height or 0)


_AVATAR_CACHE: dict[str, str | None] = {}


def pick_avatar(thumbnails: list[dict]) -> str | None:
    """Priority: avatar_uncropped, avatar-ish id, non-banner google image."""
    scored: list[tuple[int, str]] = []
    for t in thumbnails or []:
        url = t.get("url") or ""
        tid = t.get("id") or ""
        if tid == "avatar_uncropped" and url:
            scored.append((0, url))
        elif "avatar" in tid and url:
            scored.append((1, url))
        elif "googleusercontent" in url and "=w" not in url:
            scored.append((2, url))
    scored.sort(key=lambda p: p[0])
    return scored[0][1] if scored else None


def fetch_avatar(channel_url: str | None) -> str | None:
    """Best-effort channel avatar (avatar_uncropped), cached, 10s budget."""
    if not channel_url:
        return None
    if channel_url in _AVATAR_CACHE:
        return _AVATAR_CACHE[channel_url]
    out: str | None = None
    try:
        opts = {**BASE_OPTS, "skip_download": True, "playlist_items": "0",
                "socket_timeout": 8}
        with YoutubeDL(opts) as ydl:
            info = ydl.extract_info(channel_url, download=False) or {}
        out = pick_avatar(info.get("thumbnails") or [])
    except Exception:
        out = None
    _AVATAR_CACHE[channel_url] = out
    return out


def channel_fields(info: dict) -> dict:
    return {
        "description": info.get("description") or "",
        "channel": info.get("channel") or info.get("uploader"),
        "channelUrl": info.get("channel_url") or info.get("uploader_url"),
        "channelVerified": info.get("channel_is_verified"),
        "subscribers": info.get("channel_follower_count"),
        "views": info.get("view_count"),
        "uploadDate": info.get("upload_date") or info.get("release_date"),
        "timestamp": info.get("timestamp") or info.get("release_timestamp"),
    }


def build_resolve_payload(info: dict, avatar: str | None = None) -> dict:
    if info.get("_type") == "playlist" or "entries" in info:
        entries: list[PlaylistEntry] = []
        for e in (info.get("entries") or [])[:50]:
            if not e:
                continue
            vid = e.get("id") or ""
            entries.append(PlaylistEntry(
                videoId=vid, title=e.get("title") or vid,
                duration=e.get("duration"), thumbnail=e.get("thumbnail"),
            ))
        return {
            "videoId": None,
            "title": info.get("title") or "Playlist",
            "thumbnail": info.get("thumbnail"),
            "duration": None,
            "formats": [], "audioTracks": [], "manualCaptions": [],
            "is_playlist": True, "entries": entries,
        }
    thumbs = info.get("thumbnail")
    return {
        "videoId": info.get("id"),
        "title": info.get("title") or "",
        "thumbnail": thumbs,
        "duration": info.get("duration"),
        **channel_fields(info),
        "avatarUrl": avatar,
        "formats": collect_formats(info),
        "audioTracks": group_audio_tracks(info),
        "manualCaptions": filter_manual_captions(info),
        "is_playlist": False, "entries": [],
    }


def resolve_full(url: str) -> dict:
    """Blocking end-to-end resolve for threadpool use (extract+avatar+shape)."""
    info = extract_info(url, "list=" in url)
    if (info or {}).get("_type") == "playlist" or "entries" in (info or {}):
        return build_resolve_payload(info)
    avatar = fetch_avatar((info or {}).get("uploader_url") or (info or {}).get("channel_url"))
    return build_resolve_payload(info or {}, avatar)


def extract_info(url: str, playlist: bool = False) -> dict:
    opts = {**BASE_OPTS, "noplaylist": not playlist,
            "extract_flat": "in_playlist" if playlist else False}
    if playlist:
        opts["playlistend"] = 50  # cap flat pagination: we only keep 50 entries
    with YoutubeDL(opts) as ydl:
        return ydl.extract_info(url, download=False)


def quality_format(quality: int | str, container: str) -> str:
    if container in AUDIO_ONLY:
        return "bestaudio/best"
    if quality == "best":
        return "bestvideo+bestaudio/best"
    q = int(quality)
    return f"bestvideo[height<={q}]+bestaudio/best[height<={q}]/best"


def build_ydl_opts(job_dir: str, req, progress_hook) -> dict:
    audio_only = req.container in AUDIO_ONLY
    fmt = quality_format(req.quality, req.container)
    postprocessors: list[dict] = []
    if audio_only:
        postprocessors.append({
            "key": "FFmpegExtractAudio",
            "preferredcodec": req.container,
            "preferredquality": "0",
        })
    elif req.container in ("mp4", "webm", "mkv"):
        postprocessors.append({"key": "FFmpegVideoConvertor", "preferedformat": req.container})
    if req.embedCaptions:
        postprocessors.append({
            "key": "FFmpegEmbedSubtitle",
            "already_have_subtitle": False,
        })
    if req.separateCaptions and req.embedCaptions:
        postprocessors.append({
            "key": "FFmpegSubtitlesConvertor",
            "format": req.subFormat,
        })
    opts: dict = {
        **BASE_OPTS,
        "format": fmt,
        "outtmpl": "%(title)s [%(id)s].%(ext)s",
        "paths": {"home": job_dir},
        "merge_output_format": None if audio_only else req.container,
        "postprocessors": postprocessors,
        "writesubtitles": bool(req.embedCaptions or req.separateCaptions),
        "writeautomaticsub": False,
        "subtitleslangs": list(req.embedCaptions or []),
        "subtitlesformat": req.subFormat,
        "progress_hooks": [progress_hook],
    }
    return opts


def truncated_outtmpl(title: str, vid: str, ext: str) -> str:
    return f"{sanitize_filename(title)} [{vid}].{ext}"


def _height_of(f: dict) -> int:
    try:
        return int(f.get("height") or 0)
    except (TypeError, ValueError):
        return 0


def _is_direct(f: dict) -> bool:
    return (f.get("protocol") or "https") in ("http", "https")


_VCODEC_PREFIXES = {
    "avc": ("avc1", "avc"),
    "hevc": ("hev", "hvc", "hevc", "h265"),
    "vp9": ("vp09", "vp9"),
    "av1": ("av01", "av1"),
}


def _vcodec_ok(vcodec: str | None, codec: str | None) -> bool:
    if not codec or codec == "auto":
        return True
    v = (vcodec or "").lower()
    if not v or v == "none":
        return False
    return v.startswith(_VCODEC_PREFIXES.get(codec, (codec,)))


def pick_streams(info: dict, container: str, quality: int | str,
                 audio_lang: str | None = None, codec: str | None = None) -> dict:
    """Pick direct stream URLs from a full (non-flat) info dict.

    Returns {video_url, audio_url|None, merge_required, size_estimate,
    video_direct, audio_direct}. Manifest-based formats (HLS/DASH) are only
    chosen when no plain-HTTP format exists; mux lets ffmpeg fetch those.
    Raises ValueError('no-formats') when nothing usable is found.
    """
    formats = [f for f in (info.get("formats") or []) if f.get("url")]
    if not formats:
        raise ValueError("no-formats")
    audio_only = container in AUDIO_ONLY

    def audio_pool() -> list[dict]:
        pool = [f for f in formats if (f.get("acodec") or "none") != "none"]
        if audio_lang:
            # Prefix match: YouTube tags dubs en-US/es-419; exact match fails.
            lang_match = [f for f in pool if (f.get("language") or "").startswith(audio_lang)]
            if lang_match:
                pool = lang_match
        pool = sorted(pool, key=lambda f: (f.get("abr") or 0, f.get("tbr") or 0),
                      reverse=True)
        direct = [f for f in pool if _is_direct(f)]
        return direct or pool

    if audio_only:
        pool = audio_pool()
        if not pool:
            raise ValueError("no-formats")
        best = pool[0]
        return {"video_url": None, "audio_url": best["url"],
                "merge_required": False,
                "size_estimate": best.get("filesize") or best.get("filesize_approx"),
                "video_direct": True, "audio_direct": _is_direct(best)}

    q = None if quality == "best" else int(quality)
    videos = [f for f in formats
              if (f.get("vcodec") or "none") != "none"
              and _vcodec_ok(f.get("vcodec"), codec)]
    if q is not None:
        capped = [f for f in videos if _height_of(f) <= q]
        videos = capped or videos
    # Prefer progressive (muxed) single file at/below requested quality: no merge.
    progressive = [f for f in videos
                   if (f.get("acodec") or "none") != "none"
                   and (q is None or _height_of(f) <= q)]
    prog_direct = [f for f in progressive if _is_direct(f)]
    if prog_direct or progressive:
        best = sorted(prog_direct or progressive,
                      key=lambda f: (_height_of(f), f.get("tbr") or 0),
                      reverse=True)[0]
        return {"video_url": best["url"], "audio_url": None,
                "merge_required": False,
                "size_estimate": best.get("filesize") or best.get("filesize_approx"),
                "video_direct": _is_direct(best), "audio_direct": True}
    pool = sorted(videos, key=lambda f: (_height_of(f), f.get("tbr") or 0),
                  reverse=True)
    direct_pool = [f for f in pool if _is_direct(f)]
    videos = direct_pool or pool
    audios = audio_pool()
    if not videos or not audios:
        raise ValueError("no-formats")
    size = ((videos[0].get("filesize") or videos[0].get("filesize_approx") or 0)
            + (audios[0].get("filesize") or audios[0].get("filesize_approx") or 0)) or None
    return {"video_url": videos[0]["url"], "audio_url": audios[0]["url"],
            "merge_required": True, "size_estimate": size,
            "video_direct": _is_direct(videos[0]),
            "audio_direct": _is_direct(audios[0])}


def fetch_sub_texts(url: str, langs: list[str], fmt: str = "srt") -> dict[str, str]:
    """Download manual subtitle texts to an OS-temp dir and return {lang: text}."""
    import os
    import tempfile
    if not langs:
        return {}
    tmp = tempfile.mkdtemp(prefix="koutube-subs-")
    opts = {**BASE_OPTS, "skip_download": True, "writesubtitles": True,
            "writeautomaticsub": False, "subtitleslangs": list(langs),
            "subtitlesformat": fmt,
            "outtmpl": os.path.join(tmp, "%(id)s.%(ext)s")}
    with YoutubeDL(opts) as ydl:
        ydl.extract_info(url, download=True)
    out: dict[str, str] = {}
    for fname in os.listdir(tmp):
        fpath = os.path.join(tmp, fname)
        try:
            # yt-dlp names subtitle files <id>.<lang>.<ext>
            parts = fname.rsplit(".", 2)
            lang = parts[1] if len(parts) == 3 else fname
            with open(fpath, encoding="utf-8", errors="replace") as fh:
                out[lang] = fh.read()
        except OSError:
            pass
        finally:
            try:
                os.remove(fpath)
            except OSError:
                pass
    try:
        os.rmdir(tmp)
    except OSError:
        pass
    return out
