import os
import unittest
from unittest.mock import patch
from manus_dispatch import dispatch_offer

OFFER={"short_url":"https://meli.la/2x5LgDV","title":"Cuba Gourmet Para Cozinha","source_metadata":{"price":88}}

class FakeResponse:
    status_code=202
    def raise_for_status(self): pass
    def json(self): return {"request_id":"r1","status":"accepted"}

class FakeSession:
    def __init__(self): self.calls=0
    def post(self, url, **kwargs):
        self.calls+=1
        assert kwargs["allow_redirects"] is False
        assert kwargs["headers"]["Idempotency-Key"]=="r1"
        return FakeResponse()

class DispatchTests(unittest.TestCase):
    def test_disabled_by_default(self):
        with patch.dict(os.environ,{"FOX_MANUS_ENABLED":"false"}):
            self.assertEqual(dispatch_offer(OFFER)["status"],"disabled")
    def test_async_ack(self):
        fake=FakeSession()
        with patch.dict(os.environ,{"FOX_MANUS_ENABLED":"true",
             "FOX_MANUS_ENDPOINT":"https://adapter.example.com/resolve",
             "FOX_MANUS_TOKEN":"test-token"}):
            self.assertEqual(dispatch_offer(OFFER,session=fake,request_id="r1")["status"],"accepted")
        self.assertEqual(fake.calls,1)
    def test_no_token(self):
        with patch.dict(os.environ,{"FOX_MANUS_ENABLED":"true",
             "FOX_MANUS_TOKEN":""}):
            with self.assertRaises(RuntimeError): dispatch_offer(OFFER)

if __name__=="__main__": unittest.main()
