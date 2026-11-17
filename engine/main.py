import os, time, json, hashlib, logging
from datetime import timedelta
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
from threading import Thread
import requests
from pechinchou_collect_probe import collect
from product_matcher import rank
from mercadolivre_search import search_candidates

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
        queued=0
        for offer in offers:
            short=offer.get("short_url","")
            if not short.startswith("https://meli.la/"):continue
            # Upsert only source metadata; never overwrite a reviewed product association.
            existing=db("fox_pechinchou_queue",params={"select":"short_url","short_url":"eq."+short,"limit":"1"})
            if not existing:
                db("fox_pechinchou_queue","POST",{"short_url":short,"title":offer.get("title","")[:240],
                    "status":"awaiting_product_identification"})
                queued+=1
        # Compare only with catalog entries already verified and stored internally.
        catalog=db("fox_discovered_products",params={"select":"product_code,title,status","limit":"500"})
        suggestions=[]
        api_statuses={}
        api_candidate_offers=0
        # Continue automated attempts, but respect 403/429 with a 24-hour cooldown.
        history=db("fox_runs",params={"select":"finished_at,details",
            "module":"eq.PechinchouDiagnostic","order":"finished_at.desc","limit":"1"})
        last=history[0] if history else {}
        prior=last.get("details") or {}
        restricted_at=prior.get("api_restricted_at")
        cooldown=False
        if restricted_at:
            try:
                restricted_dt=datetime.fromisoformat(restricted_at.replace("Z","+00:00"))
                cooldown=datetime.now(timezone.utc)-restricted_dt<timedelta(hours=24)
            except (ValueError,TypeError):pass
        next_offset=int(prior.get("search_offset",0) or 0)
        next_offset=next_offset%max(1,len(offers))
        if cooldown:
            api_statuses["cooldown_after_access_restriction"]=1
        else:
            batch=(offers[next_offset:]+offers[:next_offset])[:5]
            for offer in batch:
                lookup=search_candidates(offer)
                state=lookup["status"]
                api_statuses[state]=api_statuses.get(state,0)+1
                db("fox_pechinchou_queue","PATCH",{
                    "candidate_matches":lookup["candidates"],
                    "last_match_status":state,
                    "last_match_attempt_at":datetime.now(timezone.utc).isoformat()
                },params={"short_url":"eq."+offer["short_url"]})
                if lookup["candidates"]:
                    api_candidate_offers+=1
                    suggestions.append({"offer_title":offer.get("title","")[:160],
                        "source":"mercadolivre_public_search","candidates":lookup["candidates"]})
                next_offset=(next_offset+1)%max(1,len(offers))
                if state=="api_access_restricted":
                    restricted_at=datetime.now(timezone.utc).isoformat()
                    break
            else:
                restricted_at=None
        for offer in offers:
            matches=rank(offer,catalog)
            if matches:
                suggestions.append({"offer_title":offer.get("title","")[:160],"candidates":matches})
        summary={"collected":len(offers),"short_links":sum(bool(o.get("short_url")) for o in offers),
                 "identified_products":0,"imported":0,"published":0,
                 "reason":"Mercado Livre public search access restricted; automated retry uses cooldown. No verified MLB match." if restricted_at else "No verified MLB match; automated candidate search active.",
                 "sample_titles":[o.get("title","")[:100] for o in offers[:3]],
                 "new_queue_items":queued,"candidate_catalog_size":len(catalog),"candidate_offers":len(suggestions),
                 "api_statuses":api_statuses,"api_candidate_offers":api_candidate_offers,
                 "api_restricted_at":restricted_at,"search_offset":next_offset,
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
