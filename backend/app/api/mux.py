"""GET /api/mux?token= — staged merge+embed, served with exact length.

Inputs are fetched with ranged requests (full speed) to an OS-temp dir,
muxed locally to tmp/out, then streamed with Content-Length. Temp is removed
in `finally`. Max 2 concurrent muxes (429 when busy). No Range support.
Transient OS-temp use only — never the downloads/ dir.
"""
from __future__ import annotations
import asyncio
import os
import tempfile
import httpx
import structlog
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.services import tokens as T
from app.services import ytdlp as Y

router = APIRouter()
log = structlog.get_logger()
_MUX_SEM = asyncio.Semaphore(2)
CHUNK = 512 * 1024
MAX_STAGE_BYTES = 4 * 1024 * 1024 * 1024
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"}


async def _stage_url(client: httpx.AsyncClient, url: str, dest: str, rid: str,
                     what: str) -> int:
    """Fetch URL with ranged requests (defeats throttling), resume on stall."""
    loaded = 0
    total: int | None = None
    for attempt in range(4):
        headers = {**UA, "Range": f"bytes={loaded}-"}
        try:
            async with client.stream("GET", url, headers=headers) as r:
                if r.status_code not in (200, 206):
                    raise ValueError(f"upstream status {r.status_code}")
                if r.status_code == 206:
                    cr = r.headers.get("content-range", "")
                    m = cr.split("/")[-1].strip() if "/" in cr else ""
                    total = int(m) if m.isdigit() else total
                else:
                    total = int(r.headers["content-length"]) if r.headers.get(
                        "content-length", "").isdigit() else total
                mode = "ab" if loaded else "wb"
                with open(dest, mode) as fh:
                    async for chunk in r.aiter_bytes(CHUNK):
                        fh.write(chunk)
                        loaded += len(chunk)
                        if loaded > MAX_STAGE_BYTES:
                            raise ValueError("stage too large")
        except (httpx.RequestError, ValueError) as exc:
            log.warning("mux stage retry", rid=rid, what=what,
                        loaded=loaded, error=str(exc))
            continue
        if total is not None and loaded < total:
            continue  # truncated: resume
        break
    if total is not None and loaded < total:
        raise ValueError(f"incomplete stage {what}: {loaded}/{total}")
    log.info("mux staged", rid=rid, what=what, bytes=loaded)
    return loaded


@router.get("/mux")
async def mux(token: str, request: Request):
    rid = request.headers.get("x-request-id", "-")
    try:
        data = T.verify("mux", token)
    except ValueError as exc:
        raise HTTPException(status_code=403 if "invalid" in str(exc) else 410,
                            detail={"code": "bad-token", "message": str(exc)})
    container = data.get("c", "mp4")
    if container == "webm":
        raise HTTPException(status_code=400, detail={
            "code": "embed-unsupported",
            "message": "webm cannot carry embedded subtitles here; use mp4/mkv."})
    try:
        await asyncio.wait_for(_MUX_SEM.acquire(), timeout=0.05)
    except asyncio.TimeoutError as exc:
        raise HTTPException(status_code=429, detail={
            "code": "mux-busy",
            "message": "Server is merging for others; retry shortly."}) from exc
    tmp = tempfile.mkdtemp(prefix="koutube-mux-")
    log.info("mux start", rid=rid, container=container,
             subs=data.get("s") or [])
    try:
        sub_files: list[str] = []
        for lang in (data.get("s") or []):
            texts = await asyncio.to_thread(Y.fetch_sub_texts, data["u"], [lang],
                                            data.get("f", "srt"))
            text = texts.get(lang)
            if text:
                ext = "vtt" if data.get("f") == "vtt" else "srt"
                p = os.path.join(tmp, f"sub.{lang}.{ext}")
                with open(p, "w", encoding="utf-8") as fh:
                    fh.write(text)
                sub_files.append(p)
        vurl, aurl = data.get("v"), data.get("a")
        if not vurl or not aurl:
            raise HTTPException(status_code=400, detail={
                "code": "bad-token", "message": "mux needs video+audio URLs"})
        vpath = os.path.join(tmp, "v")
        apath = os.path.join(tmp, "a")
        outpath = os.path.join(tmp, "out.mp4" if container == "mp4" else "out.mkv")
        # Direct-HTTP inputs are staged with ranged requests (full speed);
        # manifest inputs (HLS/DASH) are left for ffmpeg to fetch itself.
        vinput, ainput = vurl, aurl
        async with httpx.AsyncClient(
                timeout=httpx.Timeout(30.0, read=60.0)) as client:
            if data.get("vd", True):
                await _stage_url(client, vurl, vpath, rid, "video")
                vinput = vpath
            if data.get("ad", True):
                await _stage_url(client, aurl, apath, rid, "audio")
                ainput = apath
        cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error"]
        for media_input in (vinput, ainput):
            if media_input in (vpath, apath):
                cmd += ["-i", media_input]
            else:
                cmd += ["-reconnect", "1", "-reconnect_streamed", "1",
                        "-reconnect_delay_max", "5", "-timeout", "30000000",
                        "-i", media_input]
        for sf in sub_files:
            cmd += ["-i", sf]
        cmd += ["-map", "0:v", "-map", "1:a", "-c", "copy"]
        for i in range(len(sub_files)):
            cmd += ["-map", str(2 + i)]
        if sub_files:
            cmd += ["-c:s", "mov_text" if container == "mp4" else "srt"]
        cmd += ["-f", "mp4" if container == "mp4" else "matroska", outpath]
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE)
        _, stderr = await proc.communicate()
        if proc.returncode != 0:
            log.error("ffmpeg mux failed", rid=rid, returncode=proc.returncode,
                      stderr=stderr.decode(errors="replace")[-500:])
            raise HTTPException(status_code=502, detail={
                "code": "mux-failed", "message": "Server merge failed."})
        size = os.path.getsize(outpath)
        log.info("mux ready", rid=rid, bytes=size)

        async def gen():
            try:
                with open(outpath, "rb") as fh:
                    while True:
                        if await request.is_disconnected():
                            break
                        chunk = fh.read(CHUNK)
                        if not chunk:
                            break
                        yield chunk
            finally:
                _cleanup_tmp(tmp)
                _MUX_SEM.release()

        ctype = "video/mp4" if container == "mp4" else "video/x-matroska"
        return StreamingResponse(gen(), media_type=ctype, headers={
            "Content-Disposition": f'attachment; filename="{data.get("n", "video")}"',
            "Content-Length": str(size),
            "Accept-Ranges": "none",
        })
    except HTTPException:
        _cleanup_tmp(tmp)
        _MUX_SEM.release()
        raise
    except Exception as exc:  # noqa: BLE001
        _cleanup_tmp(tmp)
        _MUX_SEM.release()
        log.error("mux failed", rid=rid, error=str(exc))
        raise HTTPException(status_code=502, detail={
            "code": "mux-failed", "message": f"Server merge failed: {exc}"})


def _cleanup_tmp(tmp: str) -> None:
    for root, _, files in os.walk(tmp):
        for f in files:
            try:
                os.remove(os.path.join(root, f))
            except OSError:
                pass
    try:
        os.rmdir(tmp)
    except OSError:
        pass
