"""GET /api/mux?token= — on-the-fly merge+embed. Pipes ffmpeg stdout.

Nothing is stored: subtitles go to an OS-temp dir removed in `finally`,
media bytes flow straight through. Max 2 concurrent muxes (429 when busy).
No Range support (live transcode) — download-only.
"""
from __future__ import annotations
import asyncio
import os
import signal
import tempfile
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.services import tokens as T
from app.services import ytdlp as Y

router = APIRouter()
_MUX_SEM = asyncio.Semaphore(2)


@router.get("/mux")
async def mux(token: str, request: Request):
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
    sub_files: list[str] = []
    try:
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
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        _cleanup_tmp(tmp)
        _MUX_SEM.release()
        raise HTTPException(status_code=502, detail={
            "code": "subs", "message": f"subtitle fetch failed: {exc}"})

    vurl, aurl = data.get("v"), data.get("a")
    if not vurl or not aurl:
        _cleanup_tmp(tmp)
        _MUX_SEM.release()
        raise HTTPException(status_code=400, detail={
            "code": "bad-token", "message": "mux needs video+audio URLs"})

    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error",
           "-i", vurl, "-i", aurl]
    for sf in sub_files:
        cmd += ["-i", sf]
    cmd += ["-map", "0:v", "-map", "1:a", "-c", "copy"]
    for i in range(len(sub_files)):
        cmd += ["-map", str(2 + i)]
    if sub_files:
        cmd += ["-c:s", "mov_text" if container == "mp4" else "srt"]
    if container == "mp4":
        cmd += ["-f", "mp4", "-movflags", "frag_keyframe+empty_moov", "pipe:1"]
    else:
        cmd += ["-f", "matroska", "pipe:1"]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
            start_new_session=True)
    except FileNotFoundError:
        _cleanup_tmp(tmp)
        _MUX_SEM.release()
        raise HTTPException(status_code=500, detail={
            "code": "no-ffmpeg", "message": "ffmpeg binary missing on server"})

    async def gen():
        try:
            assert proc.stdout is not None
            while True:
                if await request.is_disconnected():
                    break
                chunk = await proc.stdout.read(64 * 1024)
                if not chunk:
                    break
                yield chunk
            await proc.wait()
        finally:
            if proc.returncode is None:
                try:
                    os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                except (ProcessLookupError, PermissionError):
                    pass
            _cleanup_tmp(tmp)
            _MUX_SEM.release()

    ctype = "video/mp4" if container == "mp4" else "video/x-matroska"
    return StreamingResponse(gen(), media_type=ctype, headers={
        "Content-Disposition": f'attachment; filename="{data.get("n", "video")}"',
        "Accept-Ranges": "none",
    })


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
