import os, time, json, hashlib, logging
from datetime import timedelta
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
from threading import Thread
import requests
from pechinchou_collect_probe import collect
from multi_attribute_matcher import compare
from mercadolivre_search import search_candidates
from offer_attributes import extract

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
        enriched=0
        direct_evidence=0
        # Include historical queue entries, not just the current Pechinchou page.
        existing_rows=db("fox_pechinchou_queue",params={
            "select":"short_url,title,extracted_attributes,candidate_matches,source_metadata","limit":"1000"})
        existing_by_url={row["short_url"]:row for row in existing_rows}
        current_by_url={o["short_url"]:o for o in offers if o.get("short_url","").startswith("https://meli.la/")}
        for short,offer in current_by_url.items():
            direct=offer.get("direct_product_candidates") or []
            metadata={k:offer[k] for k in ("description","seller","image_url","price","original_price") if k in offer}
            if direct:
                direct_evidence+=1
            if short not in existing_by_url:
                db("fox_pechinchou_queue","POST",{
                    "short_url":short,"title":offer.get("title","")[:240],
                    "status":"awaiting_product_identification","source_metadata":metadata,
                    "extracted_attributes":extract(offer.get("title","")),
                    "candidate_matches":[dict(c,status="source_direct_candidate",verified=False) for c in direct]})
                queued+=1
                enriched+=1
            elif direct and not (existing_by_url[short].get("candidate_matches") or []):
                db("fox_pechinchou_queue","PATCH",{
                    "candidate_matches":[dict(c,status="source_direct_candidate",verified=False) for c in direct],
                    "last_match_status":"direct_source_candidate"
                },params={"short_url":"eq."+short})
        for short,offer in current_by_url.items():
            if short in existing_by_url:
                metadata={k:offer[k] for k in ("description","seller","image_url","price","original_price") if k in offer}
                if metadata and metadata!=existing_by_url[short].get("source_metadata"):
                    db("fox_pechinchou_queue","PATCH",{"source_metadata":metadata},
                       params={"short_url":"eq."+short})
        for row in existing_rows:
            title=row.get("title") or current_by_url.get(row["short_url"],{}).get("title","")
            if not title or (row.get("extracted_attributes") or {}).get("source")=="pechinchou_title":
                continue
            db("fox_pechinchou_queue","PATCH",{
                "extracted_attributes":extract(title)
            },params={"short_url":"eq."+row["short_url"]})
            enriched+=1
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
                    **({"candidate_matches":lookup["candidates"]} if lookup["candidates"] else {}),
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
            matches=compare(offer,catalog)
            if matches:
                suggestions.append({"offer_title":offer.get("title","")[:160],"candidates":matches})
        queue_snapshot=db("fox_pechinchou_queue",params={
            "select":"short_url,title,product_code,candidate_matches,extracted_attributes",
            "limit":"1000"})
        queue_total=len(queue_snapshot)
        queue_enriched=sum((x.get("extracted_attributes") or {}).get("source")=="pechinchou_title"
                           for x in queue_snapshot)
        queue_with_candidates=sum(bool(x.get("candidate_matches")) for x in queue_snapshot)
        queue_verified=sum(bool(x.get("product_code")) for x in queue_snapshot)
        diagnostics={
            "source_direct_url_evidence":direct_evidence,
            "search_api_restricted":bool(restricted_at),
            "queue_total":queue_total,
            "queue_with_attributes":queue_enriched,
            "queue_with_candidates":queue_with_candidates,
            "queue_with_verified_product_code":queue_verified,
            "identification_blocker":"no_accessible_verified_product_source" if queue_verified==0 else None
        }
        summary={"collected":len(offers),"short_links":sum(bool(o.get("short_url")) for o in offers),
                 "identified_products":0,"imported":0,"published":0,
                 "reason":"Mercado Livre public search access restricted; automated retry uses cooldown. No verified MLB match." if restricted_at else "No verified MLB match; automated candidate search active.",
                 "sample_titles":[o.get("title","")[:100] for o in offers[:3]],
                 "new_queue_items":queued,"enriched_offers":enriched,"offers_with_direct_source_evidence":direct_evidence,"offers_with_source_metadata":sum(any(k in o for k in ("description","seller","image_url","price","original_price")) for o in offers),"identification_diagnostics":diagnostics,"candidate_catalog_size":len(catalog),"candidate_offers":len(suggestions),
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
