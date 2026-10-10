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

# Ephemeral mux progress keyed by client X-Request-ID. Entries are tiny and
# purged after 15 minutes; this only bridges the silent stage+mux phase
# before the response (and first byte) exists.
_MUX_PROGRESS: dict[str, dict] = {}
_PROGRESS_TTL = 15 * 60

# Adaptive segmented staging: 8MB segments, start with 2 workers, scale to 4
# when per-segment throughput stays healthy, back off on 403/429. Measured:
# many concurrent full-speed streams get stalled upstream, so stay gentle.
SEGMENT_BYTES = 8 * 1024 * 1024
MIN_WORKERS = 2
MAX_WORKERS = 4
# Healthy = median segment faster than this (8MB in 8s ~= 1MB/s per socket).
HEALTHY_SEGMENT_S = 8.0
RATE_WINDOW_S = 3.0


def plan_segments(total: int, size: int = SEGMENT_BYTES) -> list[tuple[int, int]]:
    """Split total bytes into (start, end-inclusive) segments tiling exactly."""
    segs: list[tuple[int, int]] = []
    off = 0
    while off < total:
        end = min(off + size - 1, total - 1)
        segs.append((off, end))
        off = end + 1
    return segs


def _progress(rid: str, **kw) -> None:
    import time
    now = time.time()
    for key in [k for k, v in _MUX_PROGRESS.items()
                if now - v.get("ts", now) > _PROGRESS_TTL]:
        _MUX_PROGRESS.pop(key, None)
    if rid and rid != "-":
        _MUX_PROGRESS[rid] = {"ts": now, **kw}


@router.get("/mux-progress")
async def mux_progress(rid: str):
    entry = _MUX_PROGRESS.get(rid)
    if not entry:
        raise HTTPException(status_code=404, detail={
            "code": "no-progress", "message": "unknown or expired request"})
    return {"phase": entry.get("phase"), "loaded": entry.get("loaded"),
            "total": entry.get("total"), "note": entry.get("note")}


    entry = _MUX_PROGRESS.get(rid)
    if not entry:
        raise HTTPException(status_code=404, detail={
            "code": "no-progress", "message": "unknown or expired request"})
    return {"phase": entry.get("phase"), "loaded": entry.get("loaded"),
            "total": entry.get("total"), "rate": entry.get("rate"),
            "eta": entry.get("eta"), "note": entry.get("note")}


class _Rate:
    """Rolling-window byte rate + ETA for progress entries."""

    def __init__(self) -> None:
        import time
        self._t = time.monotonic
        self.samples: list[tuple[float, int]] = []

    def add(self, loaded: int) -> tuple[float | None, float | None]:
        now = self._t()
        self.samples.append((now, loaded))
        cutoff = now - RATE_WINDOW_S
        self.samples = [(t, b) for t, b in self.samples if t >= cutoff]
        if len(self.samples) < 2:
            return None, None
        (t0, b0), (t1, b1) = self.samples[0], self.samples[-1]
        dt = t1 - t0
        if dt <= 0 or b1 <= b0:
            return None, None
        rate = (b1 - b0) / dt
        return rate, None  # ETA needs total; caller fills it in


async def _fetch_segment(client: httpx.AsyncClient, url: str, fd: int,
                         start: int, end: int, rid: str, what: str,
                         seg_idx: int) -> float:
    """Fetch one byte segment, resuming within the segment on stalls.

    Returns seconds taken. Raises ValueError (fail-fast input) or
    httpx.HTTPStatusError on 403/429 so the caller can back off.
    """
    import time
    t0 = time.monotonic()
    off = start
    last: Exception | None = None
    for attempt in range(5):
        try:
            headers = {**UA, "Range": f"bytes={off}-{end}"}
            async with client.stream("GET", url, headers=headers) as r:
                if r.status_code in (403, 429):
                    raise httpx.HTTPStatusError(
                        f"upstream {r.status_code}", request=r.request,
                        response=r.response)
                if r.status_code not in (200, 206):
                    raise ValueError(f"upstream status {r.status_code}")
                async for chunk in r.aiter_bytes(CHUNK):
                    os.pwrite(fd, chunk, off)
                    off += len(chunk)
                if off != end + 1:
                    raise ValueError(f"short segment {seg_idx}: {off - start}/{end - start + 1}")
                return time.monotonic() - t0
        except httpx.HTTPStatusError:
            raise
        except (httpx.RequestError, ValueError, OSError) as exc:
            last = exc
            log.warning("mux segment retry", rid=rid, what=what, seg=seg_idx,
                        off=off, attempt=attempt, error=repr(exc)[:200])
            await asyncio.sleep(1 + attempt)
    raise ValueError(f"segment {seg_idx} failed: {last!r}")


