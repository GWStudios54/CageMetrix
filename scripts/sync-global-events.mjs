import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { GLOBAL_EVENT_SOURCES, eventDetailUrls, eventSlug, parsePromotionEvents } from './lib/global-event-sources.mjs';
import { usableUpcomingEvents } from './lib/global-event-calendar.mjs';
import { scopePromotionHtml } from './lib/global-event-html.mjs';
import { parseSpecialPromotion } from './lib/global-event-special.mjs';
import { parseExtendedPromotion } from './lib/global-event-special-extended.mjs';
import { parseGlobalEventBouts } from './lib/global-event-bouts.mjs';

const args=process.argv.slice(2);
const remote=args.includes('--remote'),local=args.includes('--local'),dry=args.includes('--dry-run');
if(Number(remote)+Number(local)+Number(dry)!==1)throw new Error('Choose exactly one of --remote, --local or --dry-run');
const target=remote?'--remote':'--local';
const now=new Date();
const cacheDir='.cache/global-events';
mkdirSync(cacheDir,{recursive:true});

const q=value=>value===null||value===undefined||value===''?'NULL':`'${String(value).replaceAll("'","''")}'`;
const clean=value=>String(value??'').replace(/\s+/g,' ').trim();
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const pageCache=new Map();

function wrangler(params,capture=false){
  return execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js',...params],{
    encoding:'utf8',stdio:capture?['ignore','pipe','pipe']:'inherit',maxBuffer:20*1024*1024,env:process.env
  })||'';
}

async function html(url,attempts=3){
  if(pageCache.has(url))return pageCache.get(url);
  let lastError;
  for(let attempt=1;attempt<=attempts;attempt++){
    try{
      const response=await fetch(url,{
        redirect:'follow',
        signal:AbortSignal.timeout(45000),
        headers:{
          'accept':'text/html,application/xhtml+xml',
          'accept-language':'en-US,en;q=0.8',
          'user-agent':'Mozilla/5.0 (compatible; MMA Scouts event research; +https://mmascouts.com/)'
        }
      });
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const body=await response.text();pageCache.set(url,body);return body;
    }catch(error){
      lastError=error;
      if(attempt<attempts)await wait(500*attempt);
    }
  }
  throw lastError instanceof Error?lastError:new Error(String(lastError||'fetch failed'));
}

async function primaryHtml(source){
  const urls=[source.url];
  if(source.slug==='grachan')urls.push('https://grachan.jp/schedule/');
  let lastError;
  for(const url of urls){
    try{return {body:await html(url),fetchedUrl:url};}
    catch(error){lastError=error;}
  }
  throw lastError instanceof Error?lastError:new Error(String(lastError||'fetch failed'));
}

function normalizedHost(url){try{return new URL(url).hostname.replace(/^www\./,'').toLowerCase();}catch{return '';}}
function normalizedPage(url){try{const parsed=new URL(url);parsed.hash='';return parsed.href.replace(/\/$/,'');}catch{return '';}}
function cardDetailUrl(event){
  const source=GLOBAL_EVENT_SOURCES.find(item=>item.slug===event.promotionSlug);
  if(!source||!event.sourceUrl)return null;
  if(normalizedHost(event.sourceUrl)!==normalizedHost(source.url))return null;
  if(normalizedPage(event.sourceUrl)===normalizedPage(source.url))return null;
  return event.sourceUrl;
}

