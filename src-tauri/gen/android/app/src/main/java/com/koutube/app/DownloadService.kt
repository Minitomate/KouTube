package com.koutube.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * Keeps the process alive (and the CPU/network usable) while downloads run in
 * the background. Started by Rust with the first job, stopped with the last.
 * Rust pushes batch progress through [notify]; the first start also paints a
 * placeholder so startForeground never runs without a notification.
 */
class DownloadService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL, "Downloads", NotificationManager.IMPORTANCE_LOW),
            )
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Rust starts the service on every transition; startForeground only
        // once, or each new job would reset the live progress back to idle.
        if (!running) {
            running = true
            val notification = build(
                this, "KouTube", "Preparing download", 0, indeterminate = true,
            )
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ServiceCompat.startForeground(
                    this,
                    ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
                )
            } else {
                startForeground(ID, notification)
            }
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        running = false
        stopForeground(STOP_FOREGROUND_REMOVE)
        // Samsung leaves the FGS record behind if teardown times out.
        getSystemService(NotificationManager::class.java).cancel(ID)
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL = "koutube-downloads"
        private const val ID = 1
        private const val DONE_ID = 2

        @Volatile
        private var running = false

        fun start(ctx: Context) {
            if (running) return
            ContextCompat.startForegroundService(ctx, Intent(ctx, DownloadService::class.java))
        }

        fun stop(ctx: Context) {
            running = false
            ctx.stopService(Intent(ctx, DownloadService::class.java))
            // onDestroy is not guaranteed promptly on every OEM: clear now.
            ctx.getSystemService(NotificationManager::class.java).cancel(ID)
        }

        /** Replace the live notification; ignored when downloads are idle. */
        fun notify(ctx: Context, title: String, text: String, percent: Int, indeterminate: Boolean) {
            if (!running) return
            ctx.getSystemService(NotificationManager::class.java)
                .notify(ID, build(ctx, title, text, percent, indeterminate))
        }

        /** "Finished" summary: dismissible, survives the foreground service. */
        fun done(ctx: Context, title: String, text: String) {
            val notification = NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(NotificationCompat.BigTextStyle().bigText(text))
                .setContentIntent(openIntent(ctx))
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .setCategory(NotificationCompat.CATEGORY_STATUS)
                .build()
            ctx.getSystemService(NotificationManager::class.java).notify(DONE_ID, notification)
        }

        private fun openIntent(ctx: Context): PendingIntent =
            PendingIntent.getActivity(
                ctx,
                0,
                Intent(ctx, MainActivity::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )

        private fun build(
            ctx: Context,
            title: String,
            text: String,
            percent: Int,
            indeterminate: Boolean,
        ): Notification {
            val open = openIntent(ctx)
            return NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(android.R.drawable.stat_sys_download)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(NotificationCompat.BigTextStyle().bigText(text))
                .setContentIntent(open)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(NotificationCompat.CATEGORY_PROGRESS)
                .setProgress(100, percent, indeterminate)
                .build()
        }
    }
}
