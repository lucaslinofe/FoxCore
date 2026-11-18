"""FOX: reconcile existing Manus tasks every five minutes; no task creation or publication."""
import os,re,logging,requests
from datetime import datetime,timezone
from urllib.parse import urlsplit,parse_qs
def reconcile(db):
 key=os.getenv("MANUS_API_KEY","")
 if not key:return {"status":"disabled_missing_key"}
 jobs=db("fox_manus_jobs",params={"select":"id,manus_task_id,status","status":"eq.pending_manus","manus_task_id":"not.is.null","order":"created_at.asc","limit":"3"})
 done=0
 for job in jobs:
  try:
   r=requests.get("https://api.manus.ai/v2/task.listMessages",params={"task_id":job["manus_task_id"],"order":"desc","limit":"100"},headers={"x-manus-api-key":key},timeout=15)
   r.raise_for_status();data=r.json()
   if not data.get("ok"):continue
   out=next((m.get("structured_output_result") for m in data.get("messages",[]) if m.get("type")=="structured_output_result"),None)
   if not out or not out.get("success"):continue
   v=out.get("value") or {}
   if v.get("blocked"):continue
   raw=str(v.get("product_url") or "").strip()
   md=re.search(r"\]\((https://[^\s)]+)\)",raw)
   url=md.group(1) if md else raw
   parsed=urlsplit(url)
   if parsed.scheme!="https" or parsed.hostname not in ("mercadolivre.com.br","www.mercadolivre.com.br","produto.mercadolivre.com.br") or parsed.port or parsed.username or parsed.password:continue
   catalog=re.search(r"/p/(MLB\d{7,15})(?:/|$)",parsed.path,re.I)
   listing=re.search(r"(?:/|^)(MLB-?\d{7,15})(?:/|$)",parsed.path,re.I)
   if not catalog and not listing:continue
   cid=catalog.group(1).upper() if catalog else None
   claimed=str(v.get("catalog_id") or "")
   if cid and re.fullmatch(r"MLB\d{7,15}",claimed,re.I) and claimed.upper()!=cid:continue
   wid=parse_qs(parsed.query).get("wid",[""])[0]
   listing_id=wid if re.fullmatch(r"MLB\d{7,15}",wid,re.I) else str(v.get("listing_id") or "")
   evidence=str(v.get("evidence") or "")[:1700]
   if len(evidence)<10:continue
   note=(evidence+" | Origem: Manus; sem verificacao direta | Tipo: "+("catalogo" if cid else "anuncio")+((" | catalog_id="+cid) if cid else "")+((" | listing_id_indicado="+listing_id) if re.fullmatch(r"MLB\d{7,15}",listing_id,re.I) else "")+" | Link de afiliado nao verificado.")[:2000]
   now=datetime.now(timezone.utc).isoformat()
   rows=db("fox_manus_jobs","PATCH",{"status":"pending_conversion","product_id":cid or ("MLB"+re.sub(r"\D","",listing.group(1))),"product_url":parsed.scheme+"://"+parsed.netloc+parsed.path,"product_title":str(v.get("product_title") or "")[:250],"evidence":note,"updated_at":now},params={"id":"eq."+job["id"],"status":"eq.pending_manus"})
   done+=bool(rows)
  except Exception as exc:logging.warning("Manus reconciliation failed: %s",type(exc).__name__)
 # Also move completed manual reviews into the conversion queue, without generating links.
 reviews=db("fox_manus_jobs",params={"select":"id,product_url","status":"eq.pending_review","limit":"30"})
 for row in reviews:
  try:
   url=urlsplit(row.get("product_url") or "")
   if url.scheme=="https" and url.hostname in ("mercadolivre.com.br","www.mercadolivre.com.br","produto.mercadolivre.com.br") and re.search(r"MLB\d{7,15}",url.path,re.I):
    db("fox_manus_jobs","PATCH",{"status":"pending_conversion","updated_at":datetime.now(timezone.utc).isoformat()},params={"id":"eq."+row["id"],"status":"eq.pending_review"})
  except Exception as exc:logging.warning("Manus queue handoff failed: %s",type(exc).__name__)
 return {"polled":len(jobs),"converted":done,"affiliate_generation":False,"publishing":False}
