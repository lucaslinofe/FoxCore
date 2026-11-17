"""Extract conservative product attributes from offer titles, without claiming MLB identity."""
import re
import unicodedata

BRANDS=("britania","philco","aoc","puma","kemei","taramps","reserva","fame","odin fit","sneeks","forged nutrition")
def normalize(text):
    return unicodedata.normalize("NFKD",str(text or "")).encode("ascii","ignore").decode().lower()
def extract(title):
    raw=normalize(title)
    brand=next((b for b in BRANDS if re.search(r"(?<![a-z])"+re.escape(b)+r"(?![a-z])",raw)),None)
    models=[]
    for token in re.findall(r"\b[a-z0-9]+(?:[-/][a-z0-9]+)*\b",raw):
        if len(token)>=4 and re.search(r"[a-z]",token) and re.search(r"\d",token):
            if not re.fullmatch(r"\d+(?:w|l|kg|mg|v|rms|cm|mm|hz)",token):
                models.append(token)
    sizes=re.findall(r"\b\d+(?:[.,]\d+)?\s*(?:polegadas|litros|kg|mg|w|rms|ml)\b",raw)
    return {"brand_hint":brand,"model_hints":list(dict.fromkeys(models))[:8],
            "specification_hints":list(dict.fromkeys(sizes))[:8],
            "source":"pechinchou_title","product_identity_verified":False}
