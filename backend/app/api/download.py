from __future__ import annotations
import uuid
from fastapi import APIRouter, HTTPException

from app.models import DownloadRequest, DownloadResponse
from app.services import queue as Q
from app.services.security import normalize_to_url

router = APIRouter()

MAX_BATCH = 50


@router.post("/download", response_model=DownloadResponse)
async def download(req: DownloadRequest):
    if not (req.url or req.videoId):
        raise HTTPException(status_code=400,
                            detail={"code": "invalid-url", "message": "url or videoId required"})
    try:
        url = normalize_to_url(req.url or req.videoId or "")
        req.url = url
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"code": "invalid-url", "message": str(exc)})
    # playlist batch: resolve entries then enqueue up to 50
    batch_id: str | None = None
    first_job = None
    try:
        from app.services import ytdlp as Y
        from fastapi.concurrency import run_in_threadpool
        info = await run_in_threadpool(Y.extract_info, url, True)
        entries = (info or {}).get("entries")
        if entries:
            batch_id = uuid.uuid4().hex[:12]
            count = 0
            for e in entries[:MAX_BATCH]:
                if not e:
                    continue
                vid = e.get("url") or (f"https://www.youtube.com/watch?v={e.get('id')}" if e.get("id") else None)
                if not vid:
                    continue
                import copy
                r2 = copy.copy(req)
                r2.url = vid
                job = Q.enqueue(r2, batch_id)
                if first_job is None:
                    first_job = job
                count += 1
            if first_job:
                return DownloadResponse(jobId=first_job.id, batchId=batch_id)
    except HTTPException:
        raise
    except Exception:
        pass  # not a playlist -> single download below
    try:
        job = Q.enqueue(req, batch_id)
    except ValueError as exc:
        if "disk-cap" in str(exc):
            raise HTTPException(status_code=507,
                                detail={"code": "disk-cap-exceeded",
                                        "message": "Server storage is full. Try again later."})
        raise HTTPException(status_code=400, detail={"code": "invalid-url", "message": str(exc)})
    return DownloadResponse(jobId=job.id, batchId=job.batch_id)
