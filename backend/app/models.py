from __future__ import annotations
from enum import Enum
from typing import Literal
from pydantic import BaseModel, Field

Container = Literal["mp4", "webm", "mkv", "mp3", "m4a", "opus", "wav", "flac"]
SubFormat = Literal["srt", "vtt"]
AUDIO_ONLY = {"mp3", "m4a", "opus", "wav", "flac"}


class ResolveRequest(BaseModel):
    url: str


class FormatInfo(BaseModel):
    height: int | None = None
    ext: str = ""
    fps: int | None = None
    filesize: int | None = None
    vcodec: str | None = None
    acodec: str | None = None


class AudioTrack(BaseModel):
    lang: str
    label: str
    is_default: bool = False


class CaptionTrack(BaseModel):
    lang: str
    label: str


class PlaylistEntry(BaseModel):
    videoId: str
    title: str = ""
    duration: int | None = None
    thumbnail: str | None = None


class ResolveResponse(BaseModel):
    videoId: str | None = None
    title: str = ""
    thumbnail: str | None = None
    duration: int | None = None
    formats: list[FormatInfo] = Field(default_factory=list)
    audioTracks: list[AudioTrack] = Field(default_factory=list)
    manualCaptions: list[CaptionTrack] = Field(default_factory=list)
    is_playlist: bool = False
    entries: list[PlaylistEntry] = Field(default_factory=list)


class DownloadRequest(BaseModel):
    url: str | None = None
    videoId: str | None = None
    container: Container = "mp4"
    quality: int | str = "best"
    audioTrackLang: str | None = None
    embedCaptions: list[str] = Field(default_factory=list)
    separateCaptions: bool = False
    subFormat: SubFormat = "srt"


class DownloadResponse(BaseModel):
    jobId: str
    batchId: str | None = None


class JobStatus(str, Enum):
    queued = "queued"
    downloading = "downloading"
    merging = "merging"
    postprocessing = "postprocessing"
    done = "done"
    error = "error"


class ErrorResponse(BaseModel):
    code: str
    message: str
