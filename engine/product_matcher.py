"""Conservative product-title candidate ranking. Never asserts identity or creates affiliate links."""
import re
import unicodedata

STOP={"de","do","da","dos","das","com","para","em","e","a","o","um","uma","kit","novo","original","produto","mercado","livre"}
def tokens(text):
    clean=unicodedata.normalize("NFKD",str(text or "")).encode("ascii","ignore").decode().lower()
    return [t for t in re.findall(r"[a-z0-9]+",clean) if len(t)>1 and t not in STOP]
def model_tokens(text):
    return {t for t in tokens(text) if any(c.isdigit() for c in t) and any(c.isalpha() for c in t)}
def rank(offer,candidates,limit=3):
    source=set(tokens(offer.get("title","")))
    source_models=model_tokens(offer.get("title",""))
    results=[]
    for candidate in candidates:
        code=str(candidate.get("product_code",""))
        if not re.fullmatch(r"MLB\d{7,15}",code):continue
        target=set(tokens(candidate.get("title","")))
        overlap=len(source&target)
        if not source or not target or overlap<2:continue
        precision=overlap/len(target)
        recall=overlap/len(source)
        score=round(100*(2*precision*recall/(precision+recall)),1) if precision+recall else 0
        target_models=model_tokens(candidate.get("title",""))
        if source_models and target_models and not source_models.issubset(target_models):score=min(score,35)
        if score>=40:
            results.append({"product_code":code,"score":score,"shared_terms":sorted(source&target)[:8],"status":"candidate_only","verified":False})
    return sorted(results,key=lambda c:c["score"],reverse=True)[:limit]
