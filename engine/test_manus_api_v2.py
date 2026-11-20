import os
import unittest
from unittest.mock import patch
from manus_api_v2 import create_manus_task, MANUS_CREATE_URL

OFFER={"short_url":"https://meli.la/2x5LgDV","title":"Cuba Gourmet Para Cozinha","source_metadata":{"price":88}}

class FakeResponse:
    def raise_for_status(self): pass
    def json(self): return {"ok":True,"request_id":"api-request","task_id":"task_123"}

class FakeSession:
    def post(self,url,**kwargs):
        assert url==MANUS_CREATE_URL
        assert kwargs["headers"]["x-manus-api-key"]=="test-key"
        assert kwargs["allow_redirects"] is False
        assert kwargs["json"]["message"]["content"][0]["type"]=="text"
        return FakeResponse()

class ManusV2Tests(unittest.TestCase):
    def test_disabled(self):
        with patch.dict(os.environ,{"FOX_MANUS_ENABLED":"false"}):
            self.assertEqual(create_manus_task(OFFER,"r1")["status"],"disabled")
    def test_create(self):
        with patch.dict(os.environ,{"FOX_MANUS_ENABLED":"true","MANUS_API_KEY":"test-key"}):
            result=create_manus_task(OFFER,"r1",session=FakeSession())
        self.assertEqual(result["task_id"],"task_123")
    def test_missing_key(self):
        with patch.dict(os.environ,{"FOX_MANUS_ENABLED":"true","MANUS_API_KEY":""}):
            with self.assertRaises(RuntimeError): create_manus_task(OFFER,"r1")

if __name__=="__main__": unittest.main()
