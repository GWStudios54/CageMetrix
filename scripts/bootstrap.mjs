import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDelimited, parseDate, parseHeightCm, parseReachCm, parsePair, slugify } from './lib/csv.mjs';
import { buildObservations, careerAggregates, buildRatings } from './lib/model.mjs';

const DB = 'cagemetrix';
const DATASET_KEY = 'ufc-datalab-2026-06-27-v2';
const STATS_URL = 'https://raw.githubusercontent.com/komaksym/UFC-DataLab/main/data/stats/stats_raw.csv';
const DETAILS_URL = 'https://raw.githubusercontent.com/komaksym/UFC-DataLab/main/data/external_data/raw_fighter_details.csv';
const MODEL_NAME = 'CageMetrix Descriptive OAR';
const MODEL_VERSION = '0.1.0';
const SOURCE_NAME = 'UFC DataLab';
const SOURCE_URL = STATS_URL;

function wrangler(args, capture = false) {
  return execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['wrangler', ...args], {
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: process.env
  }) || '';
}

const q = value => value === null || value === undefined || value === '' ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
const n = value => Number.isFinite(value) ? String(value) : 'NULL';

function detailsByName(rows) {
  return new Map(rows.map(row => [String(row.fighter_name || '').trim().toLowerCase(), row]));
}

function insertStatements(table, columns, records, rowSql, chunkSize = 100) {
  const out = [];
  for (let i = 0; i < records.length; i += chunkSize) {
    out.push(`INSERT OR REPLACE INTO ${table} (${columns.join(',')}) VALUES\n${records.slice(i, i + chunkSize).map(rowSql).join(',\n')};`);
  }
  return out;
}

function applyStatements(dir, prefix, statements, statementsPerFile = 30) {
  for (let i = 0; i < statements.length; i += statementsPerFile) {
    const part = Math.floor(i / statementsPerFile) + 1;
    const path = join(dir, `${prefix}-${String(part).padStart(3, '0')}.sql`);
    writeFileSync(path, `PRAGMA foreign_keys=ON;\n${statements.slice(i, i + statementsPerFile).join('\n')}\n`, 'utf8');
    console.log(`Applying ${prefix} part ${part}…`);
    wrangler(['d1','execute',DB,'--remote','--file',path]);
  }
}

