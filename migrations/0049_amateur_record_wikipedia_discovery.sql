PRAGMA foreign_keys = ON;

-- migrations/0046 shipped fighter_amateur_record as manual-entry-only, reasoning that there's no news
-- feed of "amateur record" announcements to crawl. That's still true, but Wikipedia's
-- Template:Infobox martial artist carries structured amateur-MMA-record fields (am_win, am_kowin,
-- am_subwin, am_loss, am_koloss, am_subloss, am_draw, am_nc -- verified against the template's own
-- documentation and real articles, e.g. Ian Machado Garry's infobox) for many fighters who have one.
-- This is a per-fighter structured lookup, not an events feed, so it's a batched weekly crawl over
-- already-known fighters rather than a daily news scan. Wikipedia is a name-search + disambiguation
-- source, not an exact-substring match against a known vocabulary the way camps/coaches/injuries are,
-- so identity is corroborated against an independent fact (date of birth, primarily) already on file
-- for that fighter before a candidate is queued as ordinary 'pending' review; a name match with no
-- independent corroboration is queued 'needs_identity' rather than assumed correct -- same
-- discovery-never-equals-publication policy as every other intel category. Publishing itself reuses
-- the existing setAmateurRecordApi (src/amateur-record-admin.ts) rather than a new endpoint.
CREATE TABLE IF NOT EXISTS amateur_record_intel_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_key TEXT NOT NULL UNIQUE,
  source_url TEXT NOT NULL,
  source_title TEXT,
  fighter_name TEXT,
  normalized_name TEXT,
  source_key TEXT NOT NULL,
  source_fighter_id TEXT NOT NULL,
  detected_wins INTEGER NOT NULL DEFAULT 0,
  detected_losses INTEGER NOT NULL DEFAULT 0,
  detected_draws INTEGER NOT NULL DEFAULT 0,
  detected_no_contests INTEGER NOT NULL DEFAULT 0,
  wiki_birth_date TEXT,
  our_dob TEXT,
  identity_basis TEXT NOT NULL DEFAULT 'unverified' CHECK (identity_basis IN (
    'birth_date_exact_match','no_independent_fact_on_file','unverified'
  )),
  detected_summary TEXT,
  extraction_method TEXT NOT NULL DEFAULT 'infobox_martial_artist_v1',
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','accepted','rejected','duplicate','needs_identity')),
  discovered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_amateur_record_candidates_review
  ON amateur_record_intel_candidates(review_status,discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_amateur_record_candidates_fighter
  ON amateur_record_intel_candidates(source_key,source_fighter_id,review_status);

-- Tracks every fighter this crawl has already checked against Wikipedia, including a miss (no page
-- found, or a page with no amateur-record infobox fields) -- without this, a batched weekly run
-- ordered by name would just keep re-checking the same alphabetically-first fighters forever instead
-- of ever reaching the rest of the roster. Amateur record is a static fact that basically never
-- changes once set, but a Wikipedia article can still be edited later to add previously-missing
-- infobox data, so a miss is eligible to be rechecked after enough time has passed rather than never.
CREATE TABLE IF NOT EXISTS amateur_record_wikipedia_lookups (
  source_key TEXT NOT NULL,
  source_fighter_id TEXT NOT NULL,
  checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  result TEXT NOT NULL CHECK (result IN ('no_page','no_amateur_record','candidate','error')),
  PRIMARY KEY(source_key,source_fighter_id)
);
