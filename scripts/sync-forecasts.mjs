import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { prepareDataset, q } from './lib/dataset.mjs';
import { slugify, displayName } from './lib/csv.mjs';
import { nameKey } from './lib/recent-source.mjs';
import { fighterIdentity } from './lib/identity.mjs';
import { FORECAST_NAME, FORECAST_VERSION, FORECAST_PARAMETERS, forecast } from './lib/forecast.mjs';
import { predictionSnapshot } from './lib/prediction-snapshot.mjs';
import { applyWarehousePrior, normalizeFighterName } from './lib/warehouse-prior.mjs';
import { PREDICTOR_V02_PRIOR_OPTIONS } from './lib/predictor_v02.mjs';

const args = process.argv.slice(2), remote = args.includes('--remote'), dry = args.includes('--dry-run');
if (!remote && !dry && !args.includes('--local')) throw new Error('Choose --dry-run, --local or --remote');
const now = new Date().toISOString();
const dataset = prepareDataset(readFileSync('.cache/refresh/stats.csv','utf8'),readFileSync('.cache/refresh/details.csv','utf8'),now);
const byName = new Map(dataset.fighters.map(f => [nameKey(f.name), f]));
const bySlug = new Map(dataset.fighters.map(f => [f.slug, f]));
const baseRatings = new Map(dataset.ratings.map(r => [r.fighterId,r]));
const modelId = `(SELECT id FROM model_versions WHERE name=${q(FORECAST_NAME)} AND version=${q(FORECAST_VERSION)})`;
const fighterId = slug => `(SELECT id FROM fighters WHERE slug=${q(slug)})`;
const location = remote ? '--remote' : '--local';

function wrangler(params, capture = false) {
  return execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js',...params],{
    encoding:'utf8',stdio:capture?['ignore','pipe','pipe']:'inherit',maxBuffer:20*1024*1024,env:process.env
  }) || '';
}
function d1Rows(statement) {
  const parsed=JSON.parse(wrangler(['d1','execute','cagemetrix',location,'--command',statement,'--json'],true));
  const parts=Array.isArray(parsed)?parsed:[parsed];
  return parts.flatMap(part=>part.results||[]);
}
function loadWarehouseSummaries(required=false) {
  try {
    const rows=d1Rows(`SELECT f.name AS fighter_name,h.* FROM ufc_fighter_history_summary h JOIN fighters f ON f.id=h.fighter_id WHERE h.pre_ufc_bouts>0 ORDER BY h.fighter_id`);
    if(required&&rows.length<1000)throw new Error(`Warehouse history coverage is unexpectedly small: ${rows.length}`);
    const map=new Map();
    for(const row of rows){const key=normalizeFighterName(row.fighter_name);if(key&&!map.has(key))map.set(key,row);}
    return map;
  } catch(error) {
    if(required)throw error;
    console.warn('Warehouse history unavailable for dry-run forecast preparation; verified production forecasts require remote history.');
    return new Map();
  }
}
const warehouseSummaries=loadWarehouseSummaries(remote);
function ratingFor(fighter) {
  if(!fighter)return null;
  const base=baseRatings.get(fighter.id)||null;
  const summary=warehouseSummaries.get(normalizeFighterName(fighter.name))||null;
  const rating=applyWarehousePrior(base,summary,PREDICTOR_V02_PRIOR_OPTIONS);
  if(!rating)return null;
  return {
    ...rating,
    name:fighter.name,
    warehouseSummary:summary,
    components:{
      ...(rating.components||{}),
      ...(summary?{warehouse_prior:{pre_ufc_bouts:Number(summary.pre_ufc_bouts||0),pre_ufc_wins:Number(summary.pre_ufc_wins||0),pre_ufc_losses:Number(summary.pre_ufc_losses||0),pre_ufc_finishes:Number(summary.pre_ufc_finishes||0),pre_ufc_major_org_bouts:Number(summary.pre_ufc_major_org_bouts||0),prior_score:rating.warehousePrior?.score??null,reliability:rating.warehousePrior?.reliability??null,applied_weight:rating.warehousePriorWeight??0,scope:'completed pre-UFC history only'}}:{})
    }
  };
}

