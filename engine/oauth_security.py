"""Proteções para fluxo OAuth, sem armazenar tokens em texto claro."""
import hashlib
import hmac
import secrets
import time

STATE_TTL_SECONDS = 600

def create_state():
    return secrets.token_urlsafe(32)

def state_digest(state):
    if not isinstance(state, str) or len(state) < 32:
        raise ValueError("Estado OAuth inválido")
    return hashlib.sha256(state.encode("utf-8")).hexdigest()

def validate_state(received, stored_digest, issued_at, now=None):
    now = time.time() if now is None else now
    if not isinstance(issued_at, (int, float)) or now < issued_at or now - issued_at > STATE_TTL_SECONDS:
        return False
    try:
        digest = state_digest(received)
    except ValueError:
        return False
    return isinstance(stored_digest, str) and hmac.compare_digest(digest, stored_digest)

def token_expiry(expires_in, now=None, safety_margin=120):
    now = time.time() if now is None else now
    if not isinstance(expires_in, (int, float)) or expires_in <= safety_margin:
        raise ValueError("Prazo do token inválido")
    return int(now + expires_in - safety_margin)
