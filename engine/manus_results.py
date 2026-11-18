"""Read-only Manus v2 task status and structured output retrieval."""
import os
import requests
from manus_contract import validate_result

BASE = "https://api.manus.ai/v2/"

def _get(path, task_id, session=None, **params):
    key=os.getenv("MANUS_API_KEY","").strip()
    if not key: raise RuntimeError("MANUS_API_KEY not configured")
    client=session or requests
    response=client.get(BASE+path,headers={"x-manus-api-key":key},
        params={"task_id":task_id,**params},timeout=25,allow_redirects=False)
    response.raise_for_status()
    body=response.json()
    if body.get("ok") is not True: raise ValueError("Manus API response not successful")
    return body

def check_task(task_id, request_id, session=None):
    detail=_get("task.detail",task_id,session)
    task=detail.get("task") or {}
    if task.get("id")!=task_id: raise ValueError("Task ID mismatch")
    status=task.get("status")
    if status=="waiting": return {"status":"needs_review","reason":"manus_waiting"}
    if status in ("error","deleted"): return {"status":"error","reason":"manus_"+status}
    if status!="stopped" or task.get("has_running_background_jobs"):
        return {"status":"pending"}
    messages=_get("task.listMessages",task_id,session,order="desc",limit=100)
    events=messages.get("messages") or []
    if not isinstance(events,list): raise ValueError("Invalid Manus events")
    # Request newest events first: the structured output is emitted after completion.
    for event in events:
        if not isinstance(event,dict) or event.get("type")!="structured_output_result":
            continue
        output=event.get("structured_output_result") or {}
        if not output.get("success"): continue
        value=output.get("value")
        if not isinstance(value,dict): continue
        value=dict(value,request_id=str(request_id))
        return validate_result(value,request_id)
    return {"status":"needs_review","reason":"no_structured_output"}
