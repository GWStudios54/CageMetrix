import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { GLOBAL_EVENT_SOURCES, eventDetailUrls, eventSlug, parseOneEvents, parsePromotionEvents } from './lib/global-event-sources.mjs';
import { usableUpcomingEvents } from './lib/global-event-calendar.mjs';

const args=process.argv.slice(2);
const remote=args.includes('--remote'),local=args.includes('--local'),dry=args.includes('--dry-run');
if(Number(remote)+Number(local)+Number(dry)!==1)throw new Error('Choose exactly one of --remote, --local or --dry-run');
const target=remote?'--remote':'--local';
const now=new Date();
const cacheDir='.cache/global-events';
mkdirSync(cacheDir,{recursive:true});

const q=value=>value===null||value===undefined||value===''?'NULL':`'${String(value).replaceAll("'","''")}'`;
const clean=value=>String(value??'').replace(/\s+/g,' ').trim();

function wrangler(params,capture=false){
  return execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js',...params],{
    encoding:'utf8',stdio:capture?['ignore','pipe','pipe']:'inherit',maxBuffer:20*1024*1024,env:process.env
  })||'';
}

async function html(url){
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
  return response.text();
}

const parsed=[],sources=[];
for(const source of GLOBAL_EVENT_SOURCES){
  try{
    const primary=await html(source.url);
    writeFileSync(`${cacheDir}/${source.slug}.html`,primary);
    let discovered=[];
    const detailFailures=[];
    if(source.slug==='one'){
      const live=await html(source.liveUrl);
      writeFileSync(`${cacheDir}/${source.slug}-live.html`,live);
      discovered=parseOneEvents(primary,live,now);
    }else{
      // Detail-driven calendars such as DEEP and Pancrase keep dates/venues on
      // the event page. Do not infer those cards from nearby news timestamps.
      if(!source.detailUrlPattern)discovered.push(...parsePromotionEvents(source,primary,now));
      const details=eventDetailUrls(source,primary);
      for(const [index,url] of details.entries()){
        try{
          const detail=await html(url);
          writeFileSync(`${cacheDir}/${source.slug}-detail-${index+1}.html`,detail);
          discovered.push(...parsePromotionEvents({...source,url,detailUrlPattern:null},detail,now));
        }catch(error){detailFailures.push({url,error:error instanceof Error?error.message:String(error)});}
      }
    }
    const events=usableUpcomingEvents(discovered,now);
    parsed.push(...events);
    sources.push({
      slug:source.slug,url:source.url,status:'ok',discovered:discovered.length,events:events.length,
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
const okSources=sources.filter(source=>source.status==='ok').length;
const summary={checked_at:now.toISOString(),sources_ok:okSources,sources_failed:sources.length-okSources,sources_quiet:sources.filter(source=>source.status==='ok'&&!source.events).length,events:events.length,sources,event_rows:events};
writeFileSync(`${cacheDir}/summary.json`,JSON.stringify(summary,null,2)+'\n');
if(!okSources)throw new Error('Every official event source failed; refusing to write an empty calendar');

const sql=[];
for(const event of events){
  const startsAt=clean(event.startsAt)||event.eventDate;
  sql.push(`INSERT INTO events (promotion,promotion_slug,slug,name,event_date,venue,city,region,country,status,source_url,starts_at)
VALUES (${q(event.promotionName)},${q(event.promotionSlug)},${q(event.slug)},${q(event.name)},${q(event.eventDate)},${q(event.venue)},${q(event.city)},${q(event.region)},${q(event.country)},'scheduled',${q(event.sourceUrl)},${q(startsAt)})
ON CONFLICT(slug) DO UPDATE SET promotion=excluded.promotion,promotion_slug=excluded.promotion_slug,name=excluded.name,event_date=excluded.event_date,venue=COALESCE(excluded.venue,events.venue),city=COALESCE(excluded.city,events.city),region=COALESCE(excluded.region,events.region),country=COALESCE(excluded.country,events.country),source_url=excluded.source_url,starts_at=excluded.starts_at,updated_at=CURRENT_TIMESTAMP;`);
}
sql.push(`INSERT INTO bootstrap_state(key,value,updated_at) VALUES ('global-events:last-sync',${q(JSON.stringify({checked_at:summary.checked_at,sources_ok:summary.sources_ok,sources_failed:summary.sources_failed,sources_quiet:summary.sources_quiet,events:summary.events}))},CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP;`);
writeFileSync(`${cacheDir}/sync.sql`,sql.join('\n')+'\n');

if(!dry){
  wrangler(['d1','execute','cagemetrix',target,'--file',`${cacheDir}/sync.sql`]);
  const verification=wrangler(['d1','execute','cagemetrix',target,'--command',"SELECT promotion_slug,COUNT(*) events,MIN(event_date) next_date,MAX(event_date) last_date FROM events WHERE promotion_slug IS NOT NULL AND event_date>=date('now','-3 day') GROUP BY promotion_slug ORDER BY promotion_slug",'--json'],true);
  writeFileSync(`${cacheDir}/remote-verification.json`,verification);
}
console.log(`Global event calendar prepared ${events.length} event(s) from ${okSources}/${sources.length} reachable official promotion sources.`);
