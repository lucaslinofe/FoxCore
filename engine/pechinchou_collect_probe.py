"""Read-only Pechinchou offer discovery for browser diagnostics."""
import json, re, sys
from html import unescape
import requests

SOURCE="https://pechinchou.com.br/lojas/mercadolivre.com.br"
SHORT=re.compile(r"^https://meli\.la/[A-Za-z0-9_-]{3,80}/?$")
def collect():
    response=requests.get(SOURCE,timeout=20,headers={"User-Agent":"FoxCore-Readiness/1.0"})
    response.raise_for_status()
    match=re.search(r'<script[^>]+id=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>',response.text,re.S)
    if not match:raise RuntimeError("No Next.js data found")
    root=json.loads(unescape(match.group(1)))
    offers={}
    def walk(node, depth=0):
        if depth>35:return
        if isinstance(node,dict):
            links=[v for k,v in node.items() if isinstance(v,str) and (k in ("long_url","short_url","affiliate_url") or "meli.la/" in v) and SHORT.fullmatch(v)]
            if links:
                title=next((str(node.get(k)) for k in ("title","name","product_name","description") if isinstance(node.get(k),str)),"")
                # Only direct product URLs in the SAME source object count as evidence.
                direct=[]
                for key,value in node.items():
                    if not isinstance(value,str) or key not in ("product_url","permalink","url","destination_url","original_url"):
                        continue
                    match=re.match(r"^https://(?:produto\\.mercadolivre\\.com\\.br|www\\.mercadolivre\\.com\\.br|mercadolivre\\.com\\.br)/[^\\s?#]*MLB-?(\\d{7,15})(?:[^\\s?#]*)?(?:[?#].*)?$",value,re.I)
                    if match:
                        direct.append({"product_code":"MLB"+match.group(1),"product_url":value.split("?")[0].split("#")[0]})
                for link in links:
                    item=offers.setdefault(link,{"short_url":link,"title":title[:240]})
                    if direct:item["direct_product_candidates"]=direct[:3]
            for value in node.values():walk(value,depth+1)
        elif isinstance(node,list):
            for value in node:walk(value,depth+1)
    walk(root)
    return list(offers.values())[:30]
if __name__=="__main__":
    with open(sys.argv[1] if len(sys.argv)>1 else "offers.json","w",encoding="utf8") as f:json.dump(collect(),f,ensure_ascii=False,indent=2)
