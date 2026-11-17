import unittest
from pechinchou import prepare_offer

class PechinchouPreparationTests(unittest.TestCase):
    def test_valid_marketplace(self):
        x = prepare_offer("Oferta de teste", "https://www.mercadolivre.com.br/produto", "80", "100")
        self.assertEqual(x["discount_percent"], "20.00")
        self.assertEqual(x["status"], "pending")
        self.assertIsNone(x["affiliate_url"])

    def test_rejects_external_and_insecure_urls(self):
        for url in ("https://example.com/item", "http://shopee.com.br/item",
                    "https://shopee.com.br.evil.example/item"):
            with self.assertRaises(ValueError):
                prepare_offer("Oferta de teste", url, 10)

    def test_deterministic_duplicate_key(self):
        args = ("Oferta de teste", "https://shopee.com.br/produto", 12)
        self.assertEqual(prepare_offer(*args)["fingerprint"], prepare_offer(*args)["fingerprint"])

    def test_invalid_price(self):
        with self.assertRaises(ValueError):
            prepare_offer("Oferta de teste", "https://shopee.com.br/p", "-2")

if __name__ == "__main__":
    unittest.main()
