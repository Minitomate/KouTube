from __future__ import annotations
from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool

from app.services.ffmpeg import get_ffmpeg_version

router = APIRouter()


@router.get("/health")
async def health():
    ffmpeg = await run_in_threadpool(get_ffmpeg_version)
    try:
        from yt_dlp.version import __version__ as ytdlp_version
    except Exception:
        ytdlp_version = "unknown"
    return {"status": "ok", "ytdlp": ytdlp_version, "ffmpeg": ffmpeg}