const parsed=[],sources=[];
for(const source of GLOBAL_EVENT_SOURCES){
  try{
    const primaryResult=await primaryHtml(source);
    const primary=primaryResult.body;
    writeFileSync(`${cacheDir}/${source.slug}.html`,primary);
    let discovered=[];
    const detailFailures=[];
    const special=parseSpecialPromotion(source,primary,now);
    const extended=special===null?parseExtendedPromotion(source,primary,now):null;
    if(special!==null){
      discovered.push(...special);
    }else if(extended!==null){
      discovered.push(...extended);
    }else{
      // Detail-driven calendars such as DEEP and Pancrase keep dates/venues on
      // the event page. Do not infer those cards from nearby news timestamps.
      if(!source.detailUrlPattern){
        const scoped=scopePromotionHtml(source,primary);
        discovered.push(...parsePromotionEvents(source,scoped,now));
      }
      const details=eventDetailUrls(source,primary);
      for(const [index,url] of details.entries()){
        try{
          const detail=await html(url);
          writeFileSync(`${cacheDir}/${source.slug}-detail-${index+1}.html`,detail);
          const detailSource={...source,url,detailUrlPattern:null};
          const detailExtended=parseExtendedPromotion(detailSource,detail,now);
          if(detailExtended!==null)discovered.push(...detailExtended);
          else discovered.push(...parsePromotionEvents(detailSource,detail,now));
        }catch(error){detailFailures.push({url,error:error instanceof Error?error.message:String(error)});}
      }
    }
    const events=usableUpcomingEvents(discovered,now);
    parsed.push(...events);
    sources.push({
      slug:source.slug,url:source.url,fetched_url:primaryResult.fetchedUrl,status:'ok',discovered:discovered.length,events:events.length,
      names:events.map(e=>e.name),detail_failures:detailFailures.length?detailFailures:undefined,
      note:events.length?undefined:'No upcoming event with a verified physical location is currently published.'
    });
    console.log(`${source.name}: ${events.length} upcoming event(s) from ${discovered.length} parsed candidate(s)`);
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    sources.push({slug:source.slug,url:source.url,status:'error',discovered:0,events:0,error:message});
    console.warn(`${source.name}: ${message}`);
  }
}

const bySlug=new Map();
for(const event of parsed){
  const slug=eventSlug(event);
  const current=bySlug.get(slug);
  const richness=value=>[value.venue,value.city,value.region,value.country,value.startsAt&&value.startsAt!==value.eventDate,value.sourceUrl].filter(Boolean).length;
  if(!current||richness(event)>richness(current))bySlug.set(slug,{...event,slug});
}
const events=[...bySlug.values()].sort((a,b)=>a.eventDate.localeCompare(b.eventDate)||a.name.localeCompare(b.name));

// Fight cards are intentionally stricter than calendar discovery. Only an
// event-specific page on the promotion's official host may populate the
// scouting-only card table. A parser miss never deletes a previously verified
// card; reconciliation occurs only after at least one high-confidence MMA pair.
const cardEvents=[];
for(const [index,event] of events.entries()){
  const detailUrl=cardDetailUrl(event);if(!detailUrl)continue;
  try{
    const body=await html(detailUrl);
    const bouts=parseGlobalEventBouts(body,{sourceSlug:event.promotionSlug,sourceUrl:detailUrl});
    if(!bouts.length)continue;
    writeFileSync(`${cacheDir}/${event.promotionSlug}-card-${index+1}.html`,body);
    cardEvents.push({event,bouts});
    console.log(`${event.name}: ${bouts.length} verified MMA matchup(s)`);
  }catch(error){
    console.warn(`${event.name} fight card: ${error instanceof Error?error.message:String(error)}`);
  }
}

const okSources=sources.filter(source=>source.status==='ok').length;
const cardBoutCount=cardEvents.reduce((sum,item)=>sum+item.bouts.length,0);
const summary={checked_at:now.toISOString(),sources_ok:okSources,sources_failed:sources.length-okSources,sources_quiet:sources.filter(source=>source.status==='ok'&&!source.events).length,events:events.length,card_events:cardEvents.length,card_bouts:cardBoutCount,sources,event_rows:events,card_rows:cardEvents.map(item=>({event_slug:item.event.slug,event_name:item.event.name,bouts:item.bouts}))};
writeFileSync(`${cacheDir}/summary.json`,JSON.stringify(summary,null,2)+'\n');
if(!okSources)throw new Error('Every official event source failed; refusing to write an empty calendar');

