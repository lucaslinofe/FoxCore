import unittest
from affiliate_config import configured_providers, require_provider

class ConfigTests(unittest.TestCase):
    def test_missing_credentials(self):
        self.assertEqual(configured_providers({}), {"shopee": False, "mercado_livre": False})
        with self.assertRaises(RuntimeError):
            require_provider("shopee", {})

    def test_shopee_ready(self):
        env = {"SHOPEE_AFFILIATE_APP_ID": "test", "SHOPEE_AFFILIATE_SECRET": "test"}
        self.assertTrue(configured_providers(env)["shopee"])
        self.assertFalse(configured_providers(env)["mercado_livre"])

    def test_meli_ready(self):
        env = {"MELI_AFFILIATE_CLIENT_ID": "test", "MELI_AFFILIATE_CLIENT_SECRET": "test",
               "MELI_AFFILIATE_ACCESS_TOKEN": "test"}
        self.assertTrue(require_provider("mercado_livre", env))

if __name__ == "__main__":
    unittest.main()
