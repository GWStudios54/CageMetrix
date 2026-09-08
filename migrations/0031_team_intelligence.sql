PRAGMA foreign_keys = ON;

-- Public professional team metadata. Team location is deliberately separate
-- from fighter base/location: training at a gym does not imply residence.
CREATE TABLE IF NOT EXISTS scout_teams (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT,
  region TEXT,
  country TEXT,
  website_url TEXT,
  source_url TEXT NOT NULL,
  confidence TEXT NOT NULL DEFAULT 'A' CHECK (confidence IN ('A','B','C')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  verified_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scout_team_aliases (
  team_slug TEXT NOT NULL REFERENCES scout_teams(slug) ON DELETE CASCADE,
  gym_alias TEXT NOT NULL,
  PRIMARY KEY(team_slug,gym_alias)
);
CREATE INDEX IF NOT EXISTS idx_scout_team_alias ON scout_team_aliases(gym_alias);

INSERT OR REPLACE INTO scout_teams(slug,name,city,region,country,website_url,source_url,confidence,active,verified_at) VALUES
('american-top-team','American Top Team','Coconut Creek','FL','United States','https://americantopteam.com/','https://americantopteam.com/','A',1,'2026-09-08'),
('xtreme-couture','Xtreme Couture MMA','Las Vegas','NV','United States','https://www.xcmma.com/','https://www.xcmma.com/','A',1,'2026-09-08'),
('kill-cliff-fc','Kill Cliff FC','Deerfield Beach','FL','United States','https://www.killclifffc.com/','https://www.killclifffc.com/','A',1,'2026-09-08'),
('city-kickboxing','City Kickboxing','Auckland',NULL,'New Zealand','https://citykickboxing.net.nz/','https://citykickboxing.net.nz/','A',1,'2026-09-08'),
('american-kickboxing-academy','American Kickboxing Academy','San Jose','CA','United States','https://www.americankickboxingacademy.com/','https://www.americankickboxingacademy.com/','A',1,'2026-09-08'),
('factory-x','Factory X Muay Thai','Englewood','CO','United States','https://factoryxmuaythai.com/','https://factoryxmuaythai.com/','A',1,'2026-09-08'),
('kings-mma','Kings MMA','Huntington Beach','CA','United States','https://kingsmma.com/','https://kingsmma.com/contact','A',1,'2026-09-08');

INSERT OR IGNORE INTO scout_team_aliases(team_slug,gym_alias) VALUES
('american-top-team','american top team'),('american-top-team','american top team hq'),('american-top-team','american top team headquarters'),('american-top-team','american top team coconut creek'),
('xtreme-couture','xtreme couture'),('xtreme-couture','xtreme couture mma'),('xtreme-couture','xcmma'),
('kill-cliff-fc','kill cliff fc'),('kill-cliff-fc','kill cliff'),
('city-kickboxing','city kickboxing'),('city-kickboxing','city kickboxing nz'),
('american-kickboxing-academy','american kickboxing academy'),('american-kickboxing-academy','aka san jose'),
('factory-x','factory x'),('factory-x','factory x mma'),('factory-x','factory x muay thai'),
('kings-mma','kings mma'),('kings-mma','king''s mma'),('kings-mma','kings mma huntington beach');

DROP VIEW IF EXISTS scout_active_team_matches;
CREATE VIEW scout_active_team_matches AS
SELECT p.source_key,p.source_fighter_id,p.profile_slug,p.fighter_name,p.gym,
       t.slug team_slug,t.name team_name,t.city team_city,t.region team_region,
       t.country team_country,t.website_url team_website,t.source_url team_source_url,
       t.confidence team_confidence,t.verified_at team_verified_at
FROM scout_active_global_profiles p
JOIN scout_team_aliases a ON lower(trim(p.gym))=a.gym_alias
JOIN scout_teams t ON t.slug=a.team_slug AND t.active=1
WHERE p.gym IS NOT NULL AND trim(p.gym)<>'';
