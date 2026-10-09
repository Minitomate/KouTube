from __future__ import annotations
from contextlib import asynccontextmanager
import structlog

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import resolve, download, jobs, files, health
from app.services import queue as Q
from app.services.cleanup import start_cleanup, stop_cleanup

structlog.configure(processors=[structlog.processors.JSONRenderer()])


@asynccontextmanager
async def lifespan(app: FastAPI):
    start_cleanup(Q.DOWNLOADS_DIR, Q.jobs)
    yield
    stop_cleanup()


app = FastAPI(title="KouTube API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(resolve.router, prefix="/api")
app.include_router(download.router, prefix="/api")
app.include_router(jobs.router, prefix="/api")
app.include_router(files.router, prefix="/api")
app.include_router(health.router, prefix="/api")


@app.get("/")
async def root():
    return {"name": "KouTube API", "health": "/api/health"}
