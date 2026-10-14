"""Playlist resolve keeps channel + entry duration/thumbnail for preview."""
from app.services.ytdlp import build_resolve_payload, pick_playlist_thumbnail


def test_playlist_payload_keeps_preview_fields():
    info = {
        "_type": "playlist",
        "title": "AI Tools",
        "channel": "Alex Ziskind",
        "uploader_url": "https://www.youtube.com/@AZisk",
        "entries": [
            {"id": "bYpdCFz7VtA", "title": "Faster agents", "duration": 947,
             "thumbnail": "https://i.ytimg.com/vi/bYpdCFz7VtA/hqdefault.jpg"},
            {"id": "9nKwDzsaAII", "title": "Supercomputers"},
        ],
    }
    payload = build_resolve_payload(info)
    assert payload["is_playlist"] is True
    assert payload["channel"] == "Alex Ziskind"
    assert payload["channelUrl"] == "https://www.youtube.com/@AZisk"
    assert payload["entries"][0].videoId == "bYpdCFz7VtA"
    assert payload["entries"][0].duration == 947
    assert payload["entries"][0].thumbnail.endswith("hqdefault.jpg")
    assert payload["entries"][1].duration is None


def test_playlist_cover_prefers_thumbnails_array_then_first_entry():
    assert pick_playlist_thumbnail({"thumbnail": "https://img/cover.jpg", "entries": []}) == "https://img/cover.jpg"
    assert pick_playlist_thumbnail({
        "thumbnails": [{"url": "https://i.ytimg.com/vi/bYpdCFz7VtA/hqdefault.jpg"}],
        "entries": [],
    }) == "https://i.ytimg.com/vi/bYpdCFz7VtA/hqdefault.jpg"
    assert pick_playlist_thumbnail({
        "entries": [{"id": "bYpdCFz7VtA", "thumbnail": "https://img/e.jpg"}],
    }) == "https://img/e.jpg"
    assert pick_playlist_thumbnail({"entries": [{"id": "bYpdCFz7VtA"}]}) == \
        "https://i.ytimg.com/vi/bYpdCFz7VtA/hqdefault.jpg"
    assert pick_playlist_thumbnail({"entries": []}) is None
