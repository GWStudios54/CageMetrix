import {BRAND_NAME,SITE_ORIGIN} from './brand.ts';

type Env={DB:D1Database;ASSETS:Fetcher;MODEL_VERSION:string};
type Row=Record<string,any>;
const SITE=SITE_ORIGIN;
const PREDICTOR_NAME='CageMetrix Win Probability';
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const jsonLd=(v:unknown)=>JSON.stringify(v).replace(/</g,'\\u003c');
const pct=(v:unknown)=>`${(Number(v||0)*100).toFixed(1)}%`;
const dateOnly=(v:unknown)=>/^\d{4}-\d{2}-\d{2}/.test(String(v||''))?String(v).slice(0,10):null;
const prettyDate=(v:unknown)=>{const d=dateOnly(v);return d?new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(`${d}T12:00:00Z`)):'';};
const eventSeoName=(event:Row)=>event.slug==='ufc-fight-night-september-05-2026'?'UFC Paris':String(event.name||'UFC event').replace(/\s*:\s*[^:]+\s+vs\s+[^:]+$/i,'').trim()||'UFC event';
const initials=(name:unknown)=>String(name||'?').trim().split(/\s+/).map(v=>v[0]).slice(0,2).join('').toUpperCase();
const publicModelRank=(version:unknown)=>version==='0.2.1'?0:version==='0.2.0'?1:version==='0.1.0'?2:3;
function schemaStatus(status:unknown){return status==='completed'?'https://schema.org/EventCompleted':status==='cancelled'?'https://schema.org/EventCancelled':'https://schema.org/EventScheduled';}
function schemaLocation(event:Row){const address=[event.city,event.region,event.country].filter(Boolean).join(', ');if(!event.venue&&!address)return undefined;return {'@type':'Place',...(event.venue?{name:event.venue}:{}),...(address?{address:{'@type':'PostalAddress',addressLocality:event.city||undefined,addressRegion:event.region||undefined,addressCountry:event.country||undefined}}:{})};}
function schemaPerson(name:unknown,slug:unknown){return {'@type':'Person',name:String(name||''),url:`${SITE}/fighters/${encodeURIComponent(String(slug||''))}`};}
function portrait(name:unknown,slug:unknown){return `<span class="portrait event-portrait" data-event-portrait data-name="${esc(name)}" data-slug="${esc(slug)}" aria-hidden="true"><span class="portrait-initials">${esc(initials(name))}</span></span>`;}
function fighter(b:Row,side:'a'|'b',has:boolean,pick:boolean){const name=b[`fighter_${side}_name`],slug=b[`fighter_${side}_slug`],prob=b[`fighter_${side}_probability`];return `<a class="forecast-fighter" href="/fighters/${encodeURIComponent(String(slug||''))}">${portrait(name,slug)}<span><strong>${esc(name)}</strong>${has?`<b>${pct(prob)}</b>`:''}${pick?'<small class="event-pick">MODEL PICK</small>':''}</span></a>`;}

export function dedupeEventBouts(input:Row[]){
  const byMatchup=new Map<string,Row>();
  for(const row of input){
    const ids=[Number(row.fighter_a_id),Number(row.fighter_b_id)].sort((a,b)=>a-b);
    const key=ids.every(Number.isFinite)?`${ids[0]}:${ids[1]}`:`bout:${row.id}`;
    const current=byMatchup.get(key);
    if(!current){byMatchup.set(key,row);continue;}
    const nextRank=publicModelRank(row.model_version),currentRank=publicModelRank(current.model_version);
    if(nextRank<currentRank||(nextRank===currentRank&&Number(row.id)>Number(current.id)))byMatchup.set(key,row);
  }
  return [...byMatchup.values()].sort((a,b)=>Number(a.bout_order??999)-Number(b.bout_order??999)||Number(a.id)-Number(b.id));
}