async def _stage_url(client: httpx.AsyncClient, url: str, dest: str, rid: str,
                     what: str) -> int:
    """Adaptive parallel segmented fetch (defeats single-connection throttle).

    Probes total once, pulls 8MB segments with 4 workers, scales to 8 while
    segments stay healthy, backs off (no scale-up + longer retry) on 403/429.
    """
    import time
    # Probe total with headers only.
    total: int | None = None
    async with client.stream("GET", url, headers={**UA, "Range": "bytes=0-0"}) as r:
        if r.status_code == 206:
            cr = r.headers.get("content-range", "")
            m = cr.split("/")[-1].strip() if "/" in cr else ""
            total = int(m) if m.isdigit() else None
        elif r.status_code == 200:
            total = int(r.headers["content-length"]) if r.headers.get(
                "content-length", "").isdigit() else None
        else:
            raise ValueError(f"upstream status {r.status_code}")
    fd = os.open(dest, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        if total is None:
            # Unknown size: fall back to single sequential ranged fetch.
            os.close(fd)
            return await _stage_sequential(client, url, dest, rid, what)
        os.ftruncate(fd, total)
        segments = plan_segments(total)
        queue: asyncio.Queue[tuple[int, int, int]] = asyncio.Queue()
        for i, (s, e) in enumerate(segments):
            queue.put_nowait((i, s, e))
        state = {"done": 0, "bytes": 0, "degraded": False,
                 "times": [], "started_extra": False}
        rate = _Rate()
        workers: list[asyncio.Task] = []

        async def worker() -> None:
            while True:
                try:
                    i, s, e = queue.get_nowait()
                except asyncio.QueueEmpty:
                    return
                try:
                    dt = await _fetch_segment(client, url, fd, s, e, rid, what, i)
                except httpx.HTTPStatusError as exc:
                    state["degraded"] = True
                    log.warning("mux staging throttled", rid=rid, what=what,
                                seg=i, error=str(exc))
                    await asyncio.sleep(2)
                    queue.put_nowait((i, s, e))  # requeue with fewer mouths
                    queue.task_done()
                    return  # this worker stands down
                except ValueError as exc:
                    queue.task_done()
                    raise exc
                state["done"] += 1
                state["times"].append(dt)
                state["bytes"] += e - s + 1
                rps, _ = rate.add(state["bytes"])
                eta = (total - state["bytes"]) / rps if rps else None
                _progress(rid, phase=f"staging-{what}", loaded=state["bytes"],
                          total=total, rate=rps, eta=eta)
                # Adaptive scale-up once: after the first wave, if healthy.
                if (not state["started_extra"] and not state["degraded"]
                        and state["done"] >= MIN_WORKERS
                        and queue.qsize() > MAX_WORKERS):
                    import statistics
                    med = statistics.median(state["times"])
                    state["started_extra"] = True
                    if med <= HEALTHY_SEGMENT_S:
                        log.info("mux staging scale-up", rid=rid, what=what,
                                 median_s=round(med, 2))
                        for _ in range(MAX_WORKERS - MIN_WORKERS):
                            workers.append(asyncio.create_task(worker()))
                queue.task_done()

        for _ in range(min(MIN_WORKERS, len(segments))):
            workers.append(asyncio.create_task(worker()))
        while workers:
            done, pending = await asyncio.wait(workers, return_when=asyncio.FIRST_COMPLETED)
            for t in done:
                workers.remove(t)
                exc = t.exception()
                if exc is not None:
                    for p in pending:
                        p.cancel()
                    raise exc
            # Top up if queue still full but workers drained (e.g. 403 stand-downs).
            if not workers and not queue.empty() and not state["degraded"]:
                for _ in range(min(MIN_WORKERS, queue.qsize())):
                    workers.append(asyncio.create_task(worker()))
            if not workers and not queue.empty() and state["degraded"]:
                # Degraded: single careful worker drains the rest.
                workers.append(asyncio.create_task(worker()))
        # Verify exact size.
        got = os.path.getsize(dest)
        if got != total:
            raise ValueError(f"incomplete stage {what}: {got}/{total}")
    finally:
        if fd >= 0:
            try:
                os.close(fd)
            except OSError:
                pass
    log.info("mux staged", rid=rid, what=what, bytes=total)
    return total


async def _stage_sequential(client: httpx.AsyncClient, url: str, dest: str,
                            rid: str, what: str) -> int:
    """Single-connection fallback when total size is unknown."""
    loaded = 0
    for attempt in range(4):
        headers = {**UA, "Range": f"bytes={loaded}-"}
        try:
            async with client.stream("GET", url, headers=headers) as r:
                if r.status_code not in (200, 206):
                    raise ValueError(f"upstream status {r.status_code}")
                mode = "ab" if loaded else "wb"
                with open(dest, mode) as fh:
                    async for chunk in r.aiter_bytes(CHUNK):
                        fh.write(chunk)
                        loaded += len(chunk)
                        _progress(rid, phase=f"staging-{what}", loaded=loaded,
                                  total=None)
                        if loaded > MAX_STAGE_BYTES:
                            raise ValueError("stage too large")
        except (httpx.RequestError, ValueError) as exc:
            log.warning("mux stage retry", rid=rid, what=what,
                        loaded=loaded, error=str(exc))
            continue
        break
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
        limits = httpx.Limits(max_connections=MAX_WORKERS + 2,
                              max_keepalive_connections=MAX_WORKERS + 2)
        async with httpx.AsyncClient(
                timeout=httpx.Timeout(30.0, read=60.0),
                limits=limits) as client:
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
        _progress(rid, phase="muxing")
        _, stderr = await proc.communicate()
        if proc.returncode != 0:
            log.error("ffmpeg mux failed", rid=rid, returncode=proc.returncode,
                      stderr=stderr.decode(errors="replace")[-500:])
            raise HTTPException(status_code=502, detail={
                "code": "mux-failed", "message": "Server merge failed."})
        size = os.path.getsize(outpath)
        log.info("mux ready", rid=rid, bytes=size)
        _progress(rid, phase="ready", loaded=size, total=size)

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
        _progress(rid, phase="error", note=str(exc)[:200])
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
