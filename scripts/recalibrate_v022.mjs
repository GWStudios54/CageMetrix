import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDelimited } from './lib/csv.mjs';
import { buildObservations, careerAggregates, buildRatings } from './lib/model_v022.mjs';

const DB = 'cagemetrix';
const STATE_KEY = 'rating-recalibration-0.2.2-2026-06-27';
const STATS_URL = 'https://raw.githubusercontent.com/komaksym/UFC-DataLab/main/data/stats/stats_raw.csv';
const MODEL_NAME = 'CageMetrix Opponent-Adjusted Rating';
const MODEL_VERSION = '0.2.2';

function wrangler(args, capture = false) {
  return execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['wrangler', ...args], {
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: process.env
  }) || '';
}

const q = value => value === null || value === undefined || value === ''
  ? 'NULL'
  : `'${String(value).replaceAll("'", "''")}'`;

// Rating component metadata is intentionally verbose, so keep each INSERT well
// below D1/SQLite statement-size limits. This is still only a ratings refresh,
// not a full fighter/bout reseed.
function insertStatements(records, chunkSize = 10) {
  const out = [];
  for (let i = 0; i < records.length; i += chunkSize) {
    const values = records.slice(i, i + chunkSize).map(r => `(
      (SELECT id FROM fighters WHERE name=${q(r.name)} LIMIT 1),
      (SELECT id FROM model_versions WHERE name=${q(MODEL_NAME)} AND version=${q(MODEL_VERSION)} LIMIT 1),
      ${q(r.asOfDate)},${q(r.weightClass)},${r.cmr.toFixed(3)},${r.strikingOffense.toFixed(3)},${r.strikingDefense.toFixed(3)},
      ${r.wrestlingOffense.toFixed(3)},${r.wrestlingDefense.toFixed(3)},${r.grappling.toFixed(3)},NULL,${r.pace.toFixed(3)},
      ${r.finishing.toFixed(3)},${r.strengthOfSchedule.toFixed(3)},${r.recentForm.toFixed(3)},${r.eloRaw.toFixed(3)},
      ${r.technical.toFixed(3)},${r.resume.toFixed(3)},${r.confidence.toFixed(3)},${r.bouts},${r.minutes.toFixed(3)},${q(JSON.stringify(r.components))}
    )`).join(',\n');

    out.push(`INSERT OR REPLACE INTO ratings_history (
      fighter_id,model_version_id,as_of_date,weight_class,cmr,striking_offense,striking_defense,
      wrestling_offense,wrestling_defense,grappling,durability,pace,finishing,strength_of_schedule,
      recent_form,competitive_rating,technical_rating,resume_rating,confidence,sample_bouts,sample_minutes,components_json
    ) VALUES\n${values};`);
  }
  return out;
}

function applyStatements(dir, statements, statementsPerFile = 25) {
  for (let i = 0; i < statements.length; i += statementsPerFile) {
    const part = Math.floor(i / statementsPerFile) + 1;
    const path = join(dir, `v022-ratings-${String(part).padStart(3, '0')}.sql`);
    writeFileSync(path, `PRAGMA foreign_keys=ON;\n${statements.slice(i, i + statementsPerFile).join('\n')}\n`, 'utf8');
    console.log(`Applying CageMetrix v0.2.2 ratings part ${part}…`);
    wrangler(['d1', 'execute', DB, '--remote', '--file', path]);
  }
}

async function main() {
  try {
    const status = wrangler(['d1','execute',DB,'--remote','--command',`SELECT value FROM bootstrap_state WHERE key='${STATE_KEY}' LIMIT 1`,'--json'], true);
    if (status.includes('complete')) {
      console.log('CageMetrix v0.2.2 recalibration already complete.');
      return;
    }
  } catch {
    // Continue on a fresh database; bootstrap runs before this script.
  }

  console.log('Recalculating CageMetrix v0.2.2 with two-year prior-division carryover…');
  const response = await fetch(STATS_URL);
  if (!response.ok) throw new Error(`Stats download failed (${response.status})`);
  const rows = parseDelimited(await response.text(), ';').filter(row => row.red_fighter_name && row.blue_fighter_name && row.event_date);
  const pairs = buildObservations(rows);
  const aggregates = careerAggregates(pairs);
  const { ratings, sourceMaxDate } = buildRatings(pairs, aggregates);

  const modelParameters = {
    base_model: '0.2.1',
    ranking_confidence: '42% cage-time exposure + 58% bout-count evidence',
    division_transfer: 'current division plus immediately previous division for two years before current-division debut',
    transferred_observations: 'evaluated against opponent and division baselines from the division where the bout occurred',
    provisional: 'fewer than 5 retained rated bouts or ranking confidence below 55%',
    low_bout_penalty: '3 CMR points per missing retained bout below 5'
  };

  const modelSql = `INSERT OR IGNORE INTO model_versions (
    name,version,kind,status,description,parameters_json,training_window_end
  ) VALUES (
    ${q(MODEL_NAME)},${q(MODEL_VERSION)},'rating','development',
    'v0.2.2 division-transfer model: preserves two years of immediately previous-division evidence when a fighter debuts in a new division, while keeping each transferred bout normalized in its original division.',
    ${q(JSON.stringify(modelParameters))},${q(sourceMaxDate)}
  );`;

  const ratingRows = ratings.map(r => ({ ...r, asOfDate: sourceMaxDate }));
  const statements = [modelSql, ...insertStatements(ratingRows)];
  const stateSql = `INSERT OR REPLACE INTO bootstrap_state (key,value,updated_at) VALUES (${q(STATE_KEY)},'complete',CURRENT_TIMESTAMP);`;

  const dir = mkdtempSync(join(tmpdir(), 'cagemetrix-v022-'));
  try {
    applyStatements(dir, statements);
    applyStatements(dir, [stateSql], 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log(`CageMetrix v0.2.2 recalibration complete: ${ratingRows.length} ratings through ${sourceMaxDate}.`);
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
