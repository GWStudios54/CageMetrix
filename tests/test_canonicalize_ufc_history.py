#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

TARGET = Path(__file__).resolve().parents[1] / "scripts" / "canonicalize-ufc-history.py"
spec = importlib.util.spec_from_file_location("cagemetrix_canonicalize_ufc_history", TARGET)
if spec is None or spec.loader is None:
    raise RuntimeError(f"Unable to load {TARGET}")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def row(**overrides):
    base = {
        "fighter_id": 10,
        "source_key": "leandroiber_mmastats",
        "snapshot_id": "snapshot",
        "source_fight_id": "a",
        "event_date": "2025-05-10",
        "organization": "ksw",
        "event_name": "KSW 106 - Parnasse vs. Ziolkowski",
        "weight_class": "Lightweight",
        "is_major_org": 1,
        "method_raw": "TKO",
        "method_normalized": "TKO",
        "method_detail": None,
        "round_num": 2,
        "time_finish_seconds": None,
        "result": "W",
        "fighter_name": "Salahdine Parnasse",
        "normalized_name": "salahdine parnasse",
        "opponent_name": "Marian Ziolkowski",
        "opponent_normalized_name": "marian ziolkowski",
    }
    base.update(overrides)
    return base


class CanonicalHistoryTests(unittest.TestCase):
    def test_mirrored_source_rows_collapse_to_one_bout_and_keep_richer_row(self):
        sparse = row(source_fight_id="aaa", time_finish_seconds=None)
        rich = row(source_fight_id="bbb", time_finish_seconds=234)

        canonical, duplicates, conflicts = module.dedupe_history_rows([sparse, rich])

        self.assertEqual(len(canonical), 1)
        self.assertEqual(duplicates, 1)
        self.assertEqual(conflicts, 0)
        self.assertEqual(canonical[0]["source_fight_id"], "bbb")
        self.assertEqual(canonical[0]["time_finish_seconds"], 234)

    def test_event_punctuation_and_case_do_not_defeat_canonicalization(self):
        first = row(source_fight_id="a", event_name="KSW 106 - Parnasse vs. Ziolkowski")
        second = row(source_fight_id="b", event_name="ksw 106: parnasse VS ziolkowski")

        canonical, duplicates, _ = module.dedupe_history_rows([first, second])

        self.assertEqual(len(canonical), 1)
        self.assertEqual(duplicates, 1)

    def test_same_night_different_opponents_are_preserved(self):
        first = row(source_fight_id="a", opponent_name="Opponent One", opponent_normalized_name="opponent one")
        second = row(source_fight_id="b", opponent_name="Opponent Two", opponent_normalized_name="opponent two")

        canonical, duplicates, conflicts = module.dedupe_history_rows([first, second])

        self.assertEqual(len(canonical), 2)
        self.assertEqual(duplicates, 0)
        self.assertEqual(conflicts, 0)

    def test_conflicting_results_are_audited(self):
        first = row(source_fight_id="a", result="W")
        second = row(source_fight_id="b", result="L", time_finish_seconds=234)

        canonical, duplicates, conflicts = module.dedupe_history_rows([first, second])

        self.assertEqual(len(canonical), 1)
        self.assertEqual(duplicates, 1)
        self.assertEqual(conflicts, 1)


if __name__ == "__main__":
    unittest.main()
