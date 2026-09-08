PRAGMA foreign_keys = ON;

-- Core events were originally UFC-only. promotion_slug lets the same canonical
-- event pages carry official calendars from the broader Scout promotion graph
-- without changing the locked UFC prediction model.
ALTER TABLE events ADD COLUMN promotion_slug TEXT;
CREATE INDEX IF NOT EXISTS idx_events_promotion_slug_date
  ON events(promotion_slug,event_date DESC);

-- Two major promotions were intentionally outside the original regional-feeder
-- seed. They belong in the same research directory now that MMA Scouts tracks
-- promotion calendars as well as fighter histories.
INSERT OR REPLACE INTO scout_promotions(slug,name,region,country,scope,official_url,active,verified_at,notes) VALUES
('pfl','Professional Fighters League','United States','United States','global_major','https://pflmma.com/',1,'2026-09-08','Global promotion calendar and roster coverage; promotion label itself adds no Scout Rating credit.'),
('one','ONE Championship','Asia','Singapore','global_major','https://www.onefc.com/',1,'2026-09-08','Mixed-discipline promotion. Event calendar may include MMA, Muay Thai, kickboxing and grappling; fighter research remains MMA-scoped where applicable.');

INSERT OR IGNORE INTO scout_promotion_aliases(promotion_slug,organization_alias) VALUES
('pfl','pfl'),
('pfl','professional fighters league'),
('pfl','world series of fighting'),
('pfl','wsof'),
('pfl','pfl mena'),
('pfl','pfl europe'),
('pfl','pfl africa'),
('one','one'),
('one','one championship'),
('one','one fc');
