"""Bounded, read-only Mercado Livre public search. No bypass or affiliate generation."""
import re
import requests
from product_matcher import rank

ENDPOINT="https://api.mercadolibre.com/sites/MLB/search"
def search_candidates(offer,limit=3):
    title=str(offer.get("title","")).strip()[:160]
    if len(title)<8:return {"status":"insufficient_title","candidates":[]}
    try:
        response=requests.get(ENDPOINT,params={"q":title,"limit":10},
            headers={"Accept":"application/json","User-Agent":"FoxCore-Product-Discovery/1.0"},
            timeout=10,allow_redirects=False)
    except requests.RequestException:
        return {"status":"network_unavailable","candidates":[]}
    if response.status_code in (401,403,429):
        return {"status":"api_access_restricted","http_status":response.status_code,"candidates":[]}
    if response.status_code!=200:
        return {"status":"api_unavailable","http_status":response.status_code,"candidates":[]}
    try:payload=response.json()
    except ValueError:return {"status":"invalid_api_response","candidates":[]}
    items=[]
    for item in payload.get("results",[])[:10]:
        code=str(item.get("id",""))
        if not re.fullmatch(r"MLB\d{7,15}",code):continue
        url=str(item.get("permalink",""))
        if not url.startswith(("https://www.mercadolivre.com.br/","https://produto.mercadolivre.com.br/")):continue
        items.append({"product_code":code,"title":str(item.get("title",""))[:240],"product_url":url})
    matches=rank(offer,items,limit)
    for match in matches:
        candidate=next((x for x in items if x["product_code"]==match["product_code"]),None)
        if candidate:match["product_url"]=candidate["product_url"]
    return {"status":"candidates_found" if matches else "no_reliable_candidates",
            "candidates":matches,"searched":len(items),"verified":False}
