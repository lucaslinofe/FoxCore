"""Evidence-based comparison of public offer metadata against permitted product candidates."""
from product_matcher import rank
from offer_attributes import extract,normalize

def compare(offer,candidates,limit=5):
    base=rank(offer,candidates,limit=max(20,limit))
    by_code={str(x.get("product_code")):x for x in candidates}
    offer_meta=offer.get("source_metadata") or offer
    offer_model=set(extract(offer.get("title","")).get("model_hints",[]))
    results=[]
    for match in base:
        candidate=by_code.get(match["product_code"],{})
        candidate_meta=candidate.get("source_metadata") or candidate
        candidate_model=set(extract(candidate.get("title","")).get("model_hints",[]))
        conflicts=[]
        evidence=["title_overlap"]
        score=match["score"]
        if offer_model and candidate_model:
            if offer_model & candidate_model:
                score=min(99,score+15)
                evidence.append("matching_model_hint")
            else:
                conflicts.append("model_mismatch")
                score=min(score,30)
        seller_a=normalize(offer_meta.get("seller","")).strip()
        seller_b=normalize(candidate_meta.get("seller","")).strip()
        if seller_a and seller_b:
            if seller_a==seller_b:
                evidence.append("matching_seller")
                score=min(99,score+8)
            else:
                conflicts.append("seller_mismatch")
                score=min(score,45)
        price_a=offer_meta.get("price")
        price_b=candidate_meta.get("price")
        if isinstance(price_a,(float,int)) and isinstance(price_b,(float,int)) and price_a>0 and price_b>0:
            ratio=abs(price_a-price_b)/max(price_a,price_b)
            if ratio<=0.05:
                evidence.append("similar_price")
                score=min(99,score+3)
            elif ratio>0.4:
                conflicts.append("large_price_difference")
        results.append({**match,"score":round(score,1),"evidence":evidence,
                        "conflicts":conflicts,"verified":False,"status":"candidate_only"})
    return sorted(results,key=lambda x:x["score"],reverse=True)[:limit]
