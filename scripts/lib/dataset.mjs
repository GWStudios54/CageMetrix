import { createHash } from 'node:crypto';
import { parseDelimited, parseDate, parseHeightCm, parseReachCm, parsePair } from './csv.mjs';
import { buildObservations, careerAggregates, buildRatings } from './model_v03.mjs';
import { resolveRosterStatus } from './roster.mjs';

export const MODEL_VERSION = '0.3.0';
export const MODEL_NAME = 'CageMetrix Opponent-Adjusted Rating';
export const STATS_URL = 'https://raw.githubusercontent.com/komaksym/UFC-DataLab/main/data/stats/stats_raw.csv';
export const DETAILS_URL = 'https://raw.githubusercontent.com/komaksym/UFC-DataLab/main/data/external_data/raw_fighter_details.csv';
export const hash = text => createHash('sha256').update(text).digest('hex');
export const q = value => value == null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
const n = value => Number.isFinite(value) ? String(value) : 'NULL';
const fighterSqlId = identity => `(SELECT fighter_id FROM fighter_source_ids WHERE provider='CageMetrix identity' AND external_id=${q(identity)})`;

export function prepareDataset(statsText, detailsText, checkedAt = new Date().toISOString()) {
  const raw = parseDelimited(statsText, ';');
  if (!raw.length || !raw.every(r => r.red_fighter_name && r.blue_fighter_name && r.event_date)) throw new Error('Incomplete statistics source');
  const pairs = buildObservations(raw);
  const aggregates = careerAggregates(pairs);
  const { ratings } = buildRatings(pairs);
  const sourceMaxDate = pairs.map(p => p.red.eventDate).sort().at(-1);
  if (sourceMaxDate > checkedAt.slice(0, 10)) throw new Error('Source contains future results');
  const detailMap = new Map();
  for (const d of parseDelimited(detailsText, ',')) {
    const key = d.fighter_name?.trim().toLowerCase();
    if (!key || detailMap.has(key)) throw new Error(`Ambiguous fighter details: ${key}`);
    detailMap.set(key, d);
  }
  const fighters = [...aggregates.values()].map(a => {
    // DataLab's sole Bruno details row is Blindado. Do not attach his biometrics
    // to Bulldog. The reviewed UFC profile provides Bulldog's height and reach.
    const d = a.identity.slug === 'bruno-silva' ? {} : detailMap.get(a.name.toLowerCase()) || {};
    return { ...a.identity, weightClass: a.weightClass, lastFight: a.lastFight, bouts: a.bouts,
      roster: resolveRosterStatus(a.name, a.lastFight, checkedAt.slice(0, 10)),
      dob: parseDate(d.DOB), heightCm: a.identity.slug === 'bruno-silva' ? 64 * 2.54 : parseHeightCm(d.Height),
      reachCm: a.identity.slug === 'bruno-silva' ? 65 * 2.54 : parseReachCm(d.Reach), stance: d.Stance || null };
  });
  if (ratings.some(r => !Number.isFinite(r.cmr) || r.cmr < 0 || r.cmr > 100)) throw new Error('Invalid rating output');
  const snapshotKey = `${MODEL_VERSION}:${hash(statsText + '\n' + detailsText)}`;
  return { pairs, fighters, ratings, sourceMaxDate, snapshotKey, checkedAt };
}

function inserts(table, columns, rows, size = 10) {
  const sql = [];
  for (let i = 0; i < rows.length; i += size) sql.push(`INSERT INTO ${table} (${columns}) VALUES\n${rows.slice(i, i + size).join(',\n')};`);
  return sql;
}

