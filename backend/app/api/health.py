from __future__ import annotations
from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool

from app.services.ffmpeg import get_ffmpeg_version

router = APIRouter()


@router.get("/health")
async def health():
    import yt_dlp
    ffmpeg = await run_in_threadpool(get_ffmpeg_version)
    return {"status": "ok", "ytdlp": getattr(yt_dlp, "__version__", "unknown"), "ffmpeg": ffmpeg}
