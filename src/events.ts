import {BRAND_NAME,SITE_ORIGIN} from './brand.ts';

type Env={DB:D1Database;ASSETS:Fetcher;MODEL_VERSION:string};
type Row=Record<string,any>;
const JSON_HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'public, max-age=60, s-maxage=300'};
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const dateOnly=(v:unknown)=>/^\d{4}-\d{2}-\d{2}/.test(String(v||''))?String(v).slice(0,10):null;
const prettyDate=(v:unknown)=>{const d=dateOnly(v);return d?new Intl.DateTimeFormat('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(`${d}T12:00:00Z`)):'Date TBA';};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:JSON_HEADERS});
const limited=(raw:string|null,fallback:number,max:number)=>Math.min(max,Math.max(1,Number.parseInt(raw||'',10)||fallback));

function location(row:Row){return [row.venue,row.city,row.region,row.country].filter(Boolean).filter((value,index,all)=>all.indexOf(value)===index).join(' · ');}
function eventCard(row:Row){
  const promo=String(row.promotion||'MMA').trim();
  const href=`/events/${encodeURIComponent(String(row.slug))}`;
  return `<a class="event-directory-card" href="${href}"><div class="event-directory-meta"><span>${esc(promo)}</span><time datetime="${esc(row.event_date)}">${esc(prettyDate(row.event_date))}</time></div><h3>${esc(row.name)}</h3><p>${esc(location(row)||'Venue to be announced')}</p><span class="event-directory-arrow">Scout this event →</span></a>`;
}

async function eventRows(env:Env,mode:'upcoming'|'recent'='upcoming',promotion='',limit=100){
  const clauses=[mode==='upcoming'?"e.event_date>=date('now','-1 day')":"e.event_date<date('now')"];
  const binds:any[]=[];
  if(promotion){clauses.push('(e.promotion_slug=? OR lower(e.promotion)=lower(?))');binds.push(promotion,promotion);}
  binds.push(limit);
  const order=mode==='upcoming'?'e.event_date ASC':'e.event_date DESC';
  return env.DB.prepare(`SELECT e.id,e.slug,e.promotion,e.promotion_slug,e.name,e.event_date,e.starts_at,e.venue,e.city,e.region,e.country,e.status,e.source_url,
    (SELECT COUNT(*) FROM bouts b WHERE b.event_id=e.id AND b.status<>'cancelled') bout_count
    FROM events e
    WHERE e.slug IS NOT NULL AND ${clauses.join(' AND ')}
      AND (e.promotion_slug IS NOT NULL OR e.promotion='UFC' OR EXISTS(SELECT 1 FROM bouts b WHERE b.event_id=e.id))
    ORDER BY ${order},e.id ASC LIMIT ?`).bind(...binds).all<Row>();
}

export async function eventsApi(request:Request,env:Env){
  if(request.method!=='GET')return json({error:'method_not_allowed'},405);
  const url=new URL(request.url),mode=url.searchParams.get('mode')==='recent'?'recent':'upcoming',promotion=(url.searchParams.get('promotion')||'').trim().toLowerCase().slice(0,100),limit=limited(url.searchParams.get('limit'),100,250);
  const rows=(await eventRows(env,mode,promotion,limit)).results||[];
  return json({data:rows,meta:{mode,promotion:promotion||null,count:rows.length,limit}});
}

export async function eventsPage(_request:Request,env:Env){
  const [upcomingResult,recentResult]=await Promise.all([eventRows(env,'upcoming','',120),eventRows(env,'recent','',24)]);
  const upcoming=upcomingResult.results||[],recent=recentResult.results||[];
  const groups=new Map<string,Row[]>();
  for(const row of upcoming){const key=String(row.promotion||'Other MMA');if(!groups.has(key))groups.set(key,[]);groups.get(key)!.push(row);}
  const groupHtml=[...groups.entries()].map(([promotion,rows])=>`<section class="event-directory-section"><div class="event-directory-heading"><span class="eyebrow">${esc(promotion.toUpperCase())}</span><h2>${esc(promotion)} upcoming events</h2><a href="${rows[0]?.promotion_slug?`/promotions/${encodeURIComponent(String(rows[0].promotion_slug))}`:'/promotions'}">Promotion scouting →</a></div><div class="event-directory-grid">${rows.map(eventCard).join('')}</div></section>`).join('');
  const recentHtml=recent.slice(0,12).map(eventCard).join('');
  const title=`Upcoming MMA Events: UFC, PFL, ONE, RIZIN & More | ${BRAND_NAME}`;
  const description=`Upcoming MMA event calendar across UFC, PFL, ONE Championship, RIZIN, OKTAGON, KSW, Cage Warriors, LFA, CFFC and Fury FC, connected to MMA Scouts fighter and promotion research.`;
  const canonical=`${SITE_ORIGIN}/events`;
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta name="description" content="${esc(description)}"><meta name="robots" content="index,follow,max-image-preview:large"><link rel="canonical" href="${canonical}"><link rel="icon" href="/logo.svg" type="image/svg+xml"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/scout-directory.css"><meta property="og:type" content="website"><meta property="og:site_name" content="${esc(BRAND_NAME)}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${canonical}"><meta property="og:image" content="${SITE_ORIGIN}/og.png"><meta name="twitter:card" content="summary_large_image"><style>
.event-directory{max-width:1180px;margin:0 auto;padding:52px 24px 72px}.event-directory-hero{max-width:860px;margin-bottom:42px}.event-directory-hero h1{font-size:clamp(2.6rem,7vw,5.6rem);line-height:.95;margin:.15em 0}.event-directory-hero p{font-size:1.05rem;color:var(--muted);max-width:760px}.event-directory-section{margin-top:44px}.event-directory-heading{display:flex;align-items:end;gap:18px;border-bottom:1px solid var(--border);padding-bottom:14px;margin-bottom:18px;flex-wrap:wrap}.event-directory-heading .eyebrow{width:100%}.event-directory-heading h2{margin:0;font-size:1.55rem}.event-directory-heading a{margin-left:auto;font-size:.82rem}.event-directory-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}.event-directory-card{display:block;background:var(--panel);border:1px solid var(--border);border-radius:16px;padding:18px;text-decoration:none;color:inherit;transition:transform .15s ease,border-color .15s ease}.event-directory-card:hover{transform:translateY(-2px);border-color:var(--accent)}.event-directory-meta{display:flex;justify-content:space-between;gap:12px;color:var(--muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.08em}.event-directory-card h3{font-size:1.1rem;margin:14px 0 8px}.event-directory-card p{color:var(--muted);font-size:.86rem;min-height:2.6em}.event-directory-arrow{display:block;margin-top:16px;font-size:.8rem;font-weight:800}.event-directory-empty{padding:28px;border:1px dashed var(--border);border-radius:14px;color:var(--muted)}@media(max-width:600px){.event-directory{padding:34px 16px 56px}.event-directory-heading{align-items:flex-start;flex-direction:column}.event-directory-heading a{margin-left:0}.event-directory-grid{grid-template-columns:1fr}}
</style></head><body><header class="topbar"><a class="brand" href="/" aria-label="${esc(BRAND_NAME)} home"><img class="brand-mark" src="/logo.svg" alt="" width="44" height="44"><span>${esc(BRAND_NAME)}</span></a></header><main class="event-directory"><section class="event-directory-hero"><span class="eyebrow">GLOBAL MMA CALENDAR</span><h1>What’s next in MMA.</h1><p>Official event tracking across major and feeder promotions. Open an event to research the card, the promotion and the fighters around it. MMA Scouts treats the event as scouting context—not as a picks screen.</p><div class="directory-hero-actions"><a class="button primary" href="/promotions">Browse promotions</a><a class="button secondary" href="/scout">Ask Scout AI</a></div></section>${groupHtml||'<p class="event-directory-empty">The next official cards are being synchronized now.</p>'}${recentHtml?`<section class="event-directory-section"><div class="event-directory-heading"><span class="eyebrow">RECENT</span><h2>Recently tracked events</h2></div><div class="event-directory-grid">${recentHtml}</div></section>`:''}</main><footer><span>${esc(BRAND_NAME)}</span><span>The MMA scouting engine.</span></footer></body></html>`;
  return new Response(html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'public, max-age=60, s-maxage=300','x-content-type-options':'nosniff'}});
}
