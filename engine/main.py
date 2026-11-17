import os, time, json, hashlib, logging
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
from threading import Thread
import requests

logging.basicConfig(level=logging.INFO)
BASE=os.getenv("SUPABASE_URL","").rstrip("/")
KEY=os.getenv("SUPABASE_SERVICE_ROLE_KEY","").strip()
def db(table, method="GET", data=None, params=None):
    if not BASE or not KEY: raise RuntimeError("Database not configured")
    r=requests.request(method,BASE+"/rest/v1/"+table,headers={"apikey":KEY,**({} if KEY.startswith("sb_secret_") else {"Authorization":"Bearer "+KEY}),"Prefer":"return=representation"},json=data,params=params,timeout=20)
    if not r.ok: raise RuntimeError("Database HTTP "+str(r.status_code))
    return r.json() if r.content else []
def verify_database():
    if not BASE or not KEY: return False
    try:
        db("fox_settings",params={"select":"key","limit":"1"})
        return True
    except Exception as e:
        logging.warning("Database health verification failed: %s",str(e) if str(e).startswith("Database HTTP ") else type(e).__name__)
        return False

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
        if urlsplit(self.path).path not in ("/health", "/"):
            self.send_error(404); return
        body=json.dumps({"service":"foxcore-engine","configured":bool(BASE and KEY),"mode":"foundation","database_verified":verify_database()}).encode()
        self.send_response(200); self.send_header("Content-Type","application/json"); self.end_headers(); self.wfile.write(body)
if __name__=="__main__":
    Thread(target=loop,daemon=True).start()
    ThreadingHTTPServer(("0.0.0.0",int(os.getenv("PORT","10000"))),Health).serve_forever()
