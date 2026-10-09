"""Short-lived signed tokens for /stream and /mux (no open proxy)."""
from __future__ import annotations
import os
import structlog
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired

log = structlog.get_logger()

TOKEN_TTL_SECONDS = 600


def _secret() -> str:
    secret = os.environ.get("KOUTUBE_SECRET", "")
    if not secret:
        log.warning("KOUTUBE_SECRET unset; using dev-only default secret")
        secret = "koutube-dev-only-secret-change-me"
    return secret


def _serializer(purpose: str) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(_secret(), salt=f"koutube-{purpose}")


def mint(purpose: str, payload: dict) -> str:
    return _serializer(purpose).dumps(payload)


def verify(purpose: str, token: str, max_age: int = TOKEN_TTL_SECONDS) -> dict:
    try:
        data = _serializer(purpose).loads(token, max_age=max_age)
    except SignatureExpired as exc:
        raise ValueError("token-expired") from exc
    except BadSignature as exc:
        raise ValueError("token-invalid") from exc
    if not isinstance(data, dict):
        raise ValueError("token-invalid")
    return data
