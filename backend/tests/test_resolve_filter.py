"""Manual-only caption filtering: subtitles used, automatic_captions ignored, live_chat excluded."""
from app.services.ytdlp import filter_manual_captions, pick_avatar


def test_manual_only_captions():
    info = {
        "subtitles": {
            "en": [{"name": "English", "ext": "vtt"}],
            "es": [{"name": "Spanish", "ext": "vtt"}],
            "live_chat": [{"name": "Live chat", "ext": "json"}],
        },
        "automatic_captions": {
            "en": [{"name": "English (auto)", "ext": "vtt"}],
            "fr": [{"name": "French (auto)", "ext": "vtt"}],
        },
    }
    caps = filter_manual_captions(info)
    langs = {c.lang for c in caps}
    assert langs == {"en", "es"}, langs
    assert "live_chat" not in langs
    assert "fr" not in langs  # auto-only lang must not leak in


def test_no_subtitles_no_autos():
    info = {"automatic_captions": {"en": [{"name": "auto"}]}}
    assert filter_manual_captions(info) == []


def test_empty_info():
    assert filter_manual_captions({}) == []


def test_pick_avatar_prefers_uncropped_over_banner():
    thumbs = [
        {"id": "0", "url": "https://yt3.googleusercontent.com/x=w1060-fcrop64=1"},
        {"id": "avatar_uncropped", "url": "https://yt3.googleusercontent.com/y=s900-c-k"},
        {"id": "7", "url": "https://yt3.googleusercontent.com/z=s176"},
    ]
    assert pick_avatar(thumbs) == "https://yt3.googleusercontent.com/y=s900-c-k"


def test_pick_avatar_rejects_banners_and_empties():
    assert pick_avatar([]) is None
    assert pick_avatar([{"id": "0", "url": "https://yt3.googleusercontent.com/x=w1060"}]) is None
    assert pick_avatar([{"id": "avatar_uncropped"}]) is None  # no url
