import unittest
from product_matcher import rank

class MatcherTests(unittest.TestCase):
    def test_same_model_candidate_only(self):
        results=rank({"title":"Smart TV AOC Roku 40S5166 40 polegadas"},[
            {"title":"Smart TV AOC Roku 40S5166 40 polegadas","product_code":"MLB1234567890"}])
        self.assertEqual(results[0]["product_code"],"MLB1234567890")
        self.assertFalse(results[0]["verified"])
    def test_different_model_rejected(self):
        results=rank({"title":"Smart TV AOC Roku 40S5166 40 polegadas"},[
            {"title":"Smart TV AOC Roku 43S5166 43 polegadas","product_code":"MLB1234567890"}])
        self.assertFalse(results)
    def test_invalid_code_rejected(self):
        self.assertFalse(rank({"title":"Smart TV AOC Roku"},[{"title":"Smart TV AOC Roku","product_code":"invalid"}]))
if __name__=="__main__":unittest.main()
