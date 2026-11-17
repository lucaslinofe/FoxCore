"""Read-only Pechinchou -> Mercado Livre browser diagnostic.
Run: python browser_probe.py offers.json
Requires: pip install playwright && python -m playwright install chromium
No imports, affiliate-link generation or publication.
"""
import json, re, sys
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, TimeoutError as BrowserTimeout

SHORT=re.compile(r"^https://meli\.la/[A-Za-z0-9_-]{3,80}/?$")
MLB=re.compile(r"MLB-?(\d{7,15})",re.I)
HOSTS={"www.mercadolivre.com.br","mercadolivre.com.br","produto.mercadolivre.com.br"}
def inspect(offers):
    if not isinstance(offers,list) or len(offers)>30: raise ValueError("Expected up to 30 offers")
    output=[]
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        try:
            for offer in offers:
                short=offer.get("short_url","") if isinstance(offer,dict) else ""
                result={"short_url":short,"title":str(offer.get("title",""))[:200] if isinstance(offer,dict) else "", "products":[],"matched":False}
                if not SHORT.fullmatch(short):
                    result["status"]="invalid_short_url";output.append(result);continue
                context=browser.new_context(accept_downloads=False)
                page=context.new_page()
                try:
                    page.goto(short,wait_until="domcontentloaded",timeout=18000)
                    page.wait_for_timeout(1200)
                    final=urlsplit(page.url)
                    if final.scheme!="https" or final.hostname not in HOSTS:
                        result["status"]="unapproved_destination"
                        result["destination_scheme"]=final.scheme
                        result["destination_host"]=final.hostname or ""
                        result["destination_path"]=final.path[:180]
                        result["page_title"]=(page.title() or "")[:140]
                        output.append(result);continue
                    result["profile_url"]=final.scheme+"://"+final.netloc+final.path
                    links=page.locator("a[href]").evaluate_all("""nodes=>nodes.slice(0,1000).map(a=>({href:a.href,label:(a.innerText||a.getAttribute('aria-label')||'').trim().slice(0,120)}))""")
                    seen=set()
                    for link in links:
                        url=urlsplit(link["href"])
                        if url.scheme!="https" or url.hostname not in HOSTS:continue
                        match=MLB.search(url.path)
                        if not match or match.group(1) in seen:continue
                        seen.add(match.group(1))
                        result["products"].append({"product_code":"MLB"+match.group(1),"product_url":url.scheme+"://"+url.netloc+url.path,"label":link["label"]})
                    result["status"]="product_candidates_found" if seen else "no_product_links_in_dom"
                except BrowserTimeout:
                    result["status"]="navigation_timeout"
                    result["last_host"]=urlsplit(page.url).hostname or ""
                except Exception:
                    result["status"]="browser_navigation_failed"
                    result["last_host"]=urlsplit(page.url).hostname or ""
                finally:
                    context.close()
                output.append(result)
        finally:browser.close()
    return {"checked":len(output),"diagnostic_only":True,"imported":0,"affiliate_link_generated":False,"results":output}

if __name__=="__main__":
    with open(sys.argv[1],encoding="utf8") as f:offers=json.load(f)
    print(json.dumps(inspect(offers),ensure_ascii=False,indent=2))
