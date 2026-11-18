import os
import unittest
from unittest.mock import patch
from manus_results import check_task

URL="https://www.mercadolivre.com.br/p/MLB12345678"
class FakeResponse:
    def __init__(self, body): self.body=body
    def raise_for_status(self): pass
    def json(self): return self.body
class FakeSession:
    def __init__(self, state="stopped", evidence=True):
        self.state=state
        self.evidence=evidence
    def get(self,url,**kwargs):
        if url.endswith("task.detail"):
            return FakeResponse({"ok":True,"task":{"id":"task1","status":self.state,
              "has_running_background_jobs":False}})
        return FakeResponse({"ok":True,"data":[{
            "type":"structured_output_result",
            "structured_output_result":{"success":True,"value":{
                "status":"resolved","product_url":URL,"catalog_id":"MLB12345678",
                "listing_id":None,
                "evidence":[{"type":"observed_product_page","url":URL}] if self.evidence else []}}}]})

class ManusResultsTests(unittest.TestCase):
    def test_pending(self):
        with patch.dict(os.environ,{"MANUS_API_KEY":"test"}):
            self.assertEqual(check_task("task1","r1",FakeSession("running"))["status"],"pending")
    def test_verified(self):
        with patch.dict(os.environ,{"MANUS_API_KEY":"test"}):
            self.assertEqual(check_task("task1","r1",FakeSession())["catalog_id"],"MLB12345678")
    def test_missing_evidence_rejected(self):
        with patch.dict(os.environ,{"MANUS_API_KEY":"test"}):
            with self.assertRaises(ValueError): check_task("task1","r1",FakeSession(evidence=False))

if __name__=="__main__": unittest.main()