const sql=[];
// Reconcile only promotions for which this run produced at least one verified
// current card. This removes stale no-bout shell rows (including old archive
// mis-parses) without deleting curated cards that already have bout records.
for(const source of sources.filter(item=>item.status==='ok'&&item.events>0)){
  const keep=events.filter(event=>event.promotionSlug===source.slug).map(event=>q(event.slug));
  if(!keep.length)continue;
  sql.push(`DELETE FROM events
WHERE promotion_slug=${q(source.slug)}
  AND status='scheduled'
  AND event_date>=date('now','-3 day')
  AND slug NOT IN (${keep.join(',')})
  AND NOT EXISTS (SELECT 1 FROM bouts WHERE bouts.event_id=events.id);`);
}
for(const event of events){
  const startsAt=clean(event.startsAt)||event.eventDate;
  sql.push(`INSERT INTO events (promotion,promotion_slug,slug,name,event_date,venue,city,region,country,status,source_url,starts_at)
VALUES (${q(event.promotionName)},${q(event.promotionSlug)},${q(event.slug)},${q(event.name)},${q(event.eventDate)},${q(event.venue)},${q(event.city)},${q(event.region)},${q(event.country)},'scheduled',${q(event.sourceUrl)},${q(startsAt)})
ON CONFLICT(slug) DO UPDATE SET promotion=excluded.promotion,promotion_slug=excluded.promotion_slug,name=excluded.name,event_date=excluded.event_date,venue=COALESCE(excluded.venue,events.venue),city=COALESCE(excluded.city,events.city),region=COALESCE(excluded.region,events.region),country=COALESCE(excluded.country,events.country),source_url=excluded.source_url,starts_at=excluded.starts_at,updated_at=CURRENT_TIMESTAMP;`);
}
for(const {event,bouts} of cardEvents){
  sql.push(`DELETE FROM scout_event_bouts WHERE event_id=(SELECT id FROM events WHERE slug=${q(event.slug)} LIMIT 1);`);
  for(const bout of bouts){
    sql.push(`INSERT INTO scout_event_bouts (event_id,bout_key,bout_order,fighter_a_name,fighter_b_name,weight_class,discipline,title_fight,status,source_url,verified_at,updated_at)
VALUES ((SELECT id FROM events WHERE slug=${q(event.slug)} LIMIT 1),${q(bout.boutKey)},${Number(bout.boutOrder)||'NULL'},${q(bout.fighterAName)},${q(bout.fighterBName)},${q(bout.weightClass)},'MMA',${bout.titleFight?1:0},'scheduled',${q(bout.sourceUrl)},CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT(event_id,bout_key) DO UPDATE SET bout_order=excluded.bout_order,fighter_a_name=excluded.fighter_a_name,fighter_b_name=excluded.fighter_b_name,weight_class=excluded.weight_class,discipline=excluded.discipline,title_fight=excluded.title_fight,status=excluded.status,source_url=excluded.source_url,verified_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP;`);
  }
}
sql.push(`INSERT INTO bootstrap_state(key,value,updated_at) VALUES ('global-events:last-sync',${q(JSON.stringify({checked_at:summary.checked_at,sources_ok:summary.sources_ok,sources_failed:summary.sources_failed,sources_quiet:summary.sources_quiet,events:summary.events,card_events:summary.card_events,card_bouts:summary.card_bouts}))},CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP;`);
writeFileSync(`${cacheDir}/sync.sql`,sql.join('\n')+'\n');

if(!dry){
  wrangler(['d1','execute','cagemetrix',target,'--file',`${cacheDir}/sync.sql`]);
  const verification=wrangler(['d1','execute','cagemetrix',target,'--command',"SELECT e.promotion_slug,COUNT(DISTINCT e.id) events,COUNT(sb.id) scouting_bouts,MIN(e.event_date) next_date,MAX(e.event_date) last_date FROM events e LEFT JOIN scout_event_bouts sb ON sb.event_id=e.id WHERE e.promotion_slug IS NOT NULL AND e.event_date>=date('now','-3 day') GROUP BY e.promotion_slug ORDER BY e.promotion_slug",'--json'],true);
  writeFileSync(`${cacheDir}/remote-verification.json`,verification);
}
console.log(`Global event calendar prepared ${events.length} event(s) and ${cardBoutCount} verified MMA matchup(s) from ${okSources}/${sources.length} reachable official promotion sources.`);
