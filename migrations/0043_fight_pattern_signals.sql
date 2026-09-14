PRAGMA foreign_keys=ON;

-- Additional recruiting signal computed from fight history the warehouse
-- already stores (method, round_num) but never aggregated to profile level:
-- how fast a fighter finishes fights, and whether they've ever been finished
-- themselves (durability). Populated by scripts/build-global-scout-rating-v2.py
-- alongside the existing ko_tko_wins/submission_wins/etc. columns; these are
-- descriptive only and do not feed the Global Scout Rating.
ALTER TABLE scout_global_profiles ADD COLUMN finish_round_sum INTEGER NOT NULL DEFAULT 0;
ALTER TABLE scout_global_profiles ADD COLUMN first_round_finishes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE scout_global_profiles ADD COLUMN times_finished INTEGER NOT NULL DEFAULT 0;
