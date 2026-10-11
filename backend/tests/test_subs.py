"""GET /api/subs: manual-only captions, one .srt per call."""
from fastapi.testclient import TestClient
from app.main import app
from app.services import ytdlp as Y

INFO = {
    "id": "abc123",
    "title": "Some Video",
    "subtitles": {
        "en": [{"name": "English"}],
    },
    "automatic_captions": {
        "fr": [{"name": "French (auto)"}],
    },
}

client = TestClient(app, raise_server_exceptions=False)


def _patch(monkeypatch):
    monkeypatch.setattr(Y, "extract_info", lambda url, flat: INFO)
    monkeypatch.setattr(Y, "fetch_sub_texts",
                        lambda url, langs, fmt="srt": {l: "1\n00:00:00,000 --> 00:00:01,000\nhi" for l in langs})


def test_manual_lang_returns_srt(monkeypatch):
    _patch(monkeypatch)
    r = client.get("/api/subs", params={"url": "https://www.youtube.com/watch?v=abc123", "lang": "en"})
    assert r.status_code == 200, r.text[:200]
    assert "hi" in r.text
    assert "[en].srt" in r.headers["content-disposition"]


def test_auto_only_lang_rejected(monkeypatch):
    _patch(monkeypatch)
    r = client.get("/api/subs", params={"url": "https://www.youtube.com/watch?v=abc123", "lang": "fr"})
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "no-captions"


def test_invalid_url_rejected(monkeypatch):
    _patch(monkeypatch)
    r = client.get("/api/subs", params={"url": "https://evil.example/x", "lang": "en"})
    assert r.status_code == 400
