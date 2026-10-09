"""Manual-only caption filtering: subtitles used, automatic_captions ignored, live_chat excluded."""
from app.services.ytdlp import filter_manual_captions


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
