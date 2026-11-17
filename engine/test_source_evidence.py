import json
import unittest
from unittest.mock import patch
from pechinchou_collect_probe import collect

class Response:
    def __init__(self, payload):
        self.text='<script id="__NEXT_DATA__" type="application/json">'+json.dumps(payload)+'</script>'
    def raise_for_status(self): pass

class SourceEvidenceTests(unittest.TestCase):
    @patch("pechinchou_collect_probe.requests.get")
    def test_direct_product_from_same_offer(self,get):
        get.return_value=Response({"props":{"offers":[
            {"title":"TV AOC 40S5166","short_url":"https://meli.la/Abcd123",
             "product_url":"https://produto.mercadolivre.com.br/MLB-2907566151-tv-aoc-_JM?tracking=1"}]}})
        offers=collect()
        self.assertEqual(offers[0]["direct_product_candidates"][0]["product_code"],"MLB2907566151")
    @patch("pechinchou_collect_probe.requests.get")
    def test_unrelated_product_not_associated(self,get):
        get.return_value=Response({"props":{"offers":[
            {"title":"TV AOC","short_url":"https://meli.la/Abcd123"},
            {"product_url":"https://produto.mercadolivre.com.br/MLB-2907566151-x-_JM"}]}})
        self.assertNotIn("direct_product_candidates",collect()[0])
if __name__=="__main__":unittest.main()
