"""Asyncio job queue: concurrency 3, batchId, 2GB disk cap, SSE pub/sub."""
from __future__ import annotations
import asyncio
import os
import time
import uuid
from dataclasses import dataclass, field

import structlog
from fastapi.concurrency import run_in_threadpool
from yt_dlp import YoutubeDL

from app.models import JobStatus
from app.services import ytdlp as Y
from app.services.security import normalize_to_url

log = structlog.get_logger()

DOWNLOADS_DIR = os.environ.get("DOWNLOADS_DIR", os.path.join(os.path.dirname(__file__), "..", "..", "downloads"))
DISK_CAP_BYTES = 2 * 1024 * 1024 * 1024
MAX_CONCURRENT = 3


@dataclass
class Job:
    id: str
    batch_id: str | None
    url: str
    status: JobStatus = JobStatus.queued
    percent: float = 0.0
    title: str | None = None
    filepath: str | None = None
    filename: str | None = None
    error_code: str | None = None
    error: str | None = None
    created_at: float = field(default_factory=time.time)
    events: list[dict] = field(default_factory=list)
    subscribers: set[asyncio.Queue] = field(default_factory=set)


jobs: dict[str, Job] = {}
_sem = asyncio.Semaphore(MAX_CONCURRENT)


def dir_size(path: str) -> int:
    total = 0
    for root, _, files in os.walk(path):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    return total


def check_disk_cap() -> None:
    os.makedirs(DOWNLOADS_DIR, exist_ok=True)
    if dir_size(DOWNLOADS_DIR) >= DISK_CAP_BYTES:
        raise ValueError("disk-cap-exceeded")


def _publish(job: Job, event: dict) -> None:
    job.events.append(event)
    for q in list(job.subscribers):
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            pass


def set_status(job: Job, status: JobStatus, percent: float | None = None, **extra) -> None:
    job.status = status
    if percent is not None:
        job.percent = percent
    _publish(job, {"status": status.value, "percent": job.percent, **extra})


def get_job(job_id: str) -> Job | None:
    return jobs.get(job_id)


def create_job(url: str, batch_id: str | None = None) -> Job:
    job = Job(id=uuid.uuid4().hex[:12], batch_id=batch_id, url=url)
    jobs[job.id] = job
    _publish(job, {"status": "queued", "percent": 0.0})
    return job


async def run_job(job: Job, req) -> None:
    async with _sem:
        job_dir = os.path.join(DOWNLOADS_DIR, job.id)
        os.makedirs(job_dir, exist_ok=True)

        def hook(d: dict) -> None:
            st = d.get("status")
            if st == "downloading":
                total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
                done = d.get("downloaded_bytes") or 0
                pct = (done / total * 100) if total else 0.0
                job.percent = round(pct, 1)
                job.title = d.get("filename", job.title)
                _publish(job, {"status": "downloading", "percent": job.percent})
            elif st == "finished":
                _publish(job, {"status": "merging", "percent": 100.0})
                job.status = JobStatus.merging

        try:
            set_status(job, JobStatus.downloading, 0.0)
            opts = Y.build_ydl_opts(job_dir, req, hook)

            def _dl() -> dict:
                with YoutubeDL(opts) as ydl:
                    info = ydl.extract_info(job.url, download=True)
                    return info or {}

            info = await run_in_threadpool(_dl)
            set_status(job, JobStatus.postprocessing, 100.0)

            # Locate output file
            vid = (info or {}).get("id", "")
            title = (info or {}).get("title", "video")
            ext = req.container
            expected = Y.truncated_outtmpl(title, vid, ext)
            candidate = os.path.join(job_dir, expected)
            if not os.path.exists(candidate):
                # fallback: newest file in job dir
                files = [os.path.join(job_dir, f) for f in os.listdir(job_dir)
                         if os.path.isfile(os.path.join(job_dir, f))]
                candidate = max(files, key=os.path.getmtime) if files else candidate
            job.filepath = candidate if os.path.exists(candidate) else None
            job.filename = os.path.basename(job.filepath) if job.filepath else expected
            job.title = title
            set_status(job, JobStatus.done, 100.0,
                       filename=job.filename, title=title)
            _publish(job, {"status": "done", "percent": 100.0, "explicit_done": True})
        except Exception as exc:  # noqa: BLE001
            code, msg = Y.classify_error(exc)
            log.error("job failed", job_id=job.id, code=code, error=str(exc))
            job.error_code = code
            job.error = msg
            set_status(job, JobStatus.error, job.percent, code=code, message=msg)


def enqueue(req, batch_id: str | None = None) -> Job:
    check_disk_cap()
    url = normalize_to_url(req.url or req.videoId or "")
    job = create_job(url, batch_id)
    asyncio.get_event_loop().create_task(run_job(job, req))
    return job
