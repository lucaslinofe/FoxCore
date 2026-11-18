"""Read-only Manus API credential probe. Never creates a task or logs secrets."""
import os
import logging
import requests

def probe():
    key = os.getenv("MANUS_API_KEY", "").strip()
    if not key:
        logging.warning("FOX_MANUS_AUTH_CHECK: missing_key")
        return False
    try:
        response = requests.get(
            "https://api.manus.ai/v2/task.list",
            headers={"x-manus-api-key": key},
            params={"limit": 1},
            timeout=15,
            allow_redirects=False,
        )
        if response.status_code == 200:
            try:
                valid = response.json().get("ok") is True
            except ValueError:
                valid = False
            logging.info("FOX_MANUS_AUTH_CHECK: %s", "authenticated" if valid else "invalid_response")
            return valid
        if response.status_code in (401, 403):
            logging.warning("FOX_MANUS_AUTH_CHECK: access_denied HTTP %s", response.status_code)
        else:
            logging.warning("FOX_MANUS_AUTH_CHECK: unexpected_http %s", response.status_code)
    except requests.RequestException:
        logging.warning("FOX_MANUS_AUTH_CHECK: network_error")
    return False
