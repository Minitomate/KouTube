package com.koutube.app

import android.content.Context
import android.content.Intent
import android.media.MediaScannerConnection
import android.net.Uri
import android.util.Log
import androidx.core.content.FileProvider
import java.io.File

/** Opens downloaded media and bridges URI writes for the Rust side. */
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

    /**
     * The Tauri save dialog returns a `content://` URI, which std::fs cannot
     * write. Go through ContentResolver so the picked document gets the text.
     */
    @JvmStatic
    fun writeUri(uri: String, text: String): Boolean {
        val ctx = appContext ?: return false
        return try {
            val parsed = Uri.parse(uri)
            val out = (try {
                ctx.contentResolver.openOutputStream(parsed, "wt")
            } catch (e: Exception) {
                null
            }) ?: ctx.contentResolver.openOutputStream(parsed) ?: return false
            out.use { it.write(text.toByteArray(Charsets.UTF_8)) }
            true
        } catch (e: Exception) {
            Log.e(TAG, "writeUri failed uri=$uri", e)
            false
        }
    }

    /** Make a public-Download file visible to the gallery/file manager. */
    @JvmStatic
    fun scan(path: String) {
        val ctx = appContext ?: return
        try {
            MediaScannerConnection.scanFile(ctx, arrayOf(path), null, null)
        } catch (e: Exception) {
            Log.e(TAG, "scan failed path=$path", e)
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
