-- Existing six-pick leagues continue drafting to the new 24-fighter roster size.
UPDATE fantasy_leagues SET status='drafting' WHERE status='active'
  AND (SELECT COUNT(*) FROM fantasy_picks WHERE league_id=fantasy_leagues.id)<seats*24;
