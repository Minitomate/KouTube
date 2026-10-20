package com.koutube.app

import android.content.Context
import android.util.Log
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap

/**
 * JNI surface for the Rust download engine.
 *
 * youtubedl-android bundles Python, yt-dlp and ffmpeg in the APK, so there is
 * no sidecar to spawn. Rust still owns the yt-dlp argument list and output
 * parsing; this object only executes the request and exposes output lines.
 */
object YtdlpBridge {
    private const val TAG = "YtdlpBridge"
    private val queues = ConcurrentHashMap<String, MutableList<String>>()
    private var appContext: Context? = null
    private var ready = false

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
        ready = true
    }

    /** Blocking download. Returns the exit code; lines go to [drain]. */
    @JvmStatic
    fun run(jobId: String, args: Array<String>): Int {
        val queue = Collections.synchronizedList(ArrayList<String>())
        queues[jobId] = queue
        return try {
            ensureReady()
            val res = YoutubeDL.execute(request(args), jobId, true) { _, _, line ->
                if (line.isNotEmpty()) queue.add(line)
            }
            res.exitCode
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
            YoutubeDL.execute(request(args), processId, true).out
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

    @JvmStatic
    fun cancel(jobId: String) {
        YoutubeDL.destroyProcessById(jobId)
    }

    /** The URL is always the last argument; the request appends it itself. */
    private fun request(args: Array<String>): YoutubeDLRequest {
        val req = YoutubeDLRequest(args.last())
        if (args.size > 1) req.addCommands(args.dropLast(1))
        return req
    }
}
