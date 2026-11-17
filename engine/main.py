import os, time, json, hashlib, logging
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
import requests

logging.basicConfig(level=logging.INFO)
BASE=os.getenv("SUPABASE_URL","").rstrip("/")
KEY=os.getenv("SUPABASE_SERVICE_ROLE_KEY","")
def db(table, method="GET", data=None, params=None):
    if not BASE or not KEY: raise RuntimeError("Database not configured")
    r=requests.request(method,BASE+"/rest/v1/"+table,headers={"apikey":KEY,"Authorization":"Bearer "+KEY,"Prefer":"return=representation"},json=data,params=params,timeout=20)
    if not r.ok: raise RuntimeError("Database HTTP "+str(r.status_code))
    return r.json() if r.content else []
def score(price, reference):
    if price<=0 or not reference or reference<=price: return 0
    return round(min(100,100*(reference-price)/reference),2)
def settings():
    return {x["key"]:x["value"] for x in db("fox_settings")}
def cycle():
    s=settings()
    sources=db("fox_sources",params={"enabled":"eq.true","authorized":"eq.true"})
    # External connectors require independently verified provider credentials.
    db("fox_runs","POST",{"module":"FoxGuard","status":"idle" if not s.get("mining_enabled") else "blocked","finished_at":datetime.now(timezone.utc).isoformat(),"details":{"authorized_sources":len(sources),"dry_run":s.get("dry_run",True),"reason":"Provider connectors not configured"}})
def loop():
    while True:
        try: cycle()
        except Exception as e: logging.warning("Cycle unavailable: %s",type(e).__name__)
        time.sleep(300)
class Health(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path!="/health":
            self.send_error(404); return
        body=json.dumps({"service":"foxcore-engine","configured":bool(BASE and KEY),"mode":"foundation"}).encode()
        self.send_response(200); self.send_header("Content-Type","application/json"); self.end_headers(); self.wfile.write(body)
if __name__=="__main__":
    Thread(target=loop,daemon=True).start()
    ThreadingHTTPServer(("0.0.0.0",int(os.getenv("PORT","10000"))),Health).serve_forever()
