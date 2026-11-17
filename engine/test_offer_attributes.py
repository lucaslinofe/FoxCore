import unittest
from offer_attributes import extract
class AttributeTests(unittest.TestCase):
 def test_tv_model(self):
  x=extract("Smart Tv Aoc Roku Tv 40 Full Hd 40s5166/78g")
  self.assertEqual(x["brand_hint"],"aoc")
  self.assertIn("40s5166/78g",x["model_hints"])
  self.assertFalse(x["product_identity_verified"])
 def test_fryer(self):
  x=extract("Air Fryer Oven Britânia 11L 1800W BAF11A")
  self.assertEqual(x["brand_hint"],"britania")
  self.assertIn("baf11a",x["model_hints"])
if __name__=="__main__":unittest.main()
