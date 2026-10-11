from __future__ import annotations
from contextlib import asynccontextmanager
import structlog

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import resolve, prepare, stream, mux, health, subs
from app.services import tokens as _tokens  # noqa: F401 (token mint/verify side-effects)
from app.services import limits as L
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from fastapi.responses import JSONResponse

structlog.configure(processors=[structlog.processors.JSONRenderer()])

limiter = L.limiter


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(title="KouTube API", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded,
                          lambda req, exc: JSONResponse(
                              status_code=429,
                              content={"detail": {"code": "rate-limited",
                                                 "message": "Too many requests; slow down."}}))
app.add_middleware(SlowAPIMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(resolve.router, prefix="/api")
app.include_router(prepare.router, prefix="/api")
app.include_router(stream.router, prefix="/api")
app.include_router(mux.router, prefix="/api")
app.include_router(subs.router, prefix="/api")
app.include_router(health.router, prefix="/api")


@app.get("/")
async def root():
    return {"name": "KouTube API", "health": "/api/health"}
