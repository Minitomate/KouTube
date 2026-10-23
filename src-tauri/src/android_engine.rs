//! Android execution of yt-dlp through the bundled youtubedl-android library.
//!
//! There is no sidecar process to spawn: Python, yt-dlp and ffmpeg ship in the
//! APK. The Kotlin `YtdlpBridge` runs a request and queues every output line;
//! Rust polls the queue and feeds the same parsers as the desktop path.

use anyhow::{anyhow, Result};
use jni::objects::{JClass, JObject, JObjectArray, JString, JValue};
use jni::{JNIEnv, JavaVM};

const BRIDGE: &str = "com.koutube.app.YtdlpBridge";

/// Find an app class from a native thread.
///
/// `JNIEnv::find_class` resolves through the boot loader on native threads and
/// cannot see our dex. Go through the running Application's class loader.
fn app_class<'a>(env: &mut JNIEnv<'a>, name: &str) -> jni::errors::Result<JClass<'a>> {
    // Direct lookup works when the thread already has an app class loader;
    // clear the pending exception if it does not before trying the loader.
    let jni_name = name.replace('.', "/");
    if let Ok(class) = env.find_class(&jni_name) {
        return Ok(class);
    }
    if env.exception_check()? {
        env.exception_clear()?;
    }
    let activity_thread = env.find_class("android/app/ActivityThread")?;
    let app = env
        .call_static_method(
            activity_thread,
            "currentApplication",
            "()Landroid/app/Application;",
            &[],
        )?
        .l()?;
    let loader = env
        .call_method(&app, "getClassLoader", "()Ljava/lang/ClassLoader;", &[])?
        .l()?;
    let jname = env.new_string(name)?;
    let class = env
        .call_method(
            &loader,
            "loadClass",
            "(Ljava/lang/String;)Ljava/lang/Class;",
            &[JValue::Object(&jname)],
        )?
        .l()?;
    Ok(JClass::from(class))
}

fn with_env<T>(f: impl FnOnce(&mut JNIEnv) -> jni::errors::Result<T>) -> Result<T> {
    // Safety: Tauri stores the live JVM in ndk-context before Rust runs.
    let vm = unsafe { JavaVM::from_raw(ndk_context::android_context().vm().cast()) }
        .map_err(|e| anyhow!("jvm unavailable: {e}"))?;
    let mut env = vm
        .attach_current_thread_permanently()
        .map_err(|e| anyhow!("jni attach: {e}"))?;
    f(&mut env).map_err(|e| anyhow!("jni: {e}"))
}

fn string_array<'a>(env: &mut JNIEnv<'a>, items: &[String]) -> jni::errors::Result<JObjectArray<'a>> {
    let class = env.find_class("java/lang/String")?;
    let arr = env.new_object_array(items.len() as i32, class, JObject::null())?;
    for (i, item) in items.iter().enumerate() {
        let s = env.new_string(item)?;
        env.set_object_array_element(&arr, i as i32, &s)?;
    }
    Ok(arr)
}

/// Blocking download. Returns the yt-dlp exit code; live lines go to `drain`.
pub fn run(job_id: &str, args: &[String]) -> Result<i32> {
    with_env(|env| {
        let class = app_class(env, BRIDGE)?;
        let arr = string_array(env, args)?;
        let jid = env.new_string(job_id)?;
        let out = env.call_static_method(
            class,
            "run",
            "(Ljava/lang/String;[Ljava/lang/String;)I",
            &[JValue::Object(&jid), JValue::Object(arr.as_ref())],
        )?;
        out.i()
    })
}

/// Blocking `--dump-json` style call: returns the full stdout as text.
pub fn capture(tag: &str, args: &[String]) -> Result<String> {
    with_env(|env| {
        let class = app_class(env, BRIDGE)?;
        let arr = string_array(env, args)?;
        let jid = env.new_string(tag)?;
        let out = env.call_static_method(
            class,
            "capture",
            "(Ljava/lang/String;[Ljava/lang/String;)Ljava/lang/String;",
            &[JValue::Object(&jid), JValue::Object(arr.as_ref())],
        )?;
        let obj = out.l()?;
        let jstr = JString::from(obj);
        let text = env.get_string(&jstr)?;
        Ok(text.into())
    })
}

/// Take every line queued since the last poll. JNI hiccups degrade to empty.
pub fn drain(job_id: &str) -> Vec<String> {
    with_env(|env| {
        let class = app_class(env, BRIDGE)?;
        let jid = env.new_string(job_id)?;
        let out = env.call_static_method(
            class,
            "drain",
            "(Ljava/lang/String;)[Ljava/lang/String;",
            &[JValue::Object(&jid)],
        )?;
        let arr = JObjectArray::from(out.l()?);
        let len = env.get_array_length(&arr)?;
        let mut lines = Vec::with_capacity(len as usize);
        for i in 0..len {
            let item = env.get_object_array_element(&arr, i)?;
            let jstr = JString::from(item);
            let text = env.get_string(&jstr)?;
            lines.push(text.into());
        }
        Ok(lines)
    })
    .unwrap_or_default()
}

/// Kill the running Python process (and its ffmpeg children). Best effort.
pub fn cancel(job_id: &str) {
    let _ = with_env(|env| {
        let class = app_class(env, BRIDGE)?;
        let jid = env.new_string(job_id)?;
        env.call_static_method(
            class,
            "cancel",
            "(Ljava/lang/String;)V",
            &[JValue::Object(&jid)],
        )?;
        Ok(())
    });
}