export function datasetSql(data) {
  const { fighters, pairs, ratings, sourceMaxDate, snapshotKey } = data;
  const modelId = `(SELECT id FROM model_versions WHERE name=${q(MODEL_NAME)} AND version=${q(MODEL_VERSION)})`;
  const sql = [
    'PRAGMA foreign_keys=ON;',
    `INSERT INTO model_versions (name,version,kind,status,description,parameters_json,training_window_end) VALUES (${q(MODEL_NAME)},${q(MODEL_VERSION)},'rating','development','Identity-corrected, sex-separated descriptive CMR; retrospective validation published separately.',${q(JSON.stringify({ technical: .56, elo_resume: .24, schedule: .10, recent_form: .10, evidence: '42% cage time + 58% bout count; not probability', no_contests: 'excluded from ratings', previous_division_years: 2 }))},${q(sourceMaxDate)}) ON CONFLICT(name,version) DO UPDATE SET training_window_end=excluded.training_window_end;`
  ];
  for (const f of fighters) {
    // UPSERT preserves existing IDs and all references. Never REPLACE fighters.
    sql.push(`INSERT INTO fighters (slug,name,dob,height_cm,reach_cm,stance,current_weight_class,active,roster_status,status_source,last_fight_date,ufc_bouts) VALUES (${q(f.slug)},${q(f.name)},${q(f.dob)},${n(f.heightCm)},${n(f.reachCm)},${q(f.stance)},${q(f.weightClass)},${f.roster.active},${q(f.roster.status)},${q(f.roster.source)},${q(f.lastFight)},${f.bouts}) ON CONFLICT(slug) DO UPDATE SET name=excluded.name,dob=excluded.dob,height_cm=excluded.height_cm,reach_cm=excluded.reach_cm,stance=excluded.stance,current_weight_class=excluded.current_weight_class,active=excluded.active,roster_status=excluded.roster_status,status_source=excluded.status_source,last_fight_date=excluded.last_fight_date,ufc_bouts=excluded.ufc_bouts,updated_at=CURRENT_TIMESTAMP;`);
    sql.push(`INSERT INTO fighter_source_ids (fighter_id,provider,external_id,external_url) VALUES ((SELECT id FROM fighters WHERE slug=${q(f.slug)}),'CageMetrix identity',${q(f.id)},${q(f.sourceUrl)}) ON CONFLICT(provider,external_id) DO UPDATE SET external_url=excluded.external_url,last_seen_at=CURRENT_TIMESTAMP;`);
  }
  // This provider's totals are a reproducible derived table. Replace them within
  // the same D1 file import as ratings, never in a separate delete operation.
  sql.push("DELETE FROM bout_totals WHERE source_name IN ('UFC DataLab','UFC / UFCalendar (UFCStats mirror)');");
  const bouts = [];
  for (const p of pairs) {
    const r = p.red.row;
    const sourceKey = `ufc-datalab:${hash([p.red.eventDate, r.event_name, p.red.fighterId, p.blue.fighterId, r.method, r.round, r.time].join('|')).slice(0, 32)}`;
    for (const [obs, opp] of [[p.red, p.blue], [p.blue, p.red]]) {
      const [totalL, totalA] = parsePair(r[`${obs.side}_fighter_total_str`]);
      bouts.push(`(${fighterSqlId(obs.fighterId)},${fighterSqlId(opp.fighterId)},${q(sourceKey)},${q(obs.eventDate)},${q(obs.weightClass)},${obs.durationSec},${obs.won},${obs.kd},${obs.sigL},${obs.sigA},${obs.sigAbs},${obs.sigAbsA},${totalL},${totalA},${obs.tdL},${obs.tdA},${obs.tdAllowed},${obs.tdFaced},${obs.sub},${obs.ctrlSec},${opp.ctrlSec},${Number(obs.finish)},${q(r.source_name || 'UFC DataLab')},${q(r.source_url || STATS_URL)},${q(r.fight_outcome === 'no_contest' ? 'NC' : obs.won === 1 ? 'W' : obs.won === 0 ? 'L' : 'D')})`);
    }
  }
  sql.push(...inserts('bout_totals', 'fighter_id,opponent_id,source_key,event_date,weight_class,duration_seconds,won,knockdowns,sig_strikes_landed,sig_strikes_attempted,sig_strikes_absorbed,sig_strikes_faced,total_strikes_landed,total_strikes_attempted,takedowns_landed,takedowns_attempted,takedowns_allowed,takedowns_faced,submission_attempts,control_seconds,opponent_control_seconds,finish,source_name,source_url,result', bouts, 40));
  const ratingRows = ratings.map(r => `(${fighterSqlId(r.fighterId)},${modelId},${q(sourceMaxDate)},${q(r.weightClass)},${r.cmr},${r.strikingOffense},${r.strikingDefense},${r.wrestlingOffense},${r.wrestlingDefense},${r.grappling},NULL,${r.pace},${r.finishing},${r.strengthOfSchedule},${r.recentForm},${r.eloRaw},${r.technical},${r.resume},${r.confidence},${r.bouts},${r.minutes},${q(JSON.stringify(r.components))},${q(snapshotKey)})`);
  // A new source hash appends a snapshot even if its date is unchanged. Old values
  // remain immutable and can be audited against rating_runs.source_key.
  sql.push(...inserts('ratings_history', 'fighter_id,model_version_id,as_of_date,weight_class,cmr,striking_offense,striking_defense,wrestling_offense,wrestling_defense,grappling,durability,pace,finishing,strength_of_schedule,recent_form,competitive_rating,technical_rating,resume_rating,confidence,sample_bouts,sample_minutes,components_json,snapshot_key', ratingRows));
  sql.push(`INSERT INTO rating_runs (model_version_id,source_key,source_max_date,fighters_scored,completed_at,notes) VALUES (${modelId},${q(snapshotKey)},${q(sourceMaxDate)},${ratings.length},CURRENT_TIMESTAMP,'v0.3.0 identity and division corrections; source hash identifies this immutable snapshot.');`);
  for (const event of data.eventArchive || []) sql.push(`INSERT INTO event_source_archive (source_url,event_date,payload_json) VALUES (${q(event.official_url)},${q(event.date)},${q(JSON.stringify(event))}) ON CONFLICT(source_url) DO UPDATE SET payload_json=excluded.payload_json,updated_at=CURRENT_TIMESTAMP;`);
  sql.push(statusSql(data));
  return sql.join('\n');
}

export function statusSql(data) {
  return `INSERT INTO bootstrap_state (key,value,updated_at) VALUES ('data:latest',${q(JSON.stringify({ model_version: MODEL_VERSION, source_max_date: data.sourceMaxDate, snapshot_key: data.snapshotKey, checked_at: data.checkedAt, fighters: data.fighters.length, ratings: data.ratings.length, bouts: data.pairs.length }))},CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP;`;
}