async function main() {
  try {
    const status = wrangler(['d1','execute',DB,'--remote','--command',`SELECT value FROM bootstrap_state WHERE key='${DATASET_KEY}' LIMIT 1`,'--json'], true);
    if (status.includes('complete')) {
      console.log(`CageMetrix bootstrap ${DATASET_KEY} already complete.`);
      return;
    }
  } catch {
    console.log('No completed bootstrap marker found; starting seed import.');
  }

  const [statsResponse, detailsResponse] = await Promise.all([fetch(STATS_URL), fetch(DETAILS_URL)]);
  if (!statsResponse.ok || !detailsResponse.ok) throw new Error(`Seed download failed (${statsResponse.status}/${detailsResponse.status})`);
  const [statsText, detailsText] = await Promise.all([statsResponse.text(), detailsResponse.text()]);
  const rawFights = parseDelimited(statsText, ';').filter(row => row.red_fighter_name && row.blue_fighter_name && row.event_date);
  const detailMap = detailsByName(parseDelimited(detailsText, ','));
  const fightPairs = buildObservations(rawFights);
  const aggregates = careerAggregates(fightPairs);
  const { ratings, sourceMaxDate } = buildRatings(fightPairs, aggregates);
  const newest = new Date(`${sourceMaxDate}T00:00:00Z`);
  const activeCutoff = new Date(newest.valueOf() - 730 * 86400000).toISOString().slice(0, 10);

  const fighters = [...aggregates.values()].sort((a, b) => a.name.localeCompare(b.name)).map((a, index) => {
    const d = detailMap.get(a.name.toLowerCase()) || {};
    return {
      id: index + 1,
      name: a.name,
      slug: slugify(a.name),
      weightClass: a.weightClass,
      lastFight: a.lastFight,
      bouts: a.bouts,
      active: a.lastFight && a.lastFight >= activeCutoff ? 1 : 0,
      dob: parseDate(d.DOB),
      heightCm: parseHeightCm(d.Height),
      reachCm: parseReachCm(d.Reach),
      stance: d.Stance || null
    };
  });
  const ids = new Map(fighters.map(f => [f.name, f.id]));

  const boutTotals = [];
  for (const pair of fightPairs) {
    const row = pair.red.row;
    const [redTotalL, redTotalA] = parsePair(row.red_fighter_total_str);
    const [blueTotalL, blueTotalA] = parsePair(row.blue_fighter_total_str);
    const sourceKey = `ufc-datalab:${pair.red.eventDate || 'unknown'}:${pair.red.index}`;
    const redId = ids.get(pair.red.name);
    const blueId = ids.get(pair.blue.name);
    if (!redId || !blueId) continue;

    boutTotals.push({
      fighterId: redId, opponentId: blueId, sourceKey, eventDate: pair.red.eventDate, weightClass: pair.red.weightClass,
      durationSeconds: pair.red.durationSec, won: pair.red.won, kd: pair.red.kd,
      sigL: pair.red.sigL, sigA: pair.red.sigA, sigAbs: pair.red.sigAbs, sigFaced: pair.red.sigAbsA,
      totalL: redTotalL, totalA: redTotalA,
      tdL: pair.red.tdL, tdA: pair.red.tdA, tdAllowed: pair.red.tdAllowed, tdFaced: pair.red.tdFaced,
      sub: pair.red.sub, ctrl: pair.red.ctrlSec, oppCtrl: pair.blue.ctrlSec, finish: pair.red.finish ? 1 : 0
    });
    boutTotals.push({
      fighterId: blueId, opponentId: redId, sourceKey, eventDate: pair.blue.eventDate, weightClass: pair.blue.weightClass,
      durationSeconds: pair.blue.durationSec, won: pair.blue.won, kd: pair.blue.kd,
      sigL: pair.blue.sigL, sigA: pair.blue.sigA, sigAbs: pair.blue.sigAbs, sigFaced: pair.blue.sigAbsA,
      totalL: blueTotalL, totalA: blueTotalA,
      tdL: pair.blue.tdL, tdA: pair.blue.tdA, tdAllowed: pair.blue.tdAllowed, tdFaced: pair.blue.tdFaced,
      sub: pair.blue.sub, ctrl: pair.blue.ctrlSec, oppCtrl: pair.red.ctrlSec, finish: pair.blue.finish ? 1 : 0
    });
  }

  const model = `INSERT OR IGNORE INTO model_versions (name,version,kind,status,description,parameters_json,training_window_end) VALUES (${q(MODEL_NAME)},${q(MODEL_VERSION)},'rating','development','Opponent-adjusted descriptive bootstrap model built from fight-level UFC statistics.',${q(JSON.stringify({prior_minutes:45,recency_decay_years:3.5,normalization:'within-division'}))},${q(sourceMaxDate)});`;
  const fighterSql = insertStatements('fighters', ['id','slug','name','dob','height_cm','reach_cm','stance','current_weight_class','active','last_fight_date','ufc_bouts'], fighters, f => `(${f.id},${q(f.slug)},${q(f.name)},${q(f.dob)},${n(f.heightCm)},${n(f.reachCm)},${q(f.stance)},${q(f.weightClass)},${f.active},${q(f.lastFight)},${f.bouts})`, 120);
  const ratingRows = ratings.filter(r => ids.has(r.name));
  const ratingSql = insertStatements('ratings_history', ['fighter_id','model_version_id','as_of_date','weight_class','cmr','striking_offense','striking_defense','wrestling_offense','wrestling_defense','grappling','durability','pace','finishing','strength_of_schedule','recent_form','competitive_rating','technical_rating','resume_rating','confidence','sample_bouts','sample_minutes','components_json'], ratingRows, r => `(${ids.get(r.name)},(SELECT id FROM model_versions WHERE name=${q(MODEL_NAME)} AND version=${q(MODEL_VERSION)}),${q(sourceMaxDate)},${q(r.weightClass)},${r.cmr.toFixed(3)},${r.strikingOffense.toFixed(3)},${r.strikingDefense.toFixed(3)},${r.wrestlingOffense.toFixed(3)},${r.wrestlingDefense.toFixed(3)},${r.grappling.toFixed(3)},NULL,${r.pace.toFixed(3)},${r.finishing.toFixed(3)},${r.strengthOfSchedule.toFixed(3)},${r.recentForm.toFixed(3)},${r.eloRaw.toFixed(3)},${r.technical.toFixed(3)},${r.resume.toFixed(3)},${r.confidence.toFixed(3)},${r.bouts},${r.minutes.toFixed(3)},${q(JSON.stringify(r.components))})`, 80);
  const boutSql = insertStatements('bout_totals', ['fighter_id','opponent_id','source_key','event_date','weight_class','duration_seconds','won','knockdowns','sig_strikes_landed','sig_strikes_attempted','sig_strikes_absorbed','sig_strikes_faced','total_strikes_landed','total_strikes_attempted','takedowns_landed','takedowns_attempted','takedowns_allowed','takedowns_faced','submission_attempts','control_seconds','opponent_control_seconds','finish','source_name','source_url'], boutTotals, b => `(${b.fighterId},${b.opponentId},${q(b.sourceKey)},${q(b.eventDate)},${q(b.weightClass)},${b.durationSeconds},${b.won},${b.kd},${b.sigL},${b.sigA},${b.sigAbs},${b.sigFaced},${b.totalL},${b.totalA},${b.tdL},${b.tdA},${b.tdAllowed},${b.tdFaced},${b.sub},${b.ctrl},${b.oppCtrl},${b.finish},${q(SOURCE_NAME)},${q(SOURCE_URL)})`, 80);
  const finish = `INSERT OR REPLACE INTO bootstrap_state (key,value,updated_at) VALUES (${q(DATASET_KEY)},'complete',CURRENT_TIMESTAMP);`;

  const dir = mkdtempSync(join(tmpdir(), 'cagemetrix-'));
  try {
    applyStatements(dir, 'model', [model], 1);
    applyStatements(dir, 'fighters', fighterSql, 30);
    applyStatements(dir, 'ratings', ratingSql, 30);
    applyStatements(dir, 'bouts', boutSql, 20);
    applyStatements(dir, 'state', [finish], 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log(`CageMetrix seed complete: ${fighters.length} fighters, ${ratingRows.length} ratings, ${boutTotals.length} fighter-bout rows, data through ${sourceMaxDate}.`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
