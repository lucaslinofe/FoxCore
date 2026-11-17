import unittest
from affiliate import validate_affiliate_link, attach_own_link

class AffiliateTests(unittest.TestCase):
    def test_valid_link(self):
        self.assertEqual(validate_affiliate_link("shopee", "https://shopee.com.br/item/1"),
                         "https://shopee.com.br/item/1")

    def test_invalid_hosts(self):
        for url in ("http://shopee.com.br/item", "https://shopee.com.br.evil.test/item",
                    "https://mercadolivre.com.br/item"):
            with self.assertRaises(ValueError):
                validate_affiliate_link("shopee", url)

    def test_unverified_owner_blocked(self):
        with self.assertRaises(PermissionError):
            attach_own_link({"status": "pending"}, "shopee",
                            "https://shopee.com.br/item/1")

    def test_verified_link_keeps_offer(self):
        offer = {"status": "pending", "price": "10"}
        result = attach_own_link(offer, "shopee",
                                 "https://shopee.com.br/item/1", verified_owner=True)
        self.assertTrue(result["affiliate_verified"])
        self.assertEqual(offer.get("affiliate_url"), None)

if __name__ == "__main__":
    unittest.main()
