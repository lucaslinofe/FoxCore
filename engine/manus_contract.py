"""Pure FOX ↔ Manus offer contract. No network requests or scraping."""
import re
from urllib.parse import urlsplit, parse_qs

SHORT = re.compile(r"^https://meli\.la/[A-Za-z0-9_-]{3,80}/?$")
CATALOG = re.compile(r"^/p/(MLB\d+)(?:/)?$", re.I)
LISTING = re.compile(r"^MLB\d+$", re.I)
HOSTS = {"mercadolivre.com.br", "www.mercadolivre.com.br",
         "produto.mercadolivre.com.br"}
STATUSES = {"resolved", "needs_review", "not_found", "error"}

def request_payload(request_id, offer):
    short = offer.get("short_url", "")
    if not SHORT.fullmatch(short):
        raise ValueError("Invalid source short link")
    title = str(offer.get("title") or "").strip()
    if len(title) < 5:
        raise ValueError("Missing offer title")
    metadata = offer.get("source_metadata") or {}
    return {"request_id": str(request_id), "source": "pechinchou",
            "source_offer_id": short, "title": title[:240],
            "price_brl": metadata.get("price"), "slug": offer.get("slug"),
            "short_url": short, "source_url": offer.get("source_url"),
            "observed_at": offer.get("observed_at")}

def validate_result(result, expected_request_id):
    if not isinstance(result, dict) or result.get("request_id") != str(expected_request_id):
        raise ValueError("Mismatched request")
    status = result.get("status")
    if status not in STATUSES:
        raise ValueError("Invalid status")
    if status != "resolved":
        return {"request_id": str(expected_request_id), "status": status,
                "product_url": None, "catalog_id": None, "listing_id": None}
    url = result.get("product_url")
    if not isinstance(url, str) or len(url) > 2048:
        raise ValueError("Missing product URL")
    p = urlsplit(url)
    if (p.scheme != "https" or p.hostname not in HOSTS or p.username or p.password
            or p.port not in (None, 443) or p.fragment):
        raise ValueError("Untrusted product URL")
    match = CATALOG.fullmatch(p.path)
    params = parse_qs(p.query)
    listing = params.get("wid", [None])[0]
    if listing and not LISTING.fullmatch(listing):
        raise ValueError("Invalid listing ID")
    # Product pages may use a listing URL with MLB identifier in its path.
    path_listing = re.search(r"/(MLB-?\d{7,15})(?:[/-]|$)", p.path, re.I)
    if not match and not path_listing:
        raise ValueError("Not a product URL")
    evidence = result.get("evidence")
    if not isinstance(evidence, list) or not any(
        isinstance(e, dict) and e.get("type") == "observed_product_page"
        and e.get("url") == url for e in evidence
    ):
        raise ValueError("Missing matching product evidence")
    catalog = match.group(1).upper() if match else None
    if result.get("catalog_id") not in (None, catalog):
        raise ValueError("Unobserved catalog ID")
    if result.get("listing_id") not in (None, listing):
        raise ValueError("Unobserved listing ID")
    return {"request_id": str(expected_request_id), "status": "resolved",
            "product_url": url, "catalog_id": catalog, "listing_id": listing}
