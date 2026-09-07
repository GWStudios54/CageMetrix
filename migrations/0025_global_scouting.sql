PRAGMA foreign_keys = ON;

-- Regional promotion registry. Promotion labels are coverage metadata only;
-- Scout Rating never awards points merely for appearing in a named promotion.
CREATE TABLE IF NOT EXISTS scout_promotions (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  region TEXT NOT NULL CHECK (region IN ('United States','Europe','Asia')),
  country TEXT,
  scope TEXT NOT NULL,
  official_url TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS scout_promotion_aliases (
  promotion_slug TEXT NOT NULL REFERENCES scout_promotions(slug) ON DELETE CASCADE,
  organization_alias TEXT NOT NULL,
  PRIMARY KEY (promotion_slug, organization_alias)
);
CREATE INDEX IF NOT EXISTS idx_scout_promotion_alias
  ON scout_promotion_aliases(organization_alias);

INSERT OR REPLACE INTO scout_promotions(slug,name,region,country,scope,official_url,active,verified_at) VALUES
('lfa','Legacy Fighting Alliance','United States','United States','regional_feeder','https://www.lfa.com/',1,'2026-09-07'),
('cffc','Cage Fury Fighting Championships','United States','United States','regional_feeder','https://cffc.tv/',1,'2026-09-07'),
('fury-fc','Fury Fighting Championship','United States','United States','regional_feeder','https://www.furyfc.tv/',1,'2026-09-07'),
('a1-combat','Urijah Faber''s A1 Combat','United States','United States','regional_feeder','https://a1combat.com/',1,'2026-09-07'),
('tuff-n-uff','Tuff-N-Uff','United States','United States','regional_feeder','https://tuffnuff.com/',1,'2026-09-07'),
('combate-global','Combate Global','United States','United States','regional_international','https://combateglobal.com/',1,'2026-09-07'),
('cage-warriors','Cage Warriors','Europe','United Kingdom / Ireland','regional_feeder','https://cagewarriors.com/',1,'2026-09-07'),
('oktagon','OKTAGON MMA','Europe','Czech Republic / Germany','major_regional','https://oktagonmma.com/',1,'2026-09-07'),
('ksw','KSW','Europe','Poland','major_regional','https://www.kswmma.com/',1,'2026-09-07'),
('ares','ARES Fighting Championship','Europe','France','regional_feeder','https://www.aresfighting.com/',1,'2026-09-07'),
('fnc','Fight Nation Championship','Europe','Croatia','regional_feeder','https://www.fnc.hr/',1,'2026-09-07'),
('aca','Absolute Championship Akhmat','Europe','Russia','major_regional','https://www.aca-mma.com/',1,'2026-09-07'),
('rizin','RIZIN Fighting Federation','Asia','Japan','major_regional','https://www.rizin.tv/',1,'2026-09-07'),
('pancrase','PANCRASE','Asia','Japan','regional_feeder','https://www.pancrase.co.jp/',1,'2026-09-07'),
('shooto','Professional Shooto','Asia','Japan','regional_feeder','https://www.shooto-mma.com/',1,'2026-09-07'),
('deep','DEEP','Asia','Japan','regional_feeder','https://www.deep2001.com/',1,'2026-09-07'),
('road-fc','ROAD FC','Asia','South Korea','regional_feeder','https://www.roadfc.com/',1,'2026-09-07'),
('black-combat','BLACK COMBAT','Asia','South Korea','regional_feeder','https://blackcombat-official.com/',1,'2026-09-07'),
('grachan','GRACHAN','Asia','Japan','regional_feeder',NULL,1,'2026-09-07'),
('brave-cf','BRAVE Combat Federation','Asia','Bahrain','international_feeder','https://www.bravecf.com/',1,'2026-09-07');

INSERT OR IGNORE INTO scout_promotion_aliases(promotion_slug,organization_alias) VALUES
('lfa','lfa'),('lfa','legacy fighting alliance'),
('cffc','cffc'),('cffc','cage fury fighting championships'),('cffc','cage fury fc'),
('fury-fc','fury fc'),('fury-fc','fury fighting championship'),('fury-fc','fury fighting championships'),
('a1-combat','a1 combat'),('a1-combat','urijah faber''s a1 combat'),('a1-combat','urijah faber a1 combat'),
('tuff-n-uff','tuff-n-uff'),('tuff-n-uff','tuff n uff'),('tuff-n-uff','tuff-n-uff fighting championships'),
('combate-global','combate global'),('combate-global','combate americas'),
('cage-warriors','cage warriors'),('cage-warriors','cage warriors fighting championship'),('cage-warriors','cage warriors fc'),
('oktagon','oktagon'),('oktagon','oktagon mma'),
('ksw','ksw'),('ksw','konfrontacja sztuk walki'),
('ares','ares'),('ares','ares fc'),('ares','ares fighting championship'),
('fnc','fnc'),('fnc','fight nation championship'),
('aca','aca'),('aca','absolute championship akhmat'),('aca','absolute championship berkut'),('aca','acb'),
('rizin','rizin'),('rizin','rizin fighting federation'),
('pancrase','pancrase'),
('shooto','shooto'),('shooto','professional shooto'),('shooto','shooto japan'),
('deep','deep'),('deep','deep impact'),
('road-fc','road fc'),('road-fc','road fighting championship'),
('black-combat','black combat'),('black-combat','blackcombat'),
('grachan','grachan'),
('brave-cf','brave cf'),('brave-cf','brave combat federation');

-- One rich, organization-agnostic dossier row per fighter per source snapshot.
CREATE TABLE IF NOT EXISTS scout_global_profiles (
  source_key TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  source_fighter_id TEXT NOT NULL,
  profile_slug TEXT NOT NULL,
  fighter_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  dob TEXT,
  height_cm REAL,
  reach_cm REAL,
  stance TEXT,
  nationality TEXT,
  gym TEXT,
  career_start_date TEXT,
  last_fight_date TEXT,
  current_organization TEXT,
  current_promotion_slug TEXT REFERENCES scout_promotions(slug),
  current_weight_class TEXT,
  career_bouts INTEGER NOT NULL DEFAULT 0,
  career_wins INTEGER NOT NULL DEFAULT 0,
  career_losses INTEGER NOT NULL DEFAULT 0,
  career_draws INTEGER NOT NULL DEFAULT 0,
  career_no_contests INTEGER NOT NULL DEFAULT 0,
  ko_tko_wins INTEGER NOT NULL DEFAULT 0,
  submission_wins INTEGER NOT NULL DEFAULT 0,
  decision_wins INTEGER NOT NULL DEFAULT 0,
  title_fight_bouts INTEGER NOT NULL DEFAULT 0,
  title_fight_wins INTEGER NOT NULL DEFAULT 0,
  organization_count INTEGER NOT NULL DEFAULT 0,
  recent_bouts_730d INTEGER NOT NULL DEFAULT 0,
  recent_wins_730d INTEGER NOT NULL DEFAULT 0,
  last_five_wins INTEGER NOT NULL DEFAULT 0,
  last_five_losses INTEGER NOT NULL DEFAULT 0,
  data_completeness REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(source_key,snapshot_id,source_fighter_id),
  UNIQUE(source_key,snapshot_id,profile_slug)
);
CREATE INDEX IF NOT EXISTS idx_scout_global_profiles_slug
  ON scout_global_profiles(profile_slug);
CREATE INDEX IF NOT EXISTS idx_scout_global_profiles_promotion
  ON scout_global_profiles(current_promotion_slug,last_fight_date DESC);
CREATE INDEX IF NOT EXISTS idx_scout_global_profiles_division
  ON scout_global_profiles(current_weight_class,last_fight_date DESC);
CREATE INDEX IF NOT EXISTS idx_scout_global_profiles_name
  ON scout_global_profiles(normalized_name);

-- Universal Scout Rating. Technical UFC-only metrics are intentionally not required.
CREATE TABLE IF NOT EXISTS scout_global_ratings (
  source_key TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  source_fighter_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  as_of_date TEXT NOT NULL,
  scout_rating REAL NOT NULL,
  global_skill REAL NOT NULL,
  resume_quality REAL NOT NULL,
  schedule_strength REAL NOT NULL,
  recent_form REAL NOT NULL,
  finishing_quality REAL NOT NULL,
  evidence_strength REAL NOT NULL,
  pre_fight_elo REAL NOT NULL,
  division_rank INTEGER,
  global_rank INTEGER,
  model_weights_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  PRIMARY KEY(source_key,snapshot_id,source_fighter_id,model_version)
);
CREATE INDEX IF NOT EXISTS idx_scout_global_rating_division
  ON scout_global_ratings(model_version,scout_rating DESC);
CREATE INDEX IF NOT EXISTS idx_scout_global_rating_fighter
  ON scout_global_ratings(source_key,snapshot_id,source_fighter_id);

CREATE TABLE IF NOT EXISTS scout_rating_models (
  model_version TEXT PRIMARY KEY,
  algorithm TEXT NOT NULL,
  trained_through TEXT,
  validation_start TEXT,
  validation_end TEXT,
  weights_json TEXT NOT NULL,
  validation_json TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DROP VIEW IF EXISTS scout_active_global_profiles;
CREATE VIEW scout_active_global_profiles AS
SELECT p.*
FROM scout_global_profiles p
JOIN mma_source_registry r
  ON r.source_key=p.source_key AND r.active_snapshot_id=p.snapshot_id;

DROP VIEW IF EXISTS scout_active_global_ratings;
CREATE VIEW scout_active_global_ratings AS
SELECT g.*
FROM scout_global_ratings g
JOIN mma_source_registry r
  ON r.source_key=g.source_key AND r.active_snapshot_id=g.snapshot_id;

DROP VIEW IF EXISTS scout_active_promotion_rosters;
CREATE VIEW scout_active_promotion_rosters AS
SELECT p.*,r.scout_rating,r.global_skill,r.resume_quality,r.schedule_strength,r.recent_form,
       r.finishing_quality,r.evidence_strength,r.division_rank,r.global_rank
FROM scout_active_global_profiles p
LEFT JOIN scout_active_global_ratings r
  ON r.source_key=p.source_key AND r.snapshot_id=p.snapshot_id AND r.source_fighter_id=p.source_fighter_id
WHERE p.current_promotion_slug IS NOT NULL;
