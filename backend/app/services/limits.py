"""Shared slowapi limiter (single instance for middleware + decorators)."""
from slowapi import Limiter


def _key(request):
    return request.client.host if getattr(request, "client", None) else "anon"


limiter = Limiter(key_func=_key)
