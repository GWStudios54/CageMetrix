import {BRAND_NAME,SITE_ORIGIN} from './brand.ts';

type Env={DB:D1Database;ASSETS:Fetcher;MODEL_VERSION:string};
type Row=Record<string,any>;
const SITE=SITE_ORIGIN;
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]!));
const jsonLd=(v:unknown)=>JSON.stringify(v).replace(/</g,'\\u003c');
const dateOnly=(v:unknown)=>/^\d{4}-\d{2}-\d{2}/.test(String(v||''))?String(v).slice(0,10):null;
const prettyDate=(v:unknown)=>{const d=dateOnly(v);return d?new Intl.DateTimeFormat('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(`${d}T12:00:00Z`)):'Date TBA';};
function schemaStatus(status:unknown){return status==='completed'?'https://schema.org/EventCompleted':status==='cancelled'?'https://schema.org/EventCancelled':'https://schema.org/EventScheduled';}
function eventLocationText(event:Row){return [event.venue,event.city,event.region,event.country].filter(Boolean).filter((value,index,all)=>all.indexOf(value)===index).join(' · ');}
function schemaLocation(event:Row){const address=[event.city,event.region,event.country].filter(Boolean).join(', ');if(!event.venue&&!address)return undefined;return {'@type':'Place',...(event.venue?{name:event.venue}:{}),...(address?{address:{'@type':'PostalAddress',addressLocality:event.city||undefined,addressRegion:event.region||undefined,addressCountry:event.country||undefined}}:{})};}
function fallbackScoutUrl(name:unknown){return `/scout?q=${encodeURIComponent(`Scout ${String(name||'').trim()}`)}`;}
function fighterHref(row:Row,side:'a'|'b'){
  const globalSlug=row[`fighter_${side}_profile_slug`];if(globalSlug)return `/scout/fighters/${encodeURIComponent(String(globalSlug))}`;
  const coreSlug=row[`fighter_${side}_slug`];if(coreSlug)return `/fighters/${encodeURIComponent(String(coreSlug))}`;
  return fallbackScoutUrl(row[`fighter_${side}_name`]);
}
function schemaPerson(row:Row,side:'a'|'b'){const name=String(row[`fighter_${side}_name`]||'');const href=fighterHref(row,side);return {'@type':'Person',name,url:href.startsWith('/')?`${SITE}${href}`:href};}
function boutAnchor(row:Row){return row.card_source==='scout'?`bout-scout-${Number(row.id)}`:`bout-${Number(row.id)}`;}
function boutResult(row:Row){
  if(row.status==='cancelled')return 'Cancelled';
  if(row.status!=='completed')return 'Scheduled';
  if(!row.winner_id)return row.result_method||'Completed';
  const winner=Number(row.winner_id)===Number(row.fighter_a_id)?row.fighter_a_name:row.fighter_b_name;
  const detail=[row.result_method,row.result_round?`R${Number(row.result_round)}`:'',Number.isFinite(Number(row.result_time_seconds))?`${Math.floor(Number(row.result_time_seconds)/60)}:${String(Number(row.result_time_seconds)%60).padStart(2,'0')}`:''].filter(Boolean).join(' · ');
  return `${winner} won${detail?` · ${detail}`:''}`;
}

async function eventBouts(env:Env,eventId:number){
  const core=await env.DB.prepare(`SELECT b.id,b.bout_order,b.weight_class,b.status,b.winner_id,b.result_method,b.result_round,b.result_time_seconds,
      a.id fighter_a_id,a.name fighter_a_name,a.slug fighter_a_slug,z.id fighter_b_id,z.name fighter_b_name,z.slug fighter_b_slug
    FROM bouts b JOIN fighters a ON a.id=b.fighter_a_id JOIN fighters z ON z.id=b.fighter_b_id
    WHERE b.event_id=? ORDER BY b.bout_order,b.id`).bind(eventId).all<Row>();
  if(core.results?.length)return core.results.map(row=>({...row,card_source:'core'}));
  try{
    const scouting=await env.DB.prepare(`SELECT sb.id,sb.bout_order,sb.weight_class,sb.status,NULL winner_id,NULL result_method,NULL result_round,NULL result_time_seconds,
        NULL fighter_a_id,sb.fighter_a_name,NULL fighter_a_slug,NULL fighter_b_id,sb.fighter_b_name,NULL fighter_b_slug,
        (SELECT CASE WHEN COUNT(DISTINCT p.profile_slug)=1 THEN MIN(p.profile_slug) END FROM scout_public_global_profiles p WHERE lower(p.fighter_name)=lower(sb.fighter_a_name)) fighter_a_profile_slug,
        (SELECT CASE WHEN COUNT(DISTINCT p.profile_slug)=1 THEN MIN(p.profile_slug) END FROM scout_public_global_profiles p WHERE lower(p.fighter_name)=lower(sb.fighter_b_name)) fighter_b_profile_slug
      FROM scout_event_bouts sb
      WHERE sb.event_id=? AND sb.discipline='MMA' AND sb.status<>'cancelled'
      ORDER BY sb.bout_order,sb.id`).bind(eventId).all<Row>();
    return (scouting.results||[]).map(row=>({...row,card_source:'scout'}));
  }catch{return [];}
}

export async function eventPage(_request:Request,env:Env,slug:string){
  if(!/^[a-z0-9-]{1,180}$/.test(slug))return new Response('Not found',{status:404});
  const event=await env.DB.prepare(`SELECT e.id,e.promotion,e.promotion_slug,e.slug,e.name,e.event_date,e.starts_at,e.venue,e.city,e.region,e.country,e.status,e.source_url,sp.official_url promotion_url
    FROM events e LEFT JOIN scout_promotions sp ON sp.slug=e.promotion_slug WHERE e.slug=? LIMIT 1`).bind(slug).first<Row>();
  if(!event)return new Response(`<!doctype html><html lang="en"><head><meta name="robots" content="noindex"><title>Event not found — ${BRAND_NAME}</title></head><body><h1>Event not found</h1></body></html>`,{status:404,headers:{'content-type':'text/html; charset=utf-8'}});

  const bouts=await eventBouts(env,Number(event.id));
  const promotion=String(event.promotion||'MMA').trim()||'MMA';
  const locationText=eventLocationText(event);
  const canonical=`${SITE}/events/${encodeURIComponent(slug)}`;
  const hasCard=bouts.length>0;
  const title=hasCard?`${event.name} Fight Card, Fighters & Scout Reports | ${BRAND_NAME}`:`${event.name}: Date, Venue & Promotion Scout | ${BRAND_NAME}`;
  const description=(hasCard
    ?`Scout the ${event.name} fight card${event.event_date?` on ${prettyDate(event.event_date)}`:''}${locationText?` at ${locationText}`:''}. Research the fighters, records and scouting context on ${BRAND_NAME}.`
    :`Scout ${event.name}${event.event_date?` on ${prettyDate(event.event_date)}`:''}${locationText?` at ${locationText}`:''}. Track the official event and promotion while verified MMA matchups are resolved on ${BRAND_NAME}.`).slice(0,190);
  const location=schemaLocation(event);
  const organizer={'@type':'Organization',name:promotion,...(event.promotion_url?{url:event.promotion_url}:String(promotion).toUpperCase()==='UFC'?{url:'https://www.ufc.com/'}:{})};
  const main=bouts[0];
  const mainPeople=main?[schemaPerson(main,'a'),schemaPerson(main,'b')]:undefined;
  const schema=location?{
    '@context':'https://schema.org','@type':'SportsEvent',name:String(event.name),url:canonical,startDate:event.starts_at||event.event_date,
    eventStatus:schemaStatus(event.status),sport:'Mixed Martial Arts',description,organizer,location,
    ...(event.source_url?{sameAs:event.source_url}:{}),...(mainPeople?{performer:mainPeople,competitor:mainPeople}:{}),
    ...(bouts.length?{subEvent:bouts.map((b:Row)=>{const people=[schemaPerson(b,'a'),schemaPerson(b,'b')];return {'@type':'SportsEvent',name:`${b.fighter_a_name} vs ${b.fighter_b_name}`,url:`${canonical}#${boutAnchor(b)}`,startDate:event.starts_at||event.event_date,eventStatus:schemaStatus(b.status),sport:'Mixed Martial Arts',description:`${b.fighter_a_name} vs ${b.fighter_b_name} at ${event.name}. Fighter and scouting context from ${BRAND_NAME}.`,organizer,location,performer:people,competitor:people};})}: {})
  }:null;
  const crumbs={'@context':'https://schema.org','@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:BRAND_NAME,item:`${SITE}/`},{'@type':'ListItem',position:2,name:'MMA Events',item:`${SITE}/events`},{'@type':'ListItem',position:3,name:String(event.name),item:canonical}]};

  const cards=bouts.map((b:Row,index)=>`<article class="scout-bout" id="${boutAnchor(b)}"><div class="scout-bout-meta"><span>${esc(b.weight_class||'MMA bout')}</span><span>${index===0?'Featured bout':`Bout ${index+1}`}</span></div><div class="scout-bout-matchup"><a href="${esc(fighterHref(b,'a'))}"><strong>${esc(b.fighter_a_name)}</strong><small>Scout fighter →</small></a><span>VS</span><a href="${esc(fighterHref(b,'b'))}"><strong>${esc(b.fighter_b_name)}</strong><small>Scout fighter →</small></a></div><div class="scout-bout-footer"><span>${esc(boutResult(b))}</span><a href="/scout?q=${encodeURIComponent(`Compare ${String(b.fighter_a_name)} and ${String(b.fighter_b_name)} as MMA prospects and fighters`)}">Compare in Scout AI →</a></div></article>`).join('');
  const promoHref=event.promotion_slug?`/promotions/${encodeURIComponent(String(event.promotion_slug))}`:'/promotions';
  const mainNames=main?`${main.fighter_a_name} vs ${main.fighter_b_name}`:'';
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta name="description" content="${esc(description)}"><meta name="robots" content="index,follow,max-image-preview:large"><link rel="canonical" href="${canonical}"><link rel="icon" href="/logo.svg" type="image/svg+xml"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/scout-directory.css"><meta property="og:type" content="article"><meta property="og:site_name" content="${esc(BRAND_NAME)}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${canonical}"><meta property="og:image" content="${SITE}/og.png"><meta name="twitter:card" content="summary_large_image"><script type="application/ld+json">${jsonLd(crumbs)}</script>${schema?`<script type="application/ld+json">${jsonLd(schema)}</script>`:''}<style>
.scout-event{max-width:1120px;margin:0 auto;padding:48px 24px 72px}.scout-event-hero{max-width:900px}.scout-event-hero h1{font-size:clamp(2.4rem,7vw,5rem);line-height:.98;margin:.15em 0}.scout-event-hero .lede{max-width:780px;color:var(--muted);font-size:1.05rem}.scout-event-actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:24px}.scout-event-meta{display:flex;gap:10px 24px;flex-wrap:wrap;margin-top:28px;padding:16px 0;border-top:1px solid var(--border);border-bottom:1px solid var(--border);font-size:.84rem;color:var(--muted)}.scout-event-meta b{color:var(--text)}.scout-card{margin-top:42px}.scout-card-head{display:flex;justify-content:space-between;gap:20px;align-items:end;margin-bottom:16px}.scout-card-head h2{margin:.2em 0}.scout-card-head p{max-width:560px;color:var(--muted);margin:0}.scout-bout{border:1px solid var(--border);border-radius:16px;background:var(--panel);padding:18px;margin:12px 0}.scout-bout-meta,.scout-bout-footer{display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;color:var(--muted);font-size:.76rem;text-transform:uppercase;letter-spacing:.06em}.scout-bout-matchup{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:18px;align-items:center;padding:22px 0}.scout-bout-matchup>a{display:grid;gap:6px;text-decoration:none;color:inherit}.scout-bout-matchup>a:last-child{text-align:right}.scout-bout-matchup strong{font-size:1.2rem}.scout-bout-matchup small{color:var(--muted)}.scout-bout-matchup>span{font-weight:900;color:var(--muted)}.scout-bout-footer{text-transform:none;letter-spacing:0}.scout-bout-footer a{font-weight:800}.scout-event-empty{padding:28px;border:1px dashed var(--border);border-radius:14px;color:var(--muted)}@media(max-width:600px){.scout-event{padding:32px 16px 56px}.scout-card-head{display:block}.scout-bout-matchup{gap:8px}.scout-bout-matchup strong{font-size:.95rem}.scout-bout{padding:15px}.scout-bout-footer{display:grid}}
</style></head><body><header class="topbar"><a class="brand" href="/" aria-label="${esc(BRAND_NAME)} home"><img class="brand-mark" src="/logo.svg" alt="" width="44" height="44"><span>${esc(BRAND_NAME)}</span></a></header><main class="scout-event"><section class="scout-event-hero"><span class="eyebrow">${esc(promotion.toUpperCase())} · EVENT SCOUT</span><h1>${esc(event.name)}</h1><p class="lede">${mainNames?`Card research headlined by ${esc(mainNames)}. `:''}Use the event as a launch point into fighter résumés, promotion context and Scout AI research—not as a prediction screen.</p><div class="scout-event-actions"><a class="button primary" href="${esc(promoHref)}">Scout ${esc(promotion)} →</a><a class="button secondary" href="/scout?q=${encodeURIComponent(`Scout the fighters and prospects on ${String(event.name)}`)}">Ask Scout AI</a>${event.source_url?`<a class="button secondary" href="${esc(event.source_url)}" rel="nofollow noopener">Official event page ↗</a>`:''}</div><div class="scout-event-meta"><span><b>Date</b> ${esc(prettyDate(event.event_date))}</span>${locationText?`<span><b>Location</b> ${esc(locationText)}</span>`:''}<span><b>Status</b> ${esc(event.status||'scheduled')}</span></div></section><section class="scout-card"><div class="scout-card-head"><div><span class="eyebrow">FIGHT CARD</span><h2>Fighters on this event</h2></div><p>${bouts.length?`${bouts.length} verified MMA matchup${bouts.length===1?'':'s'} connected to MMA Scouts research.`:'The official event is indexed. Matchups appear only after MMA Scouts can verify them from the promotion source.'}</p></div>${cards||'<div class="scout-event-empty">Fight-card data is still being resolved from the official promotion source. The event and promotion remain available for scouting research.</div>'}</section></main><footer><span>${esc(BRAND_NAME)}</span><span>The MMA scouting engine.</span></footer></body></html>`;
  return new Response(html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'public, max-age=60, s-maxage=300','x-content-type-options':'nosniff','Link':`<${canonical}>; rel="canonical"`}});
}
