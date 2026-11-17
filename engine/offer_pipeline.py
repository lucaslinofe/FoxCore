"""Pipeline offline de triagem. Não realiza scraping nem publicação."""
import json
from pathlib import Path
from pechinchou import prepare_offer

def triage(records):
    seen = set()
    accepted, rejected = [], []
    for i, item in enumerate(records):
        try:
            offer = prepare_offer(item["title"], item["product_url"], item["price"],
                                  item.get("reference_price"), item.get("coupon"))
            if offer["fingerprint"] in seen:
                rejected.append({"index": i, "reason": "duplicada"})
                continue
            seen.add(offer["fingerprint"])
            accepted.append(offer)
        except (KeyError, TypeError, ValueError) as exc:
            rejected.append({"index": i, "reason": "dados inválidos"})
    return {"accepted": accepted, "rejected": rejected,
            "mode": "review_only", "published": 0}

def process_file(input_path, output_path):
    data = json.loads(Path(input_path).read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError("A entrada deve ser uma lista JSON")
    result = triage(data)
    Path(output_path).write_text(json.dumps(result, ensure_ascii=False, indent=2),
                                 encoding="utf-8")
    return result

if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser(description="Triagem offline de ofertas fornecidas legitimamente")
    p.add_argument("input", help="Arquivo JSON com candidatos")
    p.add_argument("output", help="Arquivo JSON de revisão")
    args = p.parse_args()
    result = process_file(args.input, args.output)
    print(f"Em revisão: {len(result['accepted'])}; descartadas: {len(result['rejected'])}")
