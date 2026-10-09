from __future__ import annotations
import os
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.services import queue as Q
from app.services.security import safe_job_id

router = APIRouter()


@router.get("/files/{job_id}")
async def serve_file(job_id: str):
    try:
        safe_job_id(job_id)  # path traversal guard: strict id charset
    except ValueError:
        raise HTTPException(status_code=400, detail={"code": "invalid-job", "message": "invalid job id"})
    job = Q.get_job(job_id)
    if not job or not job.filepath:
        raise HTTPException(status_code=404, detail={"code": "not-found", "message": "file not found"})
    # resolve + ensure inside downloads dir
    base = os.path.realpath(Q.DOWNLOADS_DIR)
    real = os.path.realpath(job.filepath)
    if os.path.commonpath([base, real]) != base or not os.path.isfile(real):
        raise HTTPException(status_code=404, detail={"code": "not-found", "message": "file not found"})
    return FileResponse(real, filename=job.filename or "download",
                        headers={"Content-Disposition": f'attachment; filename="{job.filename or "download"}"'})
