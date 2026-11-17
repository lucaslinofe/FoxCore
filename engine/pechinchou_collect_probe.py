"""Read-only Pechinchou offer discovery for browser diagnostics."""
import json, re, sys
from html import unescape
import requests

SOURCE="https://pechinchou.com.br/lojas/mercadolivre.com.br"
SHORT=re.compile(r"^https://meli\.la/[A-Za-z0-9_-]{3,80}/?$")
def parse_brl_price(value):
    if isinstance(value,(int,float)) and not isinstance(value,bool):
        return round(float(value),2) if 0<float(value)<10000000 else None
    if not isinstance(value,str):
        return None
    raw=value.strip().replace("R$","").replace(" ","")
    if not re.fullmatch(r"\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}|\d+(?:\.\d{2})?",raw):
        return None
    if "," in raw:
        raw=raw.replace(".","").replace(",",".")
    amount=float(raw)
    return round(amount,2) if 0<amount<10000000 else None
def collect(with_diagnostics=False):
    response=requests.get(SOURCE,timeout=20,headers={"User-Agent":"FoxCore-Readiness/1.0"})
    response.raise_for_status()
    match=re.search(r'<script[^>]+id=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>',response.text,re.S)
    if not match:raise RuntimeError("No Next.js data found")
    root=json.loads(unescape(match.group(1)))
    offers={}
    schema_fields={}
    def walk(node, depth=0):
        if depth>35:return
        if isinstance(node,dict):
            links=[v for k,v in node.items() if isinstance(v,str) and (k in ("long_url","short_url","affiliate_url") or "meli.la/" in v) and SHORT.fullmatch(v)]
            if links:
                # Only field names and value types, never raw seller data or URLs.
                for key,value in node.items():
                    if isinstance(key,str) and len(key)<90:
                        kind=("number" if isinstance(value,(float,int)) and not isinstance(value,bool)
                              else "string" if isinstance(value,str)
                              else "object" if isinstance(value,dict)
                              else "array" if isinstance(value,list) else "other")
                        signature=key+":"+kind
                        schema_fields[signature]=schema_fields.get(signature,0)+1
                title=next((str(node.get(k)) for k in ("title","name","product_name","description") if isinstance(node.get(k),str)),"")
                # Only direct product URLs in the SAME source object count as evidence.
                direct=[]
                for key,value in node.items():
                    if not isinstance(value,str) or key not in ("product_url","permalink","url","destination_url","original_url"):
                        continue
                    match=re.match(r"^https://(?:produto\.mercadolivre\.com\.br|www\.mercadolivre\.com\.br|mercadolivre\.com\.br)/[^\s?#]*?MLB-?(\d{7,15})(?:[^\s?#]*)?(?:[?#].*)?$",value,re.I)
                    if match:
                        direct.append({"product_code":"MLB"+match.group(1),"product_url":value.split("?")[0].split("#")[0]})
                # Preserve only metadata present in the same offer object.
                metadata={}
                for field,keys in {
                    "description":("description","subtitle","product_description"),
                    "seller":("seller_name","seller","store_name","vendor_name","store"),
                    "image_url":("image_url","image","thumbnail"),
                    "price":("price","sale_price","current_price","offer_price"),
                    "original_price":("original_price","old_price","list_price")
                }.items():
                    for key in keys:
                        value=node.get(key)
                        if isinstance(value,dict) and field=="seller":
                            value=next((value.get(k) for k in ("name","title","nickname") if isinstance(value.get(k),str)),None)
                        if field in ("price","original_price"):
                            amount=parse_brl_price(value)
                            if amount is not None:
                                metadata[field]=amount
                                break
                        if field in ("description","seller") and isinstance(value,str) and value.strip():
                            metadata[field]=value.strip()[:500 if field=="description" else 160]
                            break
                        if field=="image_url" and isinstance(value,str) and re.match(r"^https://[^\\s]+$",value):
                            metadata[field]=value[:600]
                            break
                for link in links:
                    item=offers.setdefault(link,{"short_url":link,"title":title[:240]})
                    item.update({k:v for k,v in metadata.items() if k not in item})
                    if direct:item["direct_product_candidates"]=direct[:3]
            for value in node.values():walk(value,depth+1)
        elif isinstance(node,list):
            for value in node:walk(value,depth+1)
    walk(root)
    result=list(offers.values())[:30]
    if with_diagnostics:
        return result,{"offer_field_signatures":dict(sorted(schema_fields.items(),key=lambda kv:-kv[1])[:50])}
    return result
if __name__=="__main__":
    with open(sys.argv[1] if len(sys.argv)>1 else "offers.json","w",encoding="utf8") as f:json.dump(collect(),f,ensure_ascii=False,indent=2)