const sql = [
  // Preserve every historical forecast model. Predictor 0.2 gets a new model
  // version, so all previously locked Predictor 0.1 predictions remain immutable.
  `UPDATE model_versions SET name='CageMetrix Elo Baseline' WHERE name='CageMetrix Win Probability' AND version='0.1.0' AND description LIKE 'Chronological Elo probabilities%';`,
  `INSERT INTO model_versions (name,version,kind,status,description,parameters_json,training_window_end) VALUES (${q(FORECAST_NAME)},${q(FORECAST_VERSION)},'prediction','production','Frozen Predictor 0.2 probabilities using UFC CMR/technical evidence plus verified completed pre-UFC résumé context for fighters who reached the UFC; no betting-market inputs.',${q(JSON.stringify(FORECAST_PARAMETERS))},${q(FORECAST_PARAMETERS.trained_through)}) ON CONFLICT(name,version) DO UPDATE SET status='production',description=excluded.description,parameters_json=excluded.parameters_json,training_window_end=excluded.training_window_end;`
];
async function html(url) {
  const response = await fetch(url,{signal:AbortSignal.timeout(45000)});
  if (!response.ok) throw new Error(`Official card unavailable (${response.status}): ${url}`);
  return response.text();
}
const list = new JSDOM(await html('https://www.ufc.com/events')).window.document;
const urls = [...new Set([...list.querySelectorAll('a[href]')].map(a=>new URL(a.href,'https://www.ufc.com').href.split('#')[0]).filter(h=>h.startsWith('https://www.ufc.com/event/') && !/road-to|contender/.test(h)))];
const cards = [];
mkdirSync('.cache/forecasts',{recursive:true});
for (const url of urls) {
  const pageHtml = await html(url);
  writeFileSync(`.cache/forecasts/${new URL(url).pathname.split('/').at(-1)}.html`,pageHtml);
  const dom = new JSDOM(pageHtml), doc = dom.window.document;
  const mainTimestamp = Number(doc.querySelector('[data-timestamp]')?.getAttribute('data-timestamp'));
  if (!Number.isFinite(mainTimestamp) || !mainTimestamp) { dom.window.close(); continue; }
  // Include prelims on the same card, not press conferences/weigh-ins elsewhere on the page.
  const timestamps = [...doc.querySelectorAll('[data-timestamp]')].map(e=>Number(e.getAttribute('data-timestamp'))).filter(t=>t >= mainTimestamp-12*3600 && t<=mainTimestamp);
  const startsAt = new Date(Math.min(...timestamps)*1000).toISOString();
  if (startsAt <= now || Date.parse(startsAt)-Date.parse(now)>65*86400000) { dom.window.close(); continue; }
  const slug = new URL(url).pathname.split('/').at(-1);
  const title = doc.querySelector('meta[property="og:title"]')?.content?.replace(/\s*\|\s*UFC.*$/,'') || slug;
  const eventId = `(SELECT id FROM events WHERE slug=${q(slug)})`;
  sql.push(`INSERT INTO events (slug,name,event_date,status,source_url,starts_at) VALUES (${q(slug)},${q(title)},${q(startsAt.slice(0,10))},'scheduled',${q(url)},${q(startsAt)}) ON CONFLICT(slug) DO UPDATE SET name=excluded.name,event_date=excluded.event_date,source_url=excluded.source_url,starts_at=excluded.starts_at;`);
  const bouts = [];
  for (const [index, card] of [...doc.querySelectorAll('.c-listing-fight')].entries()) {
    const fighter = side => {
      const corner = card.querySelector(`.c-listing-fight__corner-name--${side}`);
      const name = displayName(corner?.textContent.replace(/\s+/g,' ').trim());
      if (!name) return null;
      const sourceSlug = corner?.querySelector('a')?.href.split('/').filter(Boolean).at(-1);
      return bySlug.get(sourceSlug) || byName.get(nameKey(name)) || { name, slug:slugify(name), id:`cagemetrix:${slugify(name)}` };
    };
    const a=fighter('red'), b=fighter('blue');
    if (!a || !b) continue;
    const division = card.querySelector('.c-listing-fight__class-text')?.textContent.trim().replace(/ Bout$/,'') || 'Unknown';
    for (const f of [a,b]) sql.push(`INSERT INTO fighters (slug,name,current_weight_class,active,roster_status,status_source) VALUES (${q(f.slug)},${q(f.name)},${q(division)},1,'active','Official upcoming UFC card') ON CONFLICT(slug) DO NOTHING;`);
    const sourceKey = `ufc:${card.dataset.fmid}:${[a.slug,b.slug].sort().join(':')}`;
    const boutId = `(SELECT id FROM bouts WHERE source_key=${q(sourceKey)})`;
    const ratingA=ratingFor(a),ratingB=ratingFor(b);
    const probabilities = forecast(ratingA,ratingB,{a:a.name,b:b.name});
    const snapshot = predictionSnapshot({a,b,ratingA,ratingB,probabilities,snapshotKey:dataset.snapshotKey,sourceMaxDate:dataset.sourceMaxDate,lockedAt:now});
    sql.push(`INSERT INTO bouts (event_id,bout_order,fighter_a_id,fighter_b_id,weight_class,scheduled_rounds,status,source_key) VALUES (${eventId},${index},${fighterId(a.slug)},${fighterId(b.slug)},${q(division)},${index===0||/Title/.test(division)?5:3},'scheduled',${q(sourceKey)}) ON CONFLICT(source_key) WHERE source_key IS NOT NULL DO NOTHING;`);
    sql.push(`INSERT INTO predictions (bout_id,model_version_id,created_at,locked_at,fighter_a_probability,fighter_b_probability,confidence,sample_strength,picked_fighter_id,input_snapshot_key,top_factors_json,notes,input_snapshot_json) VALUES (${boutId},${modelId},${q(now)},${q(now)},${probabilities.probabilityA},${probabilities.probabilityB},NULL,${probabilities.sampleStrength},${probabilities.pick ? fighterId(probabilities.pick==='a'?a.slug:b.slug) : 'NULL'},${q(dataset.snapshotKey)},${q(JSON.stringify(probabilities.drivers || []))},${q(probabilities.notes)},${q(JSON.stringify(snapshot))}) ON CONFLICT(bout_id,model_version_id,context_adjusted) DO NOTHING;`);
    bouts.push({sourceKey,a:a.name,b:b.name,...probabilities});
  }
  if (!bouts.length) throw new Error(`No confirmed matchups for ${title}`);
  sql.push(`UPDATE bouts SET status='cancelled' WHERE event_id=${eventId} AND status='scheduled' AND source_key IS NOT NULL AND source_key NOT IN (${bouts.map(b=>q(b.sourceKey)).join(',')});`);
  const fullTitle = `${title}: ${bouts[0].a} vs ${bouts[0].b}`;
  sql.push(`UPDATE events SET name=${q(fullTitle)} WHERE id=${eventId};`);
  cards.push({name:fullTitle,date:startsAt.slice(0,10),starts_at:startsAt,bouts});
  dom.window.close();
}
// Grade only actual imported results. Historical bouts without a saved prediction
// do not enter the counter. Participant checks prevent replacement fights grading
// an earlier, cancelled matchup with the same official bout identifier.
const recent = JSON.parse(readFileSync('scripts/data/recent-bouts.json','utf8'));
for (const event of recent.events) {
 for (const row of event.rows) {
  const a=bySlug.get(fighterIdentity(row,'red').slug), b=bySlug.get(fighterIdentity(row,'blue').slug);
  if (!a||!b) continue;
  const winner=row.fight_outcome==='red_win'?a:row.fight_outcome==='blue_win'?b:null;
  sql.push(`UPDATE bouts SET status='completed',winner_id=${winner?fighterId(winner.slug):'NULL'},result_method=${q(row.method)},result_round=${Number(row.round)},result_detail=${q(row.fight_outcome)} WHERE source_key LIKE ${q(`ufc:${row.official_bout_id}:%`)} AND ((fighter_a_id=${fighterId(a.slug)} AND fighter_b_id=${fighterId(b.slug)}) OR (fighter_a_id=${fighterId(b.slug)} AND fighter_b_id=${fighterId(a.slug)}));`);
}
 // Each imported card is verified complete; remaining scheduled matchups were cancelled.
 sql.push(`UPDATE bouts SET status='cancelled' WHERE status='scheduled' AND event_id=(SELECT id FROM events WHERE source_url=${q(event.official_url)});`);
}
sql.push("UPDATE events SET status='completed' WHERE EXISTS (SELECT 1 FROM bouts b WHERE b.event_id=events.id AND b.status='completed') AND NOT EXISTS (SELECT 1 FROM bouts b WHERE b.event_id=events.id AND b.status='scheduled');");
mkdirSync('.cache/forecasts',{recursive:true});
writeFileSync('.cache/forecasts/forecasts.sql',sql.join('\n'));
writeFileSync('.cache/forecasts/summary.json',JSON.stringify(cards,null,2));
if (!dry) {
  const output=wrangler(['d1','execute','cagemetrix',location,'--file','.cache/forecasts/forecasts.sql'],true);
  writeFileSync('.cache/forecasts/wrangler-output.log',output);
}
console.log(`Saved ${cards.length} upcoming cards with ${cards.reduce((n,c)=>n+c.bouts.length,0)} Predictor 0.2 forecasts; existing predictions remain locked.`);
