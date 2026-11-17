"""Validação de links próprios de afiliado; não cria códigos ou credenciais."""
from urllib.parse import urlsplit

PROVIDERS = {
    "shopee": ("shopee.com.br", "shopee.com"),
    "mercado_livre": ("mercadolivre.com.br", "mercadolivre.com", "mercadolivre.com.mx"),
}

def validate_affiliate_link(provider, url):
    if provider not in PROVIDERS:
        raise ValueError("Marketplace não suportado")
    if not isinstance(url, str) or len(url) > 2048:
        raise ValueError("Link inválido")
    p = urlsplit(url)
    host = (p.hostname or "").lower()
    if p.scheme != "https" or not host or p.username or p.password:
        raise ValueError("Link HTTPS obrigatório")
    if not any(host == domain or host.endswith("." + domain)
               for domain in PROVIDERS[provider]):
        raise ValueError("Domínio do marketplace não corresponde ao provedor")
    if not p.path or p.path == "/":
        raise ValueError("Link de produto obrigatório")
    return url

def attach_own_link(offer, provider, affiliate_url, verified_owner=False):
    """A confirmação de propriedade deve ocorrer após verificação externa."""
    if not verified_owner:
        raise PermissionError("Propriedade do link de afiliado não verificada")
    if offer.get("status") not in ("pending", "approved"):
        raise ValueError("Oferta não elegível")
    result = dict(offer)
    result["affiliate_url"] = validate_affiliate_link(provider, affiliate_url)
    result["affiliate_provider"] = provider
    result["affiliate_verified"] = True
    return result
