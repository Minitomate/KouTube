"""GET /api/subs — captions-only download: one manual subtitle file per call.

Manual tracks only (never automatic_captions). The frontend loops over the
selected languages and zips multiple files client-side.
"""
from __future__ import annotations
from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import PlainTextResponse
from app.services import limits as L

from app.services import ytdlp as Y
from app.services.security import normalize_to_url, sanitize_filename

router = APIRouter()


@router.get("/subs")
@L.limiter.limit("30/minute")
async def subs(url: str, lang: str, request: Request):
    try:
        page = normalize_to_url(url)
    except ValueError as exc:
        raise HTTPException(status_code=400,
                            detail={"code": "invalid-url", "message": str(exc)})
    try:
        info = await run_in_threadpool(Y.extract_info, page, False)
    except Exception as exc:  # noqa: BLE001
        code, msg = Y.classify_error(exc)
        raise HTTPException(status_code=400, detail={"code": code, "message": msg})
    manual_langs = {c.lang for c in Y.filter_manual_captions(info)}
    if lang not in manual_langs:
        raise HTTPException(status_code=400, detail={
            "code": "no-captions", "message": "No manual captions for this language."})
    try:
        texts = await run_in_threadpool(Y.fetch_sub_texts, page, [lang], "srt")
    except Exception as exc:  # noqa: BLE001
        code, msg = Y.classify_error(exc)
        raise HTTPException(status_code=400, detail={"code": code, "message": msg})
    text = (texts or {}).get(lang)
    if not text:
        raise HTTPException(status_code=400, detail={
            "code": "no-captions", "message": "Subtitles came back empty."})
    vid = (info or {}).get("id", "")
    title = (info or {}).get("title", "video")
    filename = f"{sanitize_filename(title)} [{vid}] [{lang}].srt"
    return PlainTextResponse(text, headers={
        "Content-Disposition": f'attachment; filename="{filename}"'})
