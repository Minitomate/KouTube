package com.koutube.app

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import androidx.core.content.ContextCompat

/**
 * JNI surface for storage permissions, download roots and the foreground
 * download service. Rust calls these; the UI never touches Android APIs.
 */
object StorageBridge {
    private var activity: MainActivity? = null
    private var appContext: Context? = null

    @Volatile
    private var askedNotifications = false

    @JvmStatic
    fun init(activity: MainActivity) {
        this.activity = activity
        appContext = activity.applicationContext
    }

    /** 0 = usable, 1 = permission missing. */
    @JvmStatic
    fun status(): Int {
        val ctx = appContext ?: return 1
        return if (granted(ctx)) 0 else 1
    }

    @JvmStatic
    fun publicDir(): String =
        Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS).absolutePath

    @JvmStatic
    fun appDir(): String {
        val ctx = appContext ?: return ""
        return (ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: ctx.filesDir).absolutePath
    }

    /** Open the system grant screen (API 30+) or the legacy runtime prompt. */
    @JvmStatic
    fun request() {
        val act = activity ?: return
        val ctx = act.applicationContext
        act.runOnUiThread {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val app = Intent(
                    Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                    Uri.parse("package:${ctx.packageName}"),
                )
                try {
                    act.launchActivityForResult(app) { }
                } catch (e: Exception) {
                    act.launchActivityForResult(
                        Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION),
                    ) { }
                }
            } else {
                act.requestPermissions(
                    arrayOf(Manifest.permission.WRITE_EXTERNAL_STORAGE),
                ) { }
            }
        }
    }

    /** Android 13+ notification prompt; a denial only hides the FGS notice. */
    @JvmStatic
    fun requestNotifications() {
        if (askedNotifications) return
        askedNotifications = true
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val act = activity ?: return
        act.runOnUiThread {
            if (ContextCompat.checkSelfPermission(act, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                act.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS)) { }
            }
        }
    }

    @JvmStatic
    fun foreground(on: Boolean) {
        val ctx = appContext ?: return
        if (on) DownloadService.start(ctx) else DownloadService.stop(ctx)
    }

    private fun granted(ctx: Context): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Environment.isExternalStorageManager()
        } else {
            ContextCompat.checkSelfPermission(
                ctx,
                Manifest.permission.WRITE_EXTERNAL_STORAGE,
            ) == PackageManager.PERMISSION_GRANTED
        }
}
