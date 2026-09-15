PRAGMA foreign_keys = ON;

-- Public directory of professional MMA training camps/teams. This is a
-- distinct concept from management_agencies: a camp is where a fighter
-- trains, not who represents them commercially. Seeded from a verified,
-- publicly documented list of real training camps.
CREATE TABLE IF NOT EXISTS training_camps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  city TEXT,
  region TEXT,
  country TEXT,
  website_url TEXT,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_training_camps_name
  ON training_camps(name);

-- Historical, source-backed camp/team affiliations. A fighter with no row
-- here is NOT assumed to be camp-less; scout_global_profiles.gym is a static
-- dataset snapshot and is never treated as a substitute for a sourced,
-- datable affiliation history. Current rows are unique per fighter, exactly
-- like fighter_management_history.
CREATE TABLE IF NOT EXISTS fighter_camp_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL,
  source_fighter_id TEXT NOT NULL,
  camp_id INTEGER REFERENCES training_camps(id) ON DELETE SET NULL,
  camp_name TEXT,
  coach_name TEXT,
  started_at TEXT,
  ended_at TEXT,
  is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0,1)),
  source_url TEXT,
  source_type TEXT NOT NULL DEFAULT 'reputable_trade_reporting',
  confidence TEXT NOT NULL DEFAULT 'C' CHECK (confidence IN ('A','B','C')),
  verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  CHECK (camp_id IS NOT NULL OR camp_name IS NOT NULL),
  CHECK (source_url IS NOT NULL OR source_type='verified_profile')
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fighter_camp_one_current
  ON fighter_camp_history(source_key,source_fighter_id)
  WHERE is_current=1;
CREATE INDEX IF NOT EXISTS idx_fighter_camp_camp_current
  ON fighter_camp_history(camp_id,is_current,verified_at DESC);
CREATE INDEX IF NOT EXISTS idx_fighter_camp_fighter
  ON fighter_camp_history(source_key,source_fighter_id,verified_at DESC);

-- Every published camp-affiliation row can retain multiple corroborating
-- public sources, same as fighter_contract_evidence/fighter_management_evidence.
CREATE TABLE IF NOT EXISTS fighter_camp_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  camp_history_id INTEGER NOT NULL REFERENCES fighter_camp_history(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  source_title TEXT,
  publisher TEXT,
  published_at TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN (
    'fighter_direct','coach_or_camp_direct','promotion_direct',
    'reputable_trade_reporting','reputable_interview',
    'secondary_reporting_with_attribution','archived_public_statement'
  )),
  confidence TEXT NOT NULL CHECK (confidence IN ('A','B','C')),
  verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  UNIQUE(camp_history_id,source_url)
);
CREATE INDEX IF NOT EXISTS idx_camp_evidence_history
  ON fighter_camp_evidence(camp_history_id,confidence,verified_at DESC);

