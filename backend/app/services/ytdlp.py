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
    """Group requested_formats/formats audio streams by language; first = original default."""
    seen: dict[str, AudioTrack] = {}
    candidates = list(info.get("requested_formats") or []) + list(info.get("formats") or [])
    for f in candidates:
        lang = (f.get("language") or "").strip() or "und"
        if lang not in seen:
            seen[lang] = AudioTrack(lang=lang, label=lang, is_default=False)
    tracks = list(seen.values())
    if tracks:
        # 'und' or first track is the original
        tracks[0].is_default = True
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


def build_resolve_payload(info: dict) -> dict:
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
        "formats": collect_formats(info),
        "audioTracks": group_audio_tracks(info),
        "manualCaptions": filter_manual_captions(info),
        "is_playlist": False, "entries": [],
    }


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
