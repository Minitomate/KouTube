"""Audio-only pinning is strict: a missing dub raises, never yields original."""
import pytest
from app.services.ytdlp import pick_streams


def _audio(url, lang=None, abr=128):
    f = {"url": url, "acodec": "opus", "abr": abr,
         "filesize": 10, "protocol": "https"}
    if lang is not None:
        f["language"] = lang
    return f


INFO = {
    "formats": [
        _audio("https://cdn.test/orig", "en", 160),
        _audio("https://cdn.test/dub", "es", 128),
        {"url": "https://cdn.test/v", "vcodec": "avc1", "acodec": "none",
         "height": 720, "filesize": 20, "protocol": "https"},
    ]
}


def test_audio_only_missing_lang_raises():
    with pytest.raises(ValueError, match="fr"):
        pick_streams(INFO, "mp3", "best", "fr")


def test_audio_only_matching_lang_wins():
    s = pick_streams(INFO, "mp3", "best", "es")
    assert s["audio_url"] == "https://cdn.test/dub"


def test_audio_only_prefix_matches_region():
    info = {"formats": [_audio("https://cdn.test/orig", "en", 160),
                        _audio("https://cdn.test/dub", "es-419", 128)]}
    s = pick_streams(info, "mp3", "best", "es")
    assert s["audio_url"] == "https://cdn.test/dub"


def test_video_mode_still_falls_back():
    # Degrading is correct when video is the product.
    s = pick_streams(INFO, "mp4", "720", "fr")
    assert s["video_url"] == "https://cdn.test/v"
    assert s["audio_url"] == "https://cdn.test/orig"
