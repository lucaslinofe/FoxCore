import unittest
from offer_pipeline import triage

class PipelineTests(unittest.TestCase):
    def test_review_and_duplicate(self):
        record = {"title": "Produto em promoção", "product_url": "https://shopee.com.br/item",
                  "price": "79.90", "reference_price": "100"}
        result = triage([record, record])
        self.assertEqual(len(result["accepted"]), 1)
        self.assertEqual(result["rejected"][0]["reason"], "duplicada")
        self.assertEqual(result["published"], 0)
        self.assertEqual(result["mode"], "review_only")

    def test_rejects_bad_input(self):
        result = triage([{"title": "Incompleto"}, {"title": "Oferta teste", "product_url": "https://example.org/p", "price": 10}])
        self.assertEqual(len(result["accepted"]), 0)
        self.assertEqual(len(result["rejected"]), 2)

if __name__ == "__main__":
    unittest.main()