/// Drop a finished job's queued output lines.
pub fn release(job_id: &str) {
    let _ = with_env(|env| {
        let class = app_class(env, BRIDGE)?;
        let jid = env.new_string(job_id)?;
        env.call_static_method(class, "release", "(Ljava/lang/String;)V", &[JValue::Object(&jid)])?;
        Ok(())
    });
}

fn static_string(class_name: &str, method: &str, sig: &str) -> Result<String> {
    with_env(|env| {
        let class = app_class(env, class_name)?;
        let out = env.call_static_method(class, method, sig, &[])?;
        let jstr = JString::from(out.l()?);
        let s: String = env.get_string(&jstr)?.into();
        Ok(s)
    })
}

/// Installed yt-dlp version (bundled fallback before the first update).
pub fn engine_version() -> Result<String> {
    static_string(BRIDGE, "engineVersion", "()Ljava/lang/String;")
}

/// Last startup engine-update failure, empty when the update succeeded.
pub fn engine_error() -> Result<String> {
    static_string(BRIDGE, "engineError", "()Ljava/lang/String;")
}

/// Manual engine update. Kotlin reports failures as `ERR:<message>`.
pub fn update_engine() -> Result<String> {
    let v = static_string(BRIDGE, "updateEngine", "()Ljava/lang/String;")?;
    match v.strip_prefix("ERR:") {
        Some(msg) => Err(anyhow!("{msg}")),
        None => Ok(v),
    }
}

const STORAGE: &str = "com.koutube.app.StorageBridge";

/// 0 = all-files access granted, 1 = missing.
pub fn storage_status() -> Result<i32> {
    with_env(|env| {
        let class = app_class(env, STORAGE)?;
        let out = env.call_static_method(class, "status", "()I", &[])?;
        out.i()
    })
}

/// Public `Download` directory (primary shared storage).
pub fn public_download_dir() -> Result<String> {
    static_string(STORAGE, "publicDir", "()Ljava/lang/String;")
}

/// App-specific external Downloads directory.
pub fn app_download_dir() -> Result<String> {
    static_string(STORAGE, "appDir", "()Ljava/lang/String;")
}

/// Open the system All-files-access screen / legacy runtime prompt.
pub fn request_storage() -> Result<()> {
    with_env(|env| {
        let class = app_class(env, STORAGE)?;
        env.call_static_method(class, "request", "()V", &[])?;
        Ok(())
    })
}

/// Ask for the Android 13+ notification permission (best effort, once).
pub fn request_notifications() {
    let _ = with_env(|env| {
        let class = app_class(env, STORAGE)?;
        env.call_static_method(class, "requestNotifications", "()V", &[])?;
        Ok(())
    });
}

/// Start/stop the dataSync foreground service.
pub fn foreground(on: bool) {
    let _ = with_env(|env| {
        let class = app_class(env, STORAGE)?;
        env.call_static_method(class, "foreground", "(Z)V", &[JValue::Bool(on as u8)])?;
        Ok(())
    });
}

/// Update the ongoing download notification; no-op when the service is off.
pub fn notify(title: &str, text: &str, percent: Option<u32>) {
    let _ = with_env(|env| {
        let class = app_class(env, STORAGE)?;
        let t = env.new_string(title)?;
        let x = env.new_string(text)?;
        env.call_static_method(
            class,
            "notifyDownload",
            "(Ljava/lang/String;Ljava/lang/String;IZ)V",
            &[
                JValue::Object(&t),
                JValue::Object(&x),
                JValue::Int(percent.unwrap_or(0) as i32),
                JValue::Bool(percent.is_none() as u8),
            ],
        )?;
        Ok(())
    });
}

/// One-shot "finished" notification; survives the service being stopped.
pub fn notify_done(title: &str, text: &str) {
    let _ = with_env(|env| {
        let class = app_class(env, STORAGE)?;
        let t = env.new_string(title)?;
        let x = env.new_string(text)?;
        env.call_static_method(
            class,
            "notifyDownloadDone",
            "(Ljava/lang/String;Ljava/lang/String;)V",
            &[JValue::Object(&t), JValue::Object(&x)],
        )?;
        Ok(())
    });
}

/// Ask the media scanner to index a finished (or deleted) public file.
pub fn scan_file(path: &str) {
    let _ = with_env(|env| {
        let class = app_class(env, "com.koutube.app.FileBridge")?;
        let p = env.new_string(path)?;
        env.call_static_method(class, "scan", "(Ljava/lang/String;)V", &[JValue::Object(&p)])?;
        Ok(())
    });
}

/// Write text through Android's ContentResolver (SAF `content://` URIs).
pub fn write_uri(uri: &str, text: &str) -> Result<()> {
    let ok = with_env(|env| {
        let class = app_class(env, "com.koutube.app.FileBridge")?;
        let u = env.new_string(uri)?;
        let t = env.new_string(text)?;
        let out = env.call_static_method(
            class,
            "writeUri",
            "(Ljava/lang/String;Ljava/lang/String;)Z",
            &[JValue::Object(&u), JValue::Object(&t)],
        )?;
        out.z()
    })?;
    if ok {
        Ok(())
    } else {
        Err(anyhow!("could not write the selected file"))
    }
}

/// Open a downloaded file through the app's FileProvider (system player).
pub fn open_file(path: &str) -> Result<()> {
    let opened = with_env(|env| {
        let class = app_class(env, "com.koutube.app.FileBridge")?;
        let p = env.new_string(path)?;
        let out = env.call_static_method(
            class,
            "open",
            "(Ljava/lang/String;)Z",
            &[JValue::Object(&p)],
        )?;
        out.z()
    })?;
    if opened {
        Ok(())
    } else {
        Err(anyhow!("no app can open this file"))
    }
}
