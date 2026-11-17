import unittest
from multi_attribute_matcher import compare
class MultiAttributeTests(unittest.TestCase):
 def test_matching_model_seller_and_price_remain_unverified(self):
  offer={"title":"Smart TV AOC Roku 40S5166","source_metadata":{"seller":"Loja Um","price":1000}}
  candidates=[{"product_code":"MLB123456789","title":"TV AOC Roku 40S5166 Full HD","seller":"Loja Um","price":1000}]
  result=compare(offer,candidates)
  self.assertTrue(result)
  self.assertIn("matching_seller",result[0]["evidence"])
  self.assertFalse(result[0]["verified"])
 def test_conflicting_model_penalty(self):
  offer={"title":"TV AOC 40S5166 Roku Full HD"}
  candidates=[{"product_code":"MLB123456789","title":"TV AOC 50S5166 Roku Full HD"}]
  result=compare(offer,candidates)
  self.assertEqual(result,[])  # conflicting models are excluded by conservative initial rank
if __name__=="__main__":unittest.main()
