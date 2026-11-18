"""Manus API v2 task submission; deliberately opt-in and never scrapes sources."""
import json
import os
import requests
from manus_contract import request_payload

MANUS_CREATE_URL = "https://api.manus.ai/v2/task.create"

def create_manus_task(offer, request_id, session=None):
    """Create an async Manus task using the official v2 API."""
    if os.getenv("FOX_MANUS_ENABLED", "").lower() != "true":
        return {"status": "disabled"}
    key = os.getenv("MANUS_API_KEY", "").strip()
    if not key:
        raise RuntimeError("MANUS_API_KEY not configured")
    payload = request_payload(request_id, offer)
    instruction = (
        "Identify the exact Mercado Livre product for this offer. "
        "The meli.la short link may redirect to an affiliate profile, not a product. "
        "Do not invent a product URL, catalog ID, or listing ID. "
        "Only associate IDs observed on the matching product page. "
        "If uncertain, report needs_review. "
        "Return a JSON object with status (resolved, needs_review, not_found), "
        "product_url, catalog_id, listing_id and evidence. "
        "Offer data: " + json.dumps(payload, ensure_ascii=False)
    )
    body = {
        "message": {"content": [{"type": "text", "text": instruction,
                                 "visibility": "visible"}]},
        "agent_profile": "standard",
        "interactive_mode": False,
        "share_visibility": "private",
        "hide_in_task_list": True,
        "title": "FOX product identification " + str(request_id)[:40],
    }
    client = session or requests
    response = client.post(MANUS_CREATE_URL, json=body,
        headers={"x-manus-api-key": key, "Content-Type": "application/json"},
        timeout=30, allow_redirects=False)
    response.raise_for_status()
    result = response.json()
    if result.get("ok") is not True or not isinstance(result.get("task_id"), str) or not result["task_id"]:
        raise ValueError("Manus did not return a valid task ID")
    return {"status": "accepted", "request_id": str(request_id),
            "task_id": result["task_id"]}
