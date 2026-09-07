import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  ESPN_MMA_CORE,
  espnAthleteName,
  espnBoutNameKey,
  espnCompetitionId,
  espnCompetitorId,
  espnEventDate,
  espnEventId,
  parseEspnEventItems,
  parseEspnLeagueSlugs,
  parseEspnTechnicalStats,
  promotionSlugForOrganization,
  sameEspnName,
  withinDays
} from './lib/espn-mma.mjs';

const DB = 'cagemetrix';
const outputDir = '.cache/espn-mma-validation';
mkdirSync(outputDir, { recursive: true });
const priority = ['bellator','pfl','lfa','cage-warriors','one-championship','ksw','strikeforce','wec'];
const athleteCache = new Map();
const eventCache = new Map();
const statsCache = new Map();

function wrangler(params) {
  return execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...params], {
    encoding: 'utf8',
    stdio: ['ignore','pipe','pipe'],
    env: process.env,
    maxBuffer: 32 * 1024 * 1024
  });
}
function d1Rows(sql) {
  const raw = wrangler(['d1','execute',DB,'--remote','--command',sql,'--json']);
  const parsed = JSON.parse(raw);
  const parts = Array.isArray(parsed) ? parsed : [parsed];
  return parts.flatMap(part => part.results || []);
}
async function fetchJson(url) {
  let last;
  for (let attempt=0; attempt<4; attempt++) {
    try {
      const response = await fetch(url, { headers:{accept:'application/json','user-agent':'CageMetrix ESPN validation/1.0'}, signal:AbortSignal.timeout(20000) });
      if (response.ok) return response.json();
      if (response.status === 404) return null;
      last = new Error(`HTTP ${response.status}: ${url}`);
    } catch (error) { last = error; }
    await new Promise(resolve => setTimeout(resolve, 250 * 2 ** attempt));
  }
  throw last;
}
async function athleteName(id) {
  if (!athleteCache.has(id)) athleteCache.set(id, fetchJson(`${ESPN_MMA_CORE}/athletes/${encodeURIComponent(id)}`).then(espnAthleteName));
  return athleteCache.get(id);
}
async function eventDetail(item) {
  if (item?.competitions?.length && espnEventId(item)) return item;
  const ref = item?.$ref;
  const id = espnEventId(item);
  const key = ref || id;
  if (!key) return null;
  if (!eventCache.has(key)) eventCache.set(key, fetchJson(ref || `${ESPN_MMA_CORE}/events/${encodeURIComponent(id)}`));
  return eventCache.get(key);
}
async function eventItems(slug, year) {
  const out=[];
  for (let page=1; page<=10; page++) {
    const payload=await fetchJson(`${ESPN_MMA_CORE}/leagues/${encodeURIComponent(slug)}/events?dates=${year}&limit=100&page=${page}`);
    if (!payload) break;
    const batch=parseEspnEventItems(payload); out.push(...batch);
    if (batch.length<100 || (payload.pageCount && page>=Number(payload.pageCount))) break;
  }
  return out;
}
function payloadShape(payload) {
  const categories = payload?.splits?.categories || payload?.categories || [];
  return {
    top_level_keys: payload && typeof payload === 'object' ? Object.keys(payload).slice(0,30) : [],
    splits_keys: payload?.splits && typeof payload.splits === 'object' ? Object.keys(payload.splits).slice(0,20) : [],
    category_count: Array.isArray(categories) ? categories.length : null,
    categories: Array.isArray(categories) ? categories.slice(0,6).map(category => ({
      name: category?.name ?? category?.displayName ?? null,
      keys: category && typeof category === 'object' ? Object.keys(category).slice(0,15) : [],
      stat_count: Array.isArray(category?.stats) ? category.stats.length : null,
      stats: Array.isArray(category?.stats) ? category.stats.slice(0,20).map(stat => ({
        name: stat?.name ?? null,
        abbreviation: stat?.abbreviation ?? null,
        displayName: stat?.displayName ?? null,
        value: stat?.value ?? null,
        displayValue: stat?.displayValue ?? null,
        keys: stat && typeof stat === 'object' ? Object.keys(stat).slice(0,12) : []
      })) : []
    })) : []
  };
}
async function stats(slug,eventId,competitionId,athleteId) {
  const key=`${slug}|${eventId}|${competitionId}|${athleteId}`;
  if (!statsCache.has(key)) statsCache.set(key, (async()=>{
    const url=`${ESPN_MMA_CORE}/leagues/${encodeURIComponent(slug)}/events/${encodeURIComponent(eventId)}/competitions/${encodeURIComponent(competitionId)}/competitors/${encodeURIComponent(athleteId)}/statistics`;
    const payload=await fetchJson(url);
    return { url, parsed: parseEspnTechnicalStats(payload), shape: payloadShape(payload) };
  })());
  return statsCache.get(key);
}

