"""POST /api/prepare — resolve choices into one-shot signed stream/mux tokens.

No bytes are downloaded here and nothing is stored. googlevideo URLs stay
fresh because tokens expire in 10 minutes while upstream URLs last hours.
"""
from __future__ import annotations
from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from app.services import limits as L

from app.models import PrepareRequest, PrepareResponse
from app.services import ytdlp as Y
from app.services import tokens as T
from app.services.security import normalize_to_url, sanitize_filename

router = APIRouter()


@router.post("/prepare", response_model=PrepareResponse)
@L.limiter.limit("30/minute")
async def prepare(req: PrepareRequest, request: Request):
    try:
        url = normalize_to_url(req.url or req.videoId or "")
    except ValueError as exc:
        raise HTTPException(status_code=400,
                            detail={"code": "invalid-url", "message": str(exc)})
    try:
        info = await run_in_threadpool(Y.extract_info, url, False)
    except Exception as exc:  # noqa: BLE001
        code, msg = Y.classify_error(exc)
        raise HTTPException(status_code=400, detail={"code": code, "message": msg})
    if (info or {}).get("_type") == "playlist" or "entries" in (info or {}):
        raise HTTPException(status_code=400, detail={
            "code": "is-playlist",
            "message": "Playlist URL: prepare each video separately for ZIP batch."})
    try:
        streams = Y.pick_streams(info, req.container, req.quality, req.audioTrackLang)
    except ValueError:
        raise HTTPException(status_code=400, detail={
            "code": "no-formats", "message": "No downloadable formats for these choices."})
    # Manual captions only: intersect requested langs with actual manual tracks.
    manual_langs = {c.lang for c in Y.filter_manual_captions(info)}
    embed = [lang for lang in (req.embedCaptions or []) if lang in manual_langs]
    vid = (info or {}).get("id", "")
    title = (info or {}).get("title", "video")
    filename = f"{sanitize_filename(title)} [{vid}].{req.container}"
    payload = {"u": url, "v": streams["video_url"], "a": streams["audio_url"],
               "vd": streams["video_direct"], "ad": streams["audio_direct"],
               "c": req.container, "s": list(embed), "f": req.subFormat,
               "n": filename}
    stream_token = T.mint("stream", payload)
    mux_token = T.mint("mux", payload) if (streams["merge_required"] or embed) else None
    return PrepareResponse(
        filename=filename, container=req.container,
        mergeRequired=bool(streams["merge_required"] or embed),
        sizeEstimate=streams["size_estimate"],
        streamToken=stream_token, muxToken=mux_token,
        captions=sorted(manual_langs),
    )
