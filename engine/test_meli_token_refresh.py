import unittest
from meli_token_refresh import refresh_access_token

class RefreshTests(unittest.TestCase):
    def test_refresh_payload(self):
        class Response:
            ok = True
            def json(self):
                return {"access_token": "new-access", "refresh_token": "new-refresh",
                        "expires_in": 21600}
        class Session:
            def post(self, url, data, timeout):
                self.data = data
                return Response()
        s = Session()
        result = refresh_access_token("old-refresh", "client", "secret", session=s)
        self.assertEqual(s.data["grant_type"], "refresh_token")
        self.assertEqual(result["refresh_token"], "new-refresh")

    def test_missing_credentials(self):
        with self.assertRaises(ValueError):
            refresh_access_token("", "client", "secret")

    def test_incomplete_response(self):
        class Response:
            ok = True
            def json(self): return {"access_token": "partial"}
        class Session:
            def post(self, url, data, timeout): return Response()
        with self.assertRaises(RuntimeError):
            refresh_access_token("refresh", "client", "secret", session=Session())

if __name__ == "__main__":
    unittest.main()
