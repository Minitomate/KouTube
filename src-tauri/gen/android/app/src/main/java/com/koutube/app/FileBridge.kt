package com.koutube.app

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.core.content.FileProvider
import java.io.File

/** Opens downloaded media with the system player through our FileProvider. */
object FileBridge {
    private const val TAG = "FileBridge"
    private var appContext: Context? = null

    @JvmStatic
    fun init(ctx: Context) {
        appContext = ctx.applicationContext
    }

    @JvmStatic
    fun open(path: String): Boolean {
        val ctx = appContext ?: return false
        val file = File(path)
        if (!file.isFile) return false
        return try {
            val uri: Uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.fileprovider", file)
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, mime(path))
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            ctx.startActivity(intent)
            true
        } catch (e: Exception) {
            Log.e(TAG, "open failed path=$path", e)
            false
        }
    }

    private fun mime(path: String): String = when (path.substringAfterLast('.', "").lowercase()) {
        "mp4" -> "video/mp4"
        "webm" -> "video/webm"
        "mkv" -> "video/x-matroska"
        "m4a" -> "audio/mp4"
        "mp3" -> "audio/mpeg"
        "opus" -> "audio/ogg"
        "wav" -> "audio/wav"
        "flac" -> "audio/flac"
        "srt", "vtt" -> "text/plain"
        else -> "*/*"
    }
}
