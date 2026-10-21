package com.koutube.app

import android.content.Context
import android.util.Log
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * JNI surface for the Rust download engine.
 *
 * youtubedl-android bundles Python, yt-dlp and ffmpeg in the APK, so there is
 * no sidecar to spawn. Rust still owns the yt-dlp argument list and output
 * parsing; this object only executes the request and exposes output lines.
 */
object YtdlpBridge {
    private const val TAG = "YtdlpBridge"

    /** Keep in sync with the yt-dlp bundled by the youtubedl-android AAR. */
    private const val BUNDLED_YTDLP = "2025.11.12"

    private val queues = ConcurrentHashMap<String, MutableList<String>>()
    private val active = AtomicInteger(0)
    private var appContext: Context? = null

    @Volatile
    private var ready = false

    @Volatile
    private var updateError = ""

    @JvmStatic
    fun init(ctx: Context) {
        appContext = ctx.applicationContext
        ensureReady()
    }

    @Synchronized
    private fun ensureReady() {
        if (ready) return
        val ctx = appContext ?: throw IllegalStateException("YtdlpBridge not initialized")
        YoutubeDL.init(ctx)
        FFmpeg.init(ctx)
        // The AAR ships an old yt-dlp that YouTube now rejects with HTTP 403.
        // Update before any job can start; offline/failed updates keep the
        // bundled engine so the app still works.
        try {
            YoutubeDL.updateYoutubeDL(ctx, YoutubeDL.UpdateChannel.STABLE)
            updateError = ""
        } catch (e: Exception) {
            updateError = e.message ?: e.toString()
            Log.w(TAG, "engine update failed; keeping bundled yt-dlp", e)
        }
        ready = true
    }

    /** Blocking download. Returns the exit code; lines go to [drain]. */
    @JvmStatic
    fun run(jobId: String, args: Array<String>): Int {
        val queue = Collections.synchronizedList(ArrayList<String>())
        queues[jobId] = queue
        return try {
            ensureReady()
            active.incrementAndGet()
            try {
                val res = YoutubeDL.execute(request(args), jobId, true) { _, _, line ->
                    if (line.isNotEmpty()) queue.add(line)
                }
                res.exitCode
            } finally {
                active.decrementAndGet()
            }
        } catch (e: Exception) {
            queue.add("[koutube] ${e.message ?: e.toString()}")
            Log.e(TAG, "run failed job=$jobId", e)
            -1
        }
    }

    /** Blocking `--dump-json` style call. Returns stdout, or "" on failure. */
    @JvmStatic
    fun capture(processId: String, args: Array<String>): String {
        return try {
            ensureReady()
            active.incrementAndGet()
            try {
                YoutubeDL.execute(request(args), processId, true).out
            } finally {
                active.decrementAndGet()
            }
        } catch (e: Exception) {
            Log.e(TAG, "capture failed", e)
            ""
        }
    }

    @JvmStatic
    fun drain(jobId: String): Array<String> {
        val queue = queues[jobId] ?: return emptyArray()
        synchronized(queue) {
            val out = queue.toTypedArray()
            queue.clear()
            return out
        }
    }

    /** Drop a finished job's line queue so long sessions cannot leak memory. */
    @JvmStatic
    fun release(jobId: String) {
        queues.remove(jobId)
    }

    @JvmStatic
    fun cancel(jobId: String) {
        YoutubeDL.destroyProcessById(jobId)
    }

    /** Installed engine version, or the bundled fallback before an update. */
    @JvmStatic
    fun engineVersion(): String =
        appContext?.let { YoutubeDL.version(it) } ?: BUNDLED_YTDLP

    @JvmStatic
    fun engineError(): String = updateError

    /**
     * Manual update from Settings. Returns the new version, or `ERR:<message>`.
     * The Rust side already refuses while jobs run; this second check covers
     * races between that check and the JNI call.
     */
    @Synchronized
    @JvmStatic
    fun updateEngine(): String {
        val ctx = appContext ?: return "ERR:not initialized"
        if (active.get() > 0) return "ERR:downloads are running"
        return try {
            YoutubeDL.updateYoutubeDL(ctx, YoutubeDL.UpdateChannel.STABLE)
            updateError = ""
            engineVersion()
        } catch (e: Exception) {
            updateError = e.message ?: e.toString()
            Log.e(TAG, "manual engine update failed", e)
            "ERR:$updateError"
        }
    }

    /** The URL is always the last argument; the request appends it itself. */
    private fun request(args: Array<String>): YoutubeDLRequest {
        val req = YoutubeDLRequest(args.last())
        if (args.size > 1) req.addCommands(args.dropLast(1))
        return req
    }
}