const leaguePayload = await fetchJson(`${ESPN_MMA_CORE}/leagues?limit=100`);
const slugs = parseEspnLeagueSlugs(leaguePayload);
if (slugs.length < 20) throw new Error(`ESPN MMA league inventory unexpectedly small: ${slugs.length}`);
const available = new Set(slugs);

const targets = d1Rows(`
  SELECT fighter_id,source_fight_id,event_date,organization,event_name,weight_class,result,
         fighter_name,opponent_name,round_num,time_finish_seconds
  FROM ufc_warehouse_pre_ufc_rows
  WHERE event_date >= '2019-01-01'
  ORDER BY event_date DESC
  LIMIT 5000
`);
if (targets.length < 100) throw new Error(`Production pre-UFC target coverage unexpectedly small: ${targets.length}`);

const groups = new Map();
for (const row of targets) {
  const slug=promotionSlugForOrganization(row.organization, available);
  if (!slug) continue;
  const year=Number(String(row.event_date).slice(0,4));
  if (!Number.isInteger(year)) continue;
  const key=`${slug}|${year}`;
  if (!groups.has(key)) groups.set(key,{slug,year,rows:[]});
  if (groups.get(key).rows.length < 8) groups.get(key).rows.push(row);
}
const ordered=[...groups.values()]
  .sort((a,b)=>(priority.indexOf(a.slug)<0?999:priority.indexOf(a.slug))-(priority.indexOf(b.slug)<0?999:priority.indexOf(b.slug)) || b.year-a.year)
  .slice(0,12);
if (!ordered.length) throw new Error('No recent CageMetrix pre-UFC targets mapped to an ESPN MMA league.');

const report={
  generated_at:new Date().toISOString(),
  espn_leagues:slugs.length,
  production_targets_scanned:targets.length,
  promotion_year_groups:[],
  identity_matches:0,
  complete_stat_matches:0,
  leagues_with_complete_stats:new Set(),
  samples:[],
  diagnostics:[]
};

for (const group of ordered) {
  const items=await eventItems(group.slug,group.year);
  const details=[];
  for (const item of items) { const detail=await eventDetail(item); if(detail) details.push(detail); }
  let identity=0, complete=0;
  for (const target of group.rows) {
    const targetDate=String(target.event_date).slice(0,10);
    const key=espnBoutNameKey(target.fighter_name,target.opponent_name);
    let found=null;
    for (const event of details) {
      const eventDate=espnEventDate(event);
      if (!eventDate || !withinDays(eventDate,targetDate,1)) continue;
      for (const competition of event.competitions || []) {
        const cid=espnCompetitionId(competition);
        const comps=Array.isArray(competition?.competitors)?competition.competitors:[];
        if(!cid || comps.length!==2) continue;
        const ids=comps.map(espnCompetitorId);
        if(ids.some(id=>!id)) continue;
        const names=await Promise.all(ids.map(athleteName));
        if(names.some(name=>!name) || espnBoutNameKey(names[0],names[1])!==key) continue;
        found={event,eventDate,cid,ids,names}; break;
      }
      if(found) break;
    }
    if(!found) continue;
    identity += 1; report.identity_matches += 1;
    const fighterIndex=sameEspnName(target.fighter_name,found.names[0])?0:1;
    const lines=await Promise.all(found.ids.map(id=>stats(group.slug,espnEventId(found.event),found.cid,id)));
    if(lines.every(line=>line.parsed.complete)) {
      complete += 1; report.complete_stat_matches += 1; report.leagues_with_complete_stats.add(group.slug);
      if(report.samples.length<12) report.samples.push({
        league:group.slug,date:targetDate,fighter:target.fighter_name,opponent:target.opponent_name,
        espn_fighter:found.names[fighterIndex],
        stats:lines[fighterIndex].parsed,
        source_url:lines[fighterIndex].url
      });
    } else if (report.diagnostics.length < 6) {
      report.diagnostics.push({
        league:group.slug,
        date:targetDate,
        fighter:target.fighter_name,
        opponent:target.opponent_name,
        event_id:espnEventId(found.event),
        competition_id:found.cid,
        lines:lines.map((line,index)=>({athlete:found.names[index],url:line.url,parsed:line.parsed,shape:line.shape}))
      });
    }
  }
  report.promotion_year_groups.push({slug:group.slug,year:group.year,targets:group.rows.length,events:details.length,identity_matches:identity,complete_stat_matches:complete});
  console.log(`${group.slug} ${group.year}: ${complete}/${group.rows.length} targets with complete ESPN technical stats (${identity} identity matches).`);
}
report.leagues_with_complete_stats=[...report.leagues_with_complete_stats].sort();
report.complete_match_rate=report.complete_stat_matches/Math.max(1,ordered.reduce((sum,g)=>sum+g.rows.length,0));
writeFileSync(`${outputDir}/report.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(report.complete_stat_matches===0) throw new Error('ESPN produced zero complete technical matches for the CageMetrix sample.');
