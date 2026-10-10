from __future__ import annotations
from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool

from app.models import ResolveRequest, ResolveResponse
from app.services import ytdlp as Y
from app.services.security import validate_url

router = APIRouter()


@router.post("/resolve", response_model=ResolveResponse)
async def resolve(req: ResolveRequest):
    try:
        url = validate_url(req.url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"code": "invalid-url", "message": str(exc)})
    try:
        # resolve_full picks flat extract for playlists (fast) and full
        # extract + avatar for singles.
        return await run_in_threadpool(Y.resolve_full, url)
    except ValueError:
        raise
    except Exception as exc:  # noqa: BLE001
        code, msg = Y.classify_error(exc)
        raise HTTPException(status_code=400, detail={"code": code, "message": msg})
