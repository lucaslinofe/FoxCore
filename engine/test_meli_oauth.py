import unittest
from urllib.parse import urlsplit, parse_qs
from meli_oauth import authorization_url, new_state, exchange_code, credentials_configured

class OAuthTests(unittest.TestCase):
    def test_authorization_url(self):
        state = new_state()
        url = authorization_url("123", state)
        q = parse_qs(urlsplit(url).query)
        self.assertEqual(q["state"], [state])
        self.assertEqual(q["response_type"], ["code"])
        self.assertEqual(q["redirect_uri"], ["https://foxcore-br.vercel.app/api/auth/mercadolivre/callback"])

    def test_missing_credentials(self):
        self.assertFalse(credentials_configured({}))
        with self.assertRaises(ValueError):
            authorization_url("", new_state())

    def test_exchange_without_network(self):
        class FakeResponse:
            ok = True
            def json(self): return {"access_token": "token", "refresh_token": "refresh"}
        class FakeSession:
            def post(self, url, data, timeout):
                self.data = data
                self.url = url
                return FakeResponse()
        fake = FakeSession()
        result = exchange_code("code", "id", "secret", session=fake)
        self.assertEqual(result["access_token"], "token")
        self.assertEqual(fake.data["grant_type"], "authorization_code")

if __name__ == "__main__":
    unittest.main()
