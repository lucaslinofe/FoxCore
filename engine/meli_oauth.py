"""OAuth Mercado Livre: geração de URL e troca de código, sem expor segredos.

Somente componentes auxiliares. O callback público e armazenamento seguro
de tokens precisam ser implementados antes de iniciar uma autorização real.
"""
import os
import secrets
from urllib.parse import urlencode
import requests

AUTHORIZE_URL = "https://auth.mercadolivre.com.br/authorization"
TOKEN_URL = "https://api.mercadolibre.com/oauth/token"
REDIRECT_URI = "https://foxcore-br.vercel.app/api/auth/mercadolivre/callback"

def authorization_url(client_id, state):
    if not client_id or not state or len(state) < 32:
        raise ValueError("Client ID ou estado OAuth inválido")
    return AUTHORIZE_URL + "?" + urlencode({
        "response_type": "code", "client_id": client_id,
        "redirect_uri": REDIRECT_URI, "state": state
    })

def new_state():
    return secrets.token_urlsafe(32)

def exchange_code(code, client_id, client_secret, redirect_uri=REDIRECT_URI, session=None):
    if not all((code, client_id, client_secret)) or redirect_uri != REDIRECT_URI:
        raise ValueError("Dados OAuth incompletos")
    request = session or requests
    response = request.post(TOKEN_URL, data={
        "grant_type": "authorization_code",
        "client_id": client_id,
        "client_secret": client_secret,
        "code": code,
        "redirect_uri": redirect_uri,
    }, timeout=20)
    if not response.ok:
        raise RuntimeError("Falha na autorização Mercado Livre (HTTP %s)" % response.status_code)
    payload = response.json()
    if not payload.get("access_token") or not payload.get("refresh_token"):
        raise RuntimeError("Resposta OAuth incompleta")
    return payload

def credentials_configured(environ=None):
    env = environ if environ is not None else os.environ
    return bool(env.get("MELI_AFFILIATE_CLIENT_ID") and env.get("MELI_AFFILIATE_CLIENT_SECRET"))
