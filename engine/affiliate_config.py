"""Configuração de credenciais; nunca expõe segredos em logs ou healthchecks.

A integração real depende dos contratos e endpoints oficiais das APIs aprovadas.
"""
import os

PROVIDER_ENV = {
    "shopee": ("SHOPEE_AFFILIATE_APP_ID", "SHOPEE_AFFILIATE_SECRET"),
    "mercado_livre": ("MELI_AFFILIATE_CLIENT_ID", "MELI_AFFILIATE_CLIENT_SECRET",
                       "MELI_AFFILIATE_ACCESS_TOKEN"),
}

def configured_providers(environ=None):
    env = os.environ if environ is None else environ
    return {provider: all(bool(env.get(name, "").strip()) for name in names)
            for provider, names in PROVIDER_ENV.items()}

def require_provider(provider, environ=None):
    if provider not in PROVIDER_ENV:
        raise ValueError("Provedor não suportado")
    if not configured_providers(environ)[provider]:
        raise RuntimeError("Credenciais de afiliado ainda não configuradas")
    return True
