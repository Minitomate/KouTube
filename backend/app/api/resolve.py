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
        info = await run_in_threadpool(Y.extract_info, url, False)
    except ValueError:
        raise
    except Exception as exc:  # noqa: BLE001
        # playlist fallback: try flat extract
        try:
            info = await run_in_threadpool(Y.extract_info, url, True)
        except Exception as exc2:  # noqa: BLE001
            code, msg = Y.classify_error(exc2 if "entries" in str(exc2).lower() else exc)
            raise HTTPException(status_code=400, detail={"code": code, "message": msg})
    payload = Y.build_resolve_payload(info or {})
    return payload
