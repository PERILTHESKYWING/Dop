"""Tests for the parts of Dop Trainer that do not need KataGo: ratings, configs, CORS."""

import unittest

from doptrainer import rating
from doptrainer.cfgfile import with_overrides
from doptrainer.server import origin_allowed


class RatingTest(unittest.TestCase):
    def fit(self, results, anchor="gen0"):
        pairs = {}
        for winner, a, b, n in results:
            for _ in range(n):
                rating.add_result(pairs, winner, a, b)
        return rating.fit(list(pairs.values()), anchor)

    def test_anchor_is_zero(self):
        r = self.fit([("gen1", "gen0", "gen1", 6), ("gen0", "gen0", "gen1", 4)])
        self.assertEqual(r["gen0"][0], 0.0)

    def test_even_record_gives_equal_rating(self):
        r = self.fit([("gen1", "gen0", "gen1", 5), ("gen0", "gen0", "gen1", 5)])
        self.assertAlmostEqual(r["gen1"][0], 0.0, places=6)

    def test_three_to_one_is_about_190_elo(self):
        # 75% expected score is 191 Elo; the virtual draw pulls it in slightly.
        r = self.fit([("gen1", "gen0", "gen1", 30), ("gen0", "gen0", "gen1", 10)])
        self.assertTrue(170 < r["gen1"][0] < 191, r)

    def test_clean_sweep_stays_finite_and_ordered(self):
        r = self.fit([("gen1", "gen0", "gen1", 16), ("gen2", "gen1", "gen2", 16), ("gen2", "gen0", "gen2", 8)])
        self.assertLess(r["gen1"][0], r["gen2"][0])
        self.assertTrue(all(abs(e) < 5000 for e, _ in r.values()))

    def test_chain_through_intermediate(self):
        r = self.fit([("gen1", "gen0", "gen1", 12), ("gen0", "gen0", "gen1", 4),
                      ("gen2", "gen1", "gen2", 12), ("gen1", "gen1", "gen2", 4)])
        self.assertAlmostEqual(r["gen2"][0], 2 * r["gen1"][0], delta=5)

    def test_unconnected_players_left_out(self):
        r = self.fit([("gen1", "gen0", "gen1", 3), ("ref", "ref", "x", 3)])
        self.assertNotIn("ref", r)

    def test_parse_sgfs(self):
        text = "(;FF[4]PB[gen3]PW[gen2]RE[B+R];B[dd])\n(;FF[4]PB[gen2]PW[gen3]RE[W+3.5])\n(;FF[4]PB[a]PW[b]RE[0])\n"
        self.assertEqual(rating.games_from_sgfs(text), [("gen3", "gen2", "gen3"), ("gen2", "gen3", "gen3"), ("a", "b", None)])


class CfgTest(unittest.TestCase):
    def test_replace_add_drop(self):
        src = "a = 1  # one\nb=2\n# c = 3\nb = 4\nd = 5\n"
        out = with_overrides(src, {"b": 9, "c": True, "e": [1, 2]}, drop=("d",))
        lines = out.splitlines()
        self.assertIn("a = 1  # one", lines)
        self.assertEqual([l for l in lines if l.startswith("b")], ["b = 9"])
        self.assertIn("c = true", lines)
        self.assertIn("e = 1,2", lines)
        self.assertIn("# c = 3", lines)
        self.assertFalse(any(l.startswith("d") for l in lines))


class OriginTest(unittest.TestCase):
    def test_patterns(self):
        pats = ["http://localhost:5173", "https://*.vercel.app"]
        self.assertTrue(origin_allowed("https://dop-abc.vercel.app", pats))
        self.assertTrue(origin_allowed("http://localhost:5173", pats))
        self.assertFalse(origin_allowed("https://evil.example.com", pats))
        self.assertFalse(origin_allowed("https://vercel.app.evil.com", pats))


if __name__ == "__main__":
    unittest.main()
