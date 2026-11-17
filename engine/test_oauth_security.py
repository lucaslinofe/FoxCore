import unittest
from oauth_security import create_state, state_digest, validate_state, token_expiry

class SecurityTests(unittest.TestCase):
    def test_state(self):
        state = create_state()
        digest = state_digest(state)
        self.assertTrue(validate_state(state, digest, 1000, now=1100))
        self.assertFalse(validate_state("X" * 43, digest, 1000, now=1100))
        self.assertFalse(validate_state(state, digest, 1000, now=1601))
        self.assertFalse(validate_state(state, digest, 1000, now=999))

    def test_expiry_margin(self):
        self.assertEqual(token_expiry(3600, now=1000), 4480)
        with self.assertRaises(ValueError):
            token_expiry(60, now=1000)

if __name__ == "__main__":
    unittest.main()