export async function eventPage(_request:Request,env:Env,slug:string){
  if(!/^[a-z0-9-]{1,180}$/.test(slug))return new Response('Not found',{status:404});
  const event=await env.DB.prepare(`SELECT id,promotion,slug,name,event_date,starts_at,venue,city,region,country,status,source_url FROM events WHERE slug=? LIMIT 1`).bind(slug).first<Row>();
  if(!event)return new Response(`<!doctype html><html lang="en"><head><meta name="robots" content="noindex"><title>Event not found — ${BRAND_NAME}</title></head><body><h1>Event not found</h1></body></html>`,{status:404,headers:{'content-type':'text/html; charset=utf-8'}});
  const rows=await env.DB.prepare(`WITH picks AS (
      SELECT p.*,mv.version model_version,ROW_NUMBER() OVER(PARTITION BY p.bout_id ORDER BY CASE mv.version WHEN '0.2.1' THEN 0 WHEN '0.2.0' THEN 1 WHEN '0.1.0' THEN 2 ELSE 3 END,p.id DESC) rn
      FROM predictions p JOIN model_versions mv ON mv.id=p.model_version_id WHERE mv.name=?
    ) SELECT b.id,b.bout_order,b.weight_class,b.status,b.winner_id,
      a.id fighter_a_id,a.name fighter_a_name,a.slug fighter_a_slug,z.id fighter_b_id,z.name fighter_b_name,z.slug fighter_b_slug,
      p.fighter_a_probability,p.fighter_b_probability,p.picked_fighter_id,p.model_version
      FROM bouts b JOIN fighters a ON a.id=b.fighter_a_id JOIN fighters z ON z.id=b.fighter_b_id
      LEFT JOIN picks p ON p.bout_id=b.id AND p.rn=1 WHERE b.event_id=? ORDER BY b.bout_order,b.id`).bind(PREDICTOR_NAME,event.id).all<Row>();
  const bouts=dedupeEventBouts(rows.results||[]),main=bouts[0],label=eventSeoName(event);
  const matchup=main?`${main.fighter_a_name} vs ${main.fighter_b_name}`:String(event.name||label);
  const canonical=`${SITE}/events/${encodeURIComponent(slug)}`;
  const title=`${label} Predictions: ${matchup} Picks & Win Probabilities | ${BRAND_NAME}`;
  const description=`${label} predictions for ${matchup} and the full ${prettyDate(event.event_date)} card. ${BRAND_NAME} model picks, win probabilities, Scout Ratings and matchup stats.`.slice(0,190);
  const location=schemaLocation(event);
  const organizer={'@type':'Organization',name:String(event.promotion||'UFC'),...(String(event.promotion||'UFC').toUpperCase()==='UFC'?{url:'https://www.ufc.com/'}:{})};
  const mainPeople=main?[schemaPerson(main.fighter_a_name,main.fighter_a_slug),schemaPerson(main.fighter_b_name,main.fighter_b_slug)]:undefined;
  const schema:any={
    '@context':'https://schema.org',
    '@type':'SportsEvent',
    name:`${label}: ${matchup}`,
    url:canonical,
    startDate:event.starts_at||event.event_date,
    eventStatus:schemaStatus(event.status),
    sport:'Mixed Martial Arts',
    description,
    organizer,
    ...(event.source_url?{sameAs:event.source_url}:{}),
    ...(location?{location}:{}),
    performer:mainPeople,
    competitor:mainPeople,
    subEvent:bouts.map((b:Row)=>{
      const people=[schemaPerson(b.fighter_a_name,b.fighter_a_slug),schemaPerson(b.fighter_b_name,b.fighter_b_slug)];
      return {
        '@type':'SportsEvent',
        name:`${b.fighter_a_name} vs ${b.fighter_b_name}`,
        url:`${SITE}/fights/${b.id}`,
        startDate:event.starts_at||event.event_date,
        eventStatus:schemaStatus(b.status),
        sport:'Mixed Martial Arts',
        description:`${b.fighter_a_name} vs ${b.fighter_b_name} at ${label}. ${BRAND_NAME} prediction, win probabilities and matchup statistics.`,
        organizer,
        ...(location?{location}:{}),
        performer:people,
        competitor:people
      };
    })
  };
  const crumbs={'@context':'https://schema.org','@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:BRAND_NAME,item:`${SITE}/`},{'@type':'ListItem',position:2,name:'UFC Predictions',item:`${SITE}/predictions.html`},{'@type':'ListItem',position:3,name:label,item:canonical}]};
  const cards=bouts.map((b:Row)=>{
    const has=Number.isFinite(Number(b.fighter_a_probability))&&Number.isFinite(Number(b.fighter_b_probability));
    const ap=has&&Number(b.picked_fighter_id)===Number(b.fighter_a_id),bp=has&&Number(b.picked_fighter_id)===Number(b.fighter_b_id);
    const width=has?Math.max(0,Math.min(100,Number(b.fighter_a_probability)*100)):50;
    return `<article class="forecast-bout event-fight" data-event-bout-id="${b.id}"><h2 class="sr-only">${esc(b.fighter_a_name)} vs ${esc(b.fighter_b_name)} prediction</h2><div class="event-bout-topline"><span class="eyebrow">${esc(b.weight_class||'UFC bout')}</span><a class="event-breakdown-link" href="/fights/${b.id}">Full breakdown →</a></div><div class="forecast-matchup">${fighter(b,'a',has,ap)}<span class="forecast-versus">VS</span>${fighter(b,'b',has,bp)}</div>${has?`<div class="probability-bar event-probability-bar" aria-label="${esc(b.fighter_a_name)} ${pct(b.fighter_a_probability)}, ${esc(b.fighter_b_name)} ${pct(b.fighter_b_probability)}"><span style="width:${width}%"></span></div>`:''}<div class="cm-inline-pick-slot" data-cm-inline-pick="${b.id}"><small class="muted">Loading your pick…</small></div><div class="event-fight-footer"><span class="muted">${has?`Predictor ${esc(b.model_version)} · locked probability`:'Prediction pending'}</span><a class="fight-detail-link" href="/fights/${b.id}">Prediction, stats & reasoning →</a></div></article>`;
  }).join('');
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta name="description" content="${esc(description)}"><meta name="robots" content="index,follow,max-image-preview:large"><link rel="canonical" href="${canonical}"><link rel="icon" href="/logo.svg" type="image/svg+xml"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/explorer.css"><link rel="stylesheet" href="/predictions.css"><meta property="og:type" content="article"><meta property="og:site_name" content="${BRAND_NAME}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${canonical}"><meta property="og:image" content="${SITE}/og.png"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(description)}"><meta name="twitter:image" content="${SITE}/og.png"><script type="application/ld+json">${jsonLd(schema)}</script><script type="application/ld+json">${jsonLd(crumbs)}</script><script src="/event-picks-inline.js" defer></script><style>
.event-seo{max-width:1120px;margin:0 auto;padding:44px 24px}.event-seo .lede{max-width:780px}.event-nav{display:flex;gap:12px;flex-wrap:wrap;margin-top:24px}.event-card-seo{margin-top:28px;background:var(--panel)}.event-card-seo .forecast-bout:first-child{border-top:0}.event-bout-topline,.event-fight-footer{display:flex;align-items:center;justify-content:space-between;gap:14px}.event-bout-topline{margin-bottom:14px}.event-breakdown-link{color:var(--muted);font-size:.78rem;text-decoration:underline;text-underline-offset:4px}.event-portrait{width:50px;height:58px}.event-pick{display:block;margin-top:4px;color:var(--accent);font-size:.62rem;font-weight:900;letter-spacing:.12em}.event-probability-bar{height:8px;background:#7da8d8}.event-probability-bar span{background:var(--accent)}.event-fight-footer{margin-top:12px;font-size:.78rem}.sr-only{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}
@media(max-width:600px){.event-seo{padding:28px 16px}.event-seo h1{font-size:clamp(2rem,10vw,3rem);line-height:1.02}.event-card-seo{border-radius:14px}.event-card-seo .forecast-bout{padding:18px 14px}.event-bout-topline{margin-bottom:12px}.event-breakdown-link{font-size:.72rem}.forecast-matchup{grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:8px}.forecast-fighter{align-items:center}.forecast-fighter strong{font-size:.9rem;line-height:1.15}.forecast-fighter b{font-size:1.35rem;line-height:1.1}.event-portrait{display:grid!important;width:42px!important;height:48px!important}.event-fight-footer{align-items:flex-start;flex-direction:column;gap:8px}.event-fight-footer .fight-detail-link{font-size:.8rem}}
</style></head><body><header class="topbar"><a class="brand" href="/" aria-label="${BRAND_NAME} home"><span>${BRAND_NAME}</span></a><nav><a href="/predictions.html">Predictions</a><a href="/#rankings">Rankings</a><a href="/validation.html">Track record</a></nav></header><main class="event-seo"><p class="eyebrow">${esc(String(event.promotion||'UFC').toUpperCase())} · ${esc(prettyDate(event.event_date))}</p><h1>${esc(label)} Predictions: ${esc(matchup)}</h1><p class="lede">${BRAND_NAME} model picks and win probabilities for ${esc(label)}, headlined by ${esc(matchup)}. Every prediction is locked before the event and remains on the public record.</p><div class="event-nav"><a class="button primary" href="/predictions.html">All UFC predictions</a>${event.source_url?`<a class="button secondary" href="${esc(event.source_url)}" rel="nofollow noopener">Official UFC event page</a>`:''}</div><p class="model-note">Win probabilities are model estimates, not betting odds. Technical statistics remain UFC-specific; verified pre-UFC résumé context may inform low-sample fighters.</p><section><div class="section-heading"><div><p class="eyebrow">FULL CARD</p><h2>${esc(label)} fight predictions</h2></div><p>${bouts.length} matchups with preserved model probabilities and fight-specific breakdowns.</p></div><div class="event-card event-card-seo">${cards||'<p class="ranking-loading">Fight predictions are being prepared.</p>'}</div></section></main><footer><span>${BRAND_NAME}</span><span>The MMA research engine.</span></footer><script src="/fighter-media.js"></script><script>fighterMedia.ready.then(()=>{document.querySelectorAll('[data-event-portrait]').forEach(el=>{const t=document.createElement('template');t.innerHTML=fighterMedia.portrait({name:el.dataset.name,slug:el.dataset.slug});const node=t.content.firstElementChild;if(node)el.replaceWith(node);});});</script></body></html>`;
  return new Response(html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'public, max-age=60, s-maxage=300','x-content-type-options':'nosniff','Link':`<${canonical}>; rel="canonical"`}});
}
