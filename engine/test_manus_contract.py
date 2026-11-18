import unittest
from manus_contract import request_payload, validate_result

class ManusContractTests(unittest.TestCase):
    def test_request(self):
        data=request_payload("r1",{"short_url":"https://meli.la/2x5LgDV","title":"Cuba Gourmet Para Cozinha","source_metadata":{"price":88}})
        self.assertEqual(data["price_brl"],88)
    def test_profile_is_not_product(self):
        with self.assertRaises(ValueError):
            validate_result({"request_id":"r1","status":"resolved",
              "product_url":"https://www.mercadolivre.com.br/social/pp20250311151339",
              "evidence":[{"type":"observed_product_page","url":"https://www.mercadolivre.com.br/social/pp20250311151339"}]},"r1")
    def test_catalog(self):
        url="https://www.mercadolivre.com.br/p/MLB12345678"
        out=validate_result({"request_id":"r1","status":"resolved","product_url":url,
              "evidence":[{"type":"observed_product_page","url":url}]},"r1")
        self.assertEqual(out["catalog_id"],"MLB12345678")
    def test_unverified(self):
        with self.assertRaises(ValueError):
            validate_result({"request_id":"r1","status":"resolved",
              "product_url":"https://www.mercadolivre.com.br/p/MLB12345678",
              "evidence":[]},"r1")
    def test_pending(self):
        self.assertEqual(validate_result({"request_id":"r1","status":"needs_review"},"r1")["status"],"needs_review")

if __name__=="__main__": unittest.main()
