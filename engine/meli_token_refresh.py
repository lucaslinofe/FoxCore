"""Renovação OAuth Mercado Livre, chamada apenas com credenciais protegidas.

O chamador deve persistir o novo refresh_token de forma atômica e criptografada.
Não registra nem imprime respostas com segredos.
"""
import requests

TOKEN_URL = "https://api.mercadolibre.com/oauth/token"

def refresh_access_token(refresh_token, client_id, client_secret, session=None):
    if not all(isinstance(v, str) and v.strip() for v in
               (refresh_token, client_id, client_secret)):
        raise ValueError("Credenciais OAuth incompletas")
    http = session or requests
    response = http.post(TOKEN_URL, data={
        "grant_type": "refresh_token",
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token,
    }, timeout=20)
    if not response.ok:
        raise RuntimeError("Falha na renovação OAuth (HTTP %s)" % response.status_code)
    payload = response.json()
    if not isinstance(payload, dict) or not all(payload.get(k) for k in
            ("access_token", "refresh_token", "expires_in")):
        raise RuntimeError("Resposta de renovação OAuth incompleta")
    return payload
