PRAGMA foreign_keys = ON;

-- Force a one-time rebuild after canonicalizing UFC bout labels into real divisions.
-- The bootstrap will recreate this marker after the corrected import completes.
DELETE FROM bootstrap_state
WHERE key = 'ufc-datalab-2026-06-27-v2';
