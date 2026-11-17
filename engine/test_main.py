import unittest
from main import score
class ScoreTests(unittest.TestCase):
    def test_discount(self): self.assertEqual(score(75,100),25)
    def test_invalid(self): self.assertEqual(score(100,80),0)
    def test_missing(self): self.assertEqual(score(100,None),0)
if __name__=="__main__": unittest.main()
