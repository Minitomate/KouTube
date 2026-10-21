package com.koutube.app

import android.os.Bundle
import android.util.Log
import androidx.activity.enableEdgeToEdge
import kotlin.concurrent.thread

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    FileBridge.init(applicationContext)
    StorageBridge.init(this)
    // Unpacking Python + updating yt-dlp takes a moment: keep launch
    // responsive, and the first download waits on the bridge's own lock.
    thread(name = "ytdlp-init") {
      runCatching { YtdlpBridge.init(applicationContext) }
        .onFailure { Log.e("MainActivity", "yt-dlp init failed", it) }
    }
  }
}
