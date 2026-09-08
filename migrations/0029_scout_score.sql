PRAGMA foreign_keys = ON;

-- Scout Score is a discovery signal, not a fighter-strength rating.
-- Global Rating remains the opponent-adjusted current-strength measure stored
-- in scout_global_ratings.scout_rating. Scout Score ranks recently active
-- fighters by a separate scouting blend and keeps evidence/confidence outside
-- the score itself.
DROP VIEW IF EXISTS scout_active_prospect_scores;
CREATE VIEW scout_active_prospect_scores AS
WITH base AS (
  SELECT
    p.source_key,
    p.snapshot_id,
    p.source_fighter_id,
    p.profile_slug,
    p.fighter_name,
    p.current_weight_class,
    p.current_organization,
    p.current_promotion_slug,
    p.last_fight_date,
    p.career_bouts,
    p.career_wins,
    p.career_losses,
    p.career_draws,
    p.last_five_wins,
    p.last_five_losses,
    p.recent_bouts_730d,
    r.scout_rating AS global_rating,
    r.global_skill,
    r.resume_quality,
    r.schedule_strength,
    r.recent_form,
    r.finishing_quality,
    r.evidence_strength,
    CASE
      WHEN p.dob GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
      THEN CAST((julianday('now')-julianday(substr(p.dob,1,10)))/365.2425 AS INTEGER)
      ELSE NULL
    END AS age,
    MAX(0.0,julianday('now')-julianday(substr(p.last_fight_date,1,10))) AS days_since_last,
    CASE
      WHEN (p.career_wins+p.career_losses+p.career_draws)>0
      THEN (p.career_wins + 0.5*p.career_draws)*1.0/(p.career_wins+p.career_losses+p.career_draws)
      ELSE 0.5
    END AS career_win_rate,
    CASE
      WHEN (p.last_five_wins+p.last_five_losses)>0
      THEN p.last_five_wins*1.0/(p.last_five_wins+p.last_five_losses)
      WHEN (p.career_wins+p.career_losses+p.career_draws)>0
      THEN (p.career_wins + 0.5*p.career_draws)*1.0/(p.career_wins+p.career_losses+p.career_draws)
      ELSE 0.5
    END AS recent_win_rate,
    0.50*r.global_skill +
    0.15*r.resume_quality +
    0.15*r.schedule_strength +
    0.10*r.recent_form +
    0.10*r.finishing_quality AS strength_signal
  FROM scout_active_global_profiles p
  JOIN scout_active_global_ratings r
    ON r.source_key=p.source_key
   AND r.snapshot_id=p.snapshot_id
   AND r.source_fighter_id=p.source_fighter_id
   AND r.model_version='global-1.0.0'
  WHERE p.career_bouts>=3
    AND p.last_fight_date IS NOT NULL
    AND p.last_fight_date>=date('now','-1095 day')
), raw_components AS (
  SELECT
    base.*,
    strength_signal AS global_component,
    strength_signal + CASE
      WHEN age IS NULL THEN 0
      WHEN age<=20 THEN 20
      WHEN age=21 THEN 17
      WHEN age=22 THEN 14
      WHEN age=23 THEN 11
      WHEN age=24 THEN 8
      WHEN age=25 THEN 5
      WHEN age=26 THEN 3
      WHEN age BETWEEN 27 AND 29 THEN 0
      WHEN age=30 THEN -3
      WHEN age=31 THEN -5
      WHEN age=32 THEN -8
      WHEN age=33 THEN -11
      WHEN age=34 THEN -14
      WHEN age=35 THEN -18
      WHEN age=36 THEN -22
      ELSE -28
    END AS age_component_raw,
    50.0 + 60.0*(recent_win_rate-career_win_rate) + 0.45*(recent_form-50.0) AS trajectory_component_raw,
    recent_form AS expectation_component_raw,
    0.65*MAX(0.0,100.0-(days_since_last*100.0/1095.0)) +
    0.35*MIN(100.0,recent_bouts_730d*(100.0/6.0)) AS activity_component_raw
  FROM base
), components AS (
  SELECT
    raw_components.*,
    MAX(5.0,MIN(100.0,age_component_raw)) AS age_component,
    MAX(5.0,MIN(100.0,trajectory_component_raw)) AS trajectory_component,
    MAX(5.0,MIN(100.0,expectation_component_raw)) AS expectation_component,
    MAX(0.0,MIN(100.0,activity_component_raw)) AS activity_component
  FROM raw_components
), scored AS (
  SELECT
    components.*,
    0.35*global_component +
    0.25*age_component +
    0.20*trajectory_component +
    0.10*expectation_component +
    0.10*activity_component AS raw_scout_signal
  FROM components
), ranked AS (
  SELECT
    scored.*,
    ROUND(100.0*PERCENT_RANK() OVER (ORDER BY raw_scout_signal),1) AS scout_score,
    RANK() OVER (ORDER BY raw_scout_signal DESC) AS scout_rank,
    RANK() OVER (PARTITION BY current_weight_class ORDER BY raw_scout_signal DESC) AS division_scout_rank
  FROM scored
)
SELECT
  source_key,
  snapshot_id,
  source_fighter_id,
  profile_slug,
  fighter_name,
  current_weight_class,
  current_organization,
  current_promotion_slug,
  last_fight_date,
  career_bouts,
  career_wins,
  career_losses,
  career_draws,
  age,
  global_rating,
  ROUND(global_component,1) AS global_component,
  ROUND(age_component,1) AS age_adjusted_performance,
  ROUND(trajectory_component,1) AS trajectory,
  ROUND(expectation_component,1) AS expectation_performance,
  ROUND(activity_component,1) AS activity,
  ROUND(raw_scout_signal,2) AS raw_scout_signal,
  scout_score,
  scout_rank,
  division_scout_rank,
  evidence_strength,
  CASE WHEN age IS NULL THEN 0 ELSE 1 END AS age_known
FROM ranked;
