"""Opt-in Manus dispatcher for existing FOX queue. Disabled unless explicitly configured."""
import os
import uuid
from urllib.parse import urlsplit
import requests
from manus_contract import request_payload, validate_result

def _endpoint():
    url = os.getenv("FOX_MANUS_ENDPOINT", "").strip()
    parsed = urlsplit(url)
    if not url or parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
        raise RuntimeError("FOX_MANUS_ENDPOINT must be a trusted HTTPS endpoint")
    return url

def dispatch_offer(offer, *, session=None, request_id=None):
    """Submit one offer; endpoint must implement FOX's documented contract.

    No assumptions about a vendor's API. The endpoint may be an authorized adapter
    translating this contract to the actual Manus API.
    """
    if os.getenv("FOX_MANUS_ENABLED", "").lower() != "true":
        return {"status": "disabled"}
    token = os.getenv("FOX_MANUS_TOKEN", "").strip()
    if not token:
        raise RuntimeError("FOX_MANUS_TOKEN not configured")
    url = _endpoint()
    rid = request_id or str(uuid.uuid4())
    payload = request_payload(rid, offer)
    client = session or requests
    response = client.post(url, json=payload,
        headers={"Authorization": "Bearer " + token,
                 "Idempotency-Key": rid,
                 "Content-Type": "application/json"},
        timeout=25, allow_redirects=False)
    response.raise_for_status()
    if response.status_code not in (200, 201, 202):
        raise RuntimeError("Unexpected Manus adapter response")
    result = response.json()
    if response.status_code == 202:
        if result.get("request_id") != rid or result.get("status") != "accepted":
            raise ValueError("Invalid asynchronous acknowledgement")
        return {"request_id": rid, "status": "accepted"}
    return validate_result(result, rid)
