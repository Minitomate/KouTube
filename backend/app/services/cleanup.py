"""TTL cleanup: delete job dirs older than 24h (apscheduler)."""
from __future__ import annotations
import os
import shutil
import time

import structlog
from apscheduler.schedulers.asyncio import AsyncIOScheduler

log = structlog.get_logger()
TTL_SECONDS = 24 * 3600

_scheduler: AsyncIOScheduler | None = None


def _sweep(downloads_dir: str, jobs_dict: dict) -> None:
    now = time.time()
    try:
        entries = os.listdir(downloads_dir)
    except FileNotFoundError:
        return
    for name in entries:
        path = os.path.join(downloads_dir, name)
        try:
            mtime = os.path.getmtime(path)
        except OSError:
            continue
        if now - mtime < TTL_SECONDS:
            continue
        try:
            if os.path.isdir(path):
                shutil.rmtree(path, ignore_errors=True)
            else:
                os.remove(path)
            jobs_dict.pop(name, None)
            log.info("cleaned job dir", path=path)
        except OSError as exc:
            log.warning("cleanup failed", path=path, error=str(exc))


def start_cleanup(downloads_dir: str, jobs_dict: dict) -> AsyncIOScheduler:
    global _scheduler
    if _scheduler:
        return _scheduler
    _scheduler = AsyncIOScheduler()
    _scheduler.add_job(_sweep, "interval", hours=1, args=[downloads_dir, jobs_dict])
    _scheduler.start()
    return _scheduler


def stop_cleanup() -> None:
    global _scheduler
    if _scheduler:
        _scheduler.shutdown(wait=False)
        _scheduler = None
