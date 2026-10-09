from __future__ import annotations
import asyncio
import json
from fastapi import APIRouter, HTTPException, Request
from sse_starlette.sse import EventSourceResponse

from app.services import queue as Q
from app.services.security import safe_job_id

router = APIRouter()


@router.get("/jobs/{job_id}")
async def job_status(job_id: str):
    try:
        safe_job_id(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail={"code": "invalid-job", "message": "invalid job id"})
    job = Q.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail={"code": "not-found", "message": "job not found"})
    return {
        "jobId": job.id, "batchId": job.batch_id, "status": job.status.value,
        "percent": job.percent, "title": job.title, "filename": job.filename,
        "code": job.error_code, "message": job.error,
    }


@router.get("/jobs/{job_id}/events")
async def job_events(job_id: str, request: Request):
    try:
        safe_job_id(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail={"code": "invalid-job", "message": "invalid job id"})
    job = Q.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail={"code": "not-found", "message": "job not found"})

    async def gen():
        q: asyncio.Queue = asyncio.Queue()
        job.subscribers.add(q)
        try:
            # replay current state first
            yield {"event": "message",
                   "data": json.dumps({"status": job.status.value, "percent": job.percent})}
            if job.status.value in ("done", "error"):
                yield {"event": "done", "data": json.dumps({"status": job.status.value})}
                return
            # replay history then stream
            for ev in job.events:
                yield {"event": "message", "data": json.dumps(ev)}
                if await request.is_disconnected():
                    return
            while True:
                if await request.is_disconnected():
                    break
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=20)
                except asyncio.TimeoutError:
                    yield {"event": "ping", "data": "{}"}
                    continue
                yield {"event": "message", "data": json.dumps(ev)}
                if ev.get("status") in ("done", "error") or ev.get("explicit_done"):
                    yield {"event": "done", "data": json.dumps(ev)}
                    break
        finally:
            job.subscribers.discard(q)

    return EventSourceResponse(gen())
