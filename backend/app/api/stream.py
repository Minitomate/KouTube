"""GET /api/stream?token= — transient Range-capable relay. Nothing stored.

Token must have been minted by /api/prepare (HMAC, 10 min TTL).
"""
from __future__ import annotations
import httpx
import structlog
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask

from app.services import tokens as T

router = APIRouter()
log = structlog.get_logger()
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"}


@router.get("/stream")
async def stream(token: str, request: Request):
    try:
        data = T.verify("stream", token)
    except ValueError as exc:
        raise HTTPException(status_code=403 if "invalid" in str(exc) else 410,
                            detail={"code": "bad-token", "message": str(exc)})
    upstream = data.get("v") or data.get("a")
    if not upstream or not upstream.startswith("https://"):
        raise HTTPException(status_code=400,
                            detail={"code": "bad-token", "message": "no upstream URL"})
    headers = {"User-Agent": UA["User-Agent"]}
    if request.headers.get("range"):
        headers["Range"] = request.headers["range"]
    client = httpx.AsyncClient(timeout=httpx.Timeout(30.0, read=None), follow_redirects=True)
    try:
        r = await client.send(client.build_request("GET", upstream, headers=headers),
                              stream=True)
    except httpx.RequestError as exc:
        await client.aclose()
        raise HTTPException(status_code=502,
                            detail={"code": "upstream", "message": f"upstream error: {exc}"})
    if r.status_code not in (200, 206):
        await r.aclose()
        await client.aclose()
        raise HTTPException(status_code=502, detail={
            "code": "upstream", "message": f"upstream status {r.status_code}"})

    async def relay():
        try:
            async for chunk in r.aiter_bytes(64 * 1024):
                if await request.is_disconnected():
                    break
                yield chunk
        except (httpx.RequestError, httpx.StreamClosed) as exc:
            # Upstream throttled/dropped mid-transfer: end the response so the
            # client sees EOF and its truncation detector fires (error state,
            # never a silent hang).
            log.warning("upstream interrupted", error=str(exc))
        finally:
            await r.aclose()
            await client.aclose()

    out_headers = {"Accept-Ranges": "bytes",
                   "Content-Disposition": f'attachment; filename="{data.get("n", "video")}"'}
    for h in ("content-length", "content-range", "content-type"):
        if r.headers.get(h):
            out_headers[h] = r.headers[h]
    return StreamingResponse(relay(),
                             status_code=r.status_code,
                             headers=out_headers,
                             background=BackgroundTask(client.aclose))
