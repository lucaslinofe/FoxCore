import json
import unittest
from unittest.mock import patch
from pechinchou_collect_probe import collect,parse_brl_price

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
    @patch("pechinchou_collect_probe.requests.get")
    def test_schema_diagnostic_records_names_not_values(self,get):
        get.return_value=Response({"props":{"offers":[
            {"title":"Oferta","short_url":"https://meli.la/Abcd123",
             "mysteryPrice":999.0,"sellerPrivate":"Sensitive Seller"}]}})
        offers,diagnostic=collect(with_diagnostics=True)
        self.assertEqual(len(offers),1)
        fields=diagnostic["offer_field_signatures"]
        self.assertEqual(fields["mysteryPrice:number"],1)
        self.assertEqual(fields["sellerPrivate:string"],1)
        self.assertNotIn("Sensitive Seller",str(diagnostic))
    def test_brl_price_formats(self):
        self.assertEqual(parse_brl_price("R$ 1.299,90"),1299.90)
        self.assertEqual(parse_brl_price("899,00"),899.0)
        self.assertIsNone(parse_brl_price("Grátis"))
    @patch("pechinchou_collect_probe.requests.get")
    def test_price_image_store_from_source(self,get):
        get.return_value=Response({"props":{"offers":[
            {"title":"TV","short_url":"https://meli.la/Abcd123",
             "price":"R$ 1.299,90","old_price":"R$ 1.599,90",
             "store":{"name":"Loja Exemplo"},"image":"https://example.org/tv.jpg"}]}})
        item=collect()[0]
        self.assertEqual(item["price"],1299.90)
        self.assertEqual(item["original_price"],1599.90)
        self.assertEqual(item["seller"],"Loja Exemplo")
        self.assertEqual(item["image_url"],"https://example.org/tv.jpg")
if __name__=="__main__":unittest.main()
