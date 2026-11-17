import os, time, json, hashlib, logging
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
from threading import Thread
import requests
from pechinchou_collect_probe import collect
from product_matcher import rank

logging.basicConfig(level=logging.INFO)
BASE="https://bzfhxoxquggkijwreivu.supabase.co"
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
def pechinchou_diagnostic():
    """Read-only public offer discovery; never follow meli.la or publish."""
    started=datetime.now(timezone.utc).isoformat()
    try:
        offers=collect()
        # Compare only with catalog entries already verified and stored internally.
        catalog=db("fox_discovered_products",params={"select":"product_code,title,status","limit":"500"})
        suggestions=[]
        for offer in offers:
            matches=rank(offer,catalog)
            if matches:
                suggestions.append({"offer_title":offer.get("title","")[:160],"candidates":matches})
        summary={"collected":len(offers),"short_links":sum(bool(o.get("short_url")) for o in offers),
                 "identified_products":0,"imported":0,"published":0,
                 "reason":"Short-link redirects return 403 in automated environments; no verified MLB match",
                 "sample_titles":[o.get("title","")[:100] for o in offers[:3]],
                 "candidate_catalog_size":len(catalog),"candidate_offers":len(suggestions),
                 "suggestions":suggestions[:20],"diagnostic_only":True}
        db("fox_runs","POST",{"module":"PechinchouDiagnostic","status":"success",
            "finished_at":datetime.now(timezone.utc).isoformat(),"details":summary})
        logging.info("Pechinchou diagnostic collected %s offers",len(offers))
    except Exception as exc:
        logging.warning("Pechinchou diagnostic failed: %s",type(exc).__name__)
        db("fox_runs","POST",{"module":"PechinchouDiagnostic","status":"failed",
            "finished_at":datetime.now(timezone.utc).isoformat(),
            "details":{"reason":type(exc).__name__,"diagnostic_only":True}})

def cycle():
    s=settings()
    sources=db("fox_sources",params={"enabled":"eq.true","authorized":"eq.true"})
    # External connectors require independently verified provider credentials.
    db("fox_runs","POST",{"module":"FoxGuard","status":"idle" if not s.get("mining_enabled") else "blocked","finished_at":datetime.now(timezone.utc).isoformat(),"details":{"authorized_sources":len(sources),"dry_run":s.get("dry_run",True),"reason":"Provider connectors not configured"}})
def loop():
    last_probe=0
    while True:
        try: cycle()
        except Exception as e: logging.warning("Cycle unavailable: %s",type(e).__name__)
        if time.monotonic()-last_probe>=8*3600:
            last_probe=time.monotonic()
            try: pechinchou_diagnostic()
            except Exception as e: logging.warning("Pechinchou diagnostic unavailable: %s",type(e).__name__)
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
