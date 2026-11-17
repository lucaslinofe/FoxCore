"""Preparação segura de ofertas fornecidas por canal autorizado ou manualmente.

Não coleta páginas, não copia links de afiliado de terceiros e não publica.
"""
import hashlib
from decimal import Decimal, InvalidOperation
from urllib.parse import urlsplit

ALLOWED_MARKETPLACES = {"mercadolivre.com.br", "mercadolivre.com", "shopee.com.br", "shopee.com"}

def _host(url):
    p = urlsplit(url)
    if p.scheme != "https" or not p.hostname or p.username or p.password:
        raise ValueError("URL HTTPS inválida")
    return p.hostname.lower().removeprefix("www.")

def prepare_offer(title, product_url, price, reference_price=None, coupon=None):
    """Valida dados recebidos; devolve candidato para revisão, sem gravação."""
    title = str(title).strip()
    if not 5 <= len(title) <= 250:
        raise ValueError("Título inválido")
    host = _host(product_url)
    if not any(host == d or host.endswith("." + d) for d in ALLOWED_MARKETPLACES):
        raise ValueError("Produto deve apontar para marketplace permitido")
    try:
        p = Decimal(str(price))
        ref = Decimal(str(reference_price)) if reference_price is not None else None
    except (InvalidOperation, ValueError):
        raise ValueError("Preço inválido") from None
    if not p.is_finite() or p <= 0 or (ref is not None and (not ref.is_finite() or ref <= 0)):
        raise ValueError("Preço inválido")
    discount = round(100 * (ref - p) / ref, 2) if ref and ref > p else Decimal("0")
    fingerprint = hashlib.sha256((host + "|" + urlsplit(product_url).path.rstrip("/") + "|" + str(p)).encode()).hexdigest()
    return {"source": "pechinchou", "title": title, "product_url": product_url,
            "price": str(p), "reference_price": str(ref) if ref else None,
            "coupon": str(coupon).strip()[:80] if coupon else None,
            "discount_percent": str(discount), "fingerprint": fingerprint,
            "status": "pending", "affiliate_url": None}