-- Automated crawlers may discover possible camp-change disclosures, but
-- discovery never equals publication -- identical policy to
-- contract_intel_candidates. Candidates stay private until a source-backed
-- row is accepted into fighter_camp_history + fighter_camp_evidence.
CREATE TABLE IF NOT EXISTS camp_intel_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_key TEXT NOT NULL UNIQUE,
  source_url TEXT NOT NULL,
  source_title TEXT,
  publisher TEXT,
  published_at TEXT,
  source_type TEXT,
  fighter_name TEXT,
  normalized_name TEXT,
  source_key TEXT,
  source_fighter_id TEXT,
  camp_slug TEXT,
  camp_name TEXT,
  detected_event_type TEXT NOT NULL CHECK (detected_event_type IN ('joined','left','moved','status_update')),
  detected_summary TEXT,
  extraction_method TEXT NOT NULL DEFAULT 'signal_block_scoped_subject_v1',
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','accepted','rejected','duplicate','needs_identity')),
  discovered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_camp_candidates_review
  ON camp_intel_candidates(review_status,discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_camp_candidates_fighter
  ON camp_intel_candidates(source_key,source_fighter_id,review_status);

DROP VIEW IF EXISTS scout_current_camp;
CREATE VIEW scout_current_camp AS
SELECT h.source_key,h.source_fighter_id,h.camp_id,t.slug camp_slug,t.name camp_name_resolved,
       t.city,t.region,t.country,h.camp_name,h.coach_name,h.started_at,h.source_url,
       h.source_type,h.confidence,h.verified_at,h.last_checked_at
FROM fighter_camp_history h
LEFT JOIN training_camps t ON t.id=h.camp_id
WHERE h.is_current=1;

-- Seed the camp directory from a verified, publicly documented list of real
-- professional MMA training camps (Wikipedia: "List of professional MMA
-- training camps", cross-checked against each camp's own official site).
-- This is a starting set, not exhaustive.
INSERT OR IGNORE INTO training_camps(slug,name,city,region,country,website_url,verified_at) VALUES
  ('american-top-team','American Top Team','Coconut Creek','Florida','United States','https://americantopteam.com/',CURRENT_TIMESTAMP),
  ('american-kickboxing-academy','American Kickboxing Academy','San Jose','California','United States',NULL,CURRENT_TIMESTAMP),
  ('alliance-mma','Alliance MMA','San Diego','California','United States',NULL,CURRENT_TIMESTAMP),
  ('allstars-training-center','Allstars Training Center','Stockholm',NULL,'Sweden',NULL,CURRENT_TIMESTAMP),
  ('amc-pankration','AMC Pankration','Kirkland','Washington','United States',NULL,CURRENT_TIMESTAMP),
  ('brazilian-top-team','Brazilian Top Team','Rio de Janeiro',NULL,'Brazil',NULL,CURRENT_TIMESTAMP),
  ('busan-team-mad','Busan Team M.A.D','Busan',NULL,'South Korea',NULL,CURRENT_TIMESTAMP),
  ('cesar-gracie-fight-team','Cesar Gracie Fight Team','Pleasant Hill','California','United States',NULL,CURRENT_TIMESTAMP),
  ('china-top-team','China Top Team','Beijing',NULL,'China',NULL,CURRENT_TIMESTAMP),
  ('chute-boxe-academy','Chute Boxe Academy','Curitiba','Paraná','Brazil',NULL,CURRENT_TIMESTAMP),
  ('city-kickboxing','City Kickboxing','Auckland',NULL,'New Zealand',NULL,CURRENT_TIMESTAMP),
  ('elevation-fight-team','Elevation Fight Team','Denver','Colorado','United States',NULL,CURRENT_TIMESTAMP),
  ('enbo-fight-club','Enbo Fight Club','Chengdu','Sichuan','China',NULL,CURRENT_TIMESTAMP),
  ('evolve-mma','Evolve MMA',NULL,NULL,'Singapore',NULL,CURRENT_TIMESTAMP),
  ('factory-x','Factory X','Englewood','Colorado','United States',NULL,CURRENT_TIMESTAMP),
  ('fortis-mma','Fortis MMA','Dallas','Texas','United States',NULL,CURRENT_TIMESTAMP),
  ('fedor-team','FedorTeam','Stary Oskol',NULL,'Russia',NULL,CURRENT_TIMESTAMP),
  ('fight-ready','Fight Ready','Scottsdale','Arizona','United States',NULL,CURRENT_TIMESTAMP),
  ('jackson-wink-mma','Jackson Wink MMA Academy','Albuquerque','New Mexico','United States',NULL,CURRENT_TIMESTAMP),
  ('kill-cliff-fc','Kill Cliff FC','Deerfield Beach','Florida','United States',NULL,CURRENT_TIMESTAMP),
  ('kings-mma','Kings MMA','Huntington Beach','California','United States',NULL,CURRENT_TIMESTAMP),
  ('korean-top-team','Korean Top Team','Seoul',NULL,'South Korea',NULL,CURRENT_TIMESTAMP),
  ('krazy-bee','Krazy Bee','Tokyo',NULL,'Japan',NULL,CURRENT_TIMESTAMP),
  ('long-island-mma','Long Island MMA','Long Island','New York','United States',NULL,CURRENT_TIMESTAMP),
  ('london-shootfighters','London Shootfighters','London',NULL,'United Kingdom',NULL,CURRENT_TIMESTAMP),
  ('minnesota-martial-arts-academy','Minnesota Martial Arts Academy','Minneapolis','Minnesota','United States',NULL,CURRENT_TIMESTAMP),
  ('mma-factory','MMA Factory','Paris',NULL,'France',NULL,CURRENT_TIMESTAMP),
  ('mma-lab','MMA Lab','Glendale','Arizona','United States',NULL,CURRENT_TIMESTAMP),
  ('nova-uniao','Nova União','Rio de Janeiro',NULL,'Brazil',NULL,CURRENT_TIMESTAMP),
  ('onx-sports','Onx Sports','Denver','Colorado','United States',NULL,CURRENT_TIMESTAMP),
  ('phuket-top-team','Phuket Top Team','Phuket',NULL,'Thailand',NULL,CURRENT_TIMESTAMP),
  ('roufusport','Roufusport','Milwaukee','Wisconsin','United States',NULL,CURRENT_TIMESTAMP),
  ('sbg-ireland','SBG Ireland','Dublin',NULL,'Ireland',NULL,CURRENT_TIMESTAMP),
  ('serra-longo-fight-team','Serra-Longo Fight Team','Long Island','New York','United States',NULL,CURRENT_TIMESTAMP),
  ('syndicate-mma','Syndicate','Las Vegas','Nevada','United States',NULL,CURRENT_TIMESTAMP),
  ('team-alpha-male','Team Alpha Male','Sacramento','California','United States',NULL,CURRENT_TIMESTAMP),
  ('team-lloyd-irvin','Team Lloyd Irvin','Camp Springs','Maryland','United States',NULL,CURRENT_TIMESTAMP),
  ('team-renegade','Team Renegade','Birmingham',NULL,'United Kingdom',NULL,CURRENT_TIMESTAMP),
  ('teixeira-mma-fitness','Teixeira MMA & Fitness','Bethel','Connecticut','United States',NULL,CURRENT_TIMESTAMP),
  ('tiger-muay-thai','Tiger Muay Thai','Phuket',NULL,'Thailand',NULL,CURRENT_TIMESTAMP),
  ('tribe-tokyo-mma','Tribe Tokyo MMA','Tokyo',NULL,'Japan',NULL,CURRENT_TIMESTAMP),
  ('tristar-gym','Tristar Gym','Montreal','Quebec','Canada',NULL,CURRENT_TIMESTAMP),
  ('xtreme-couture','Xtreme Couture','Las Vegas','Nevada','United States',NULL,CURRENT_TIMESTAMP);
