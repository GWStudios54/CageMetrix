import {getFight} from './fights.ts';

type Env={DB:D1Database;ASSETS:Fetcher;MODEL_VERSION:string};
type Row=Record<string,any>;
const SITE='https://cagemetrix.com';
const PREDICTOR_NAME='CageMetrix Win Probability';
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const jsonLd=(v:unknown)=>JSON.stringify(v).replace(/</g,'\\u003c');
const pct=(v:unknown)=>`${(Number(v||0)*100).toFixed(1)}%`;
const dateOnly=(v:unknown)=>/^\d{4}-\d{2}-\d{2}/.test(String(v||''))?String(v).slice(0,10):null;
const prettyDate=(v:unknown)=>{const d=dateOnly(v);return d?new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(`${d}T12:00:00Z`)):'';};

export function eventSeoName(event:Row){
  if(event.slug==='ufc-fight-night-september-05-2026')return 'UFC Paris';
  return String(event.name||'UFC event').replace(/\s*:\s*[^:]+\s+vs\s+[^:]+$/i,'').trim()||'UFC event';
}
function schemaStatus(status:unknown){return status==='completed'?'https://schema.org/EventCompleted':status==='cancelled'?'https://schema.org/EventCancelled':'https://schema.org/EventScheduled';}
function schemaLocation(event:Row){
  const address=[event.city,event.region,event.country].filter(Boolean).join(', ');
  if(!event.venue&&!address)return undefined;
  return {'@type':'Place',...(event.venue?{name:event.venue}:{}),...(address?{address:{'@type':'PostalAddress',addressLocality:event.city||undefined,addressRegion:event.region||undefined,addressCountry:event.country||undefined}}:{})};
}

export async function sitemap(env:Env){
  const [fighters,events,fights]=await Promise.all([
    env.DB.prepare(`SELECT slug,COALESCE(last_fight_date,updated_at) lastmod FROM fighters WHERE slug IS NOT NULL AND (active=1 OR ufc_bouts>0) ORDER BY id`).all<Row>(),
    env.DB.prepare(`SELECT DISTINCT e.slug,e.event_date FROM events e WHERE e.slug IS NOT NULL AND EXISTS(SELECT 1 FROM bouts b JOIN predictions p ON p.bout_id=b.id WHERE b.event_id=e.id) ORDER BY e.event_date DESC`).all<Row>(),
    env.DB.prepare(`SELECT DISTINCT b.id,e.event_date FROM bouts b JOIN events e ON e.id=b.event_id WHERE EXISTS(SELECT 1 FROM predictions p WHERE p.bout_id=b.id) ORDER BY e.event_date DESC,b.id`).all<Row>()
  ]);
  const urls:[string,string|null,string,string][]=[
    [`${SITE}/`,null,'daily','1.0'],[`${SITE}/predictions.html`,null,'hourly','0.9'],[`${SITE}/validation.html`,null,'weekly','0.6']
  ];
  for(const r of events.results||[])urls.push([`${SITE}/events/${encodeURIComponent(String(r.slug))}`,dateOnly(r.event_date),'daily','0.9']);
  for(const r of fights.results||[])urls.push([`${SITE}/fights/${r.id}`,dateOnly(r.event_date),'daily','0.8']);
  for(const r of fighters.results||[])urls.push([`${SITE}/fighters/${encodeURIComponent(String(r.slug))}`,dateOnly(r.lastmod),'weekly','0.7']);
  const body=`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([loc,lastmod,freq,priority])=>`  <url><loc>${esc(loc)}</loc>${lastmod?`<lastmod>${lastmod}</lastmod>`:''}<changefreq>${freq}</changefreq><priority>${priority}</priority></url>`).join('\n')}\n</urlset>\n`;
  return new Response(body,{headers:{'content-type':'application/xml; charset=utf-8','cache-control':'public, max-age=900, s-maxage=3600'}});
}

export async function eventPage(_request:Request,env:Env,slug:string){
  if(!/^[a-z0-9-]{1,180}$/.test(slug))return new Response('Not found',{status:404});
  const event=await env.DB.prepare(`SELECT id,promotion,slug,name,event_date,starts_at,venue,city,region,country,status,source_url FROM events WHERE slug=? LIMIT 1`).bind(slug).first<Row>();
  if(!event)return new Response('<!doctype html><html lang="en"><head><meta name="robots" content="noindex"><title>Event not found — CageMetrix™</title></head><body><h1>Event not found</h1></body></html>',{status:404,headers:{'content-type':'text/html; charset=utf-8'}});
  const rows=await env.DB.prepare(`WITH picks AS (
      SELECT p.*,mv.version model_version,ROW_NUMBER() OVER(PARTITION BY p.bout_id ORDER BY mv.version DESC,p.id DESC) rn
      FROM predictions p JOIN model_versions mv ON mv.id=p.model_version_id WHERE mv.name=?
    ) SELECT b.id,b.bout_order,b.weight_class,b.status,b.winner_id,
      a.id fighter_a_id,a.name fighter_a_name,a.slug fighter_a_slug,z.id fighter_b_id,z.name fighter_b_name,z.slug fighter_b_slug,
      p.fighter_a_probability,p.fighter_b_probability,p.picked_fighter_id,p.model_version
      FROM bouts b JOIN fighters a ON a.id=b.fighter_a_id JOIN fighters z ON z.id=b.fighter_b_id
      LEFT JOIN picks p ON p.bout_id=b.id AND p.rn=1 WHERE b.event_id=? ORDER BY b.bout_order,b.id`).bind(PREDICTOR_NAME,event.id).all<Row>();
  const bouts=rows.results||[],main=bouts[0],label=eventSeoName(event);
  const matchup=main?`${main.fighter_a_name} vs ${main.fighter_b_name}`:String(event.name||label);
  const canonical=`${SITE}/events/${encodeURIComponent(slug)}`;
  const title=`${label} Predictions: ${matchup} Picks & Win Probabilities | CageMetrix™`;
  const description=`${label} predictions for ${matchup} and the full ${prettyDate(event.event_date)} card. CageMetrix™ model picks, win probabilities, CMR™ and matchup stats.`.slice(0,190);
  const location=schemaLocation(event);
  const schema:any={'@context':'https://schema.org','@type':'SportsEvent',name:`${label}: ${matchup}`,url:canonical,startDate:event.starts_at||event.event_date,eventStatus:schemaStatus(event.status),sport:'Mixed Martial Arts',organizer:{'@type':'Organization',name:'UFC',url:'https://www.ufc.com/'},...(event.source_url?{sameAs:event.source_url}:{}),...(location?{location}:{}),competitor:main?[{'@type':'Person',name:main.fighter_a_name,url:`${SITE}/fighters/${main.fighter_a_slug}`},{'@type':'Person',name:main.fighter_b_name,url:`${SITE}/fighters/${main.fighter_b_slug}`}]:undefined,subEvent:bouts.map((b:Row)=>({'@type':'SportsEvent',name:`${b.fighter_a_name} vs ${b.fighter_b_name}`,url:`${SITE}/fights/${b.id}`,startDate:event.starts_at||event.event_date,sport:'Mixed Martial Arts',competitor:[{'@type':'Person',name:b.fighter_a_name,url:`${SITE}/fighters/${b.fighter_a_slug}`},{'@type':'Person',name:b.fighter_b_name,url:`${SITE}/fighters/${b.fighter_b_slug}`}]}))};
  const crumbs={'@context':'https://schema.org','@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'CageMetrix',item:`${SITE}/`},{'@type':'ListItem',position:2,name:'UFC Predictions',item:`${SITE}/predictions.html`},{'@type':'ListItem',position:3,name:label,item:canonical}]};
  const cards=bouts.map((b:Row)=>{
    const has=Number.isFinite(Number(b.fighter_a_probability))&&Number.isFinite(Number(b.fighter_b_probability));
    const ap=has&&Number(b.picked_fighter_id)===Number(b.fighter_a_id),bp=has&&Number(b.picked_fighter_id)===Number(b.fighter_b_id);
    return `<article class="event-fight"><p class="eyebrow">${esc(b.weight_class||'UFC bout')}</p><h2><a href="/fights/${b.id}">${esc(b.fighter_a_name)} vs ${esc(b.fighter_b_name)} prediction</a></h2><p><a href="/fighters/${esc(b.fighter_a_slug)}">${esc(b.fighter_a_name)}</a> ${has?`<strong>${pct(b.fighter_a_probability)}${ap?' model pick':''}</strong>`:''} · <a href="/fighters/${esc(b.fighter_b_slug)}">${esc(b.fighter_b_name)}</a> ${has?`<strong>${pct(b.fighter_b_probability)}${bp?' model pick':''}</strong>`:''}</p><p class="muted">${has?`Locked CageMetrix™ Predictor ${esc(b.model_version)} win probability.`:'Prediction pending.'}</p><a class="button secondary" href="/fights/${b.id}">Prediction, stats & model explanation →</a></article>`;
  }).join('');
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta name="description" content="${esc(description)}"><meta name="robots" content="index,follow,max-image-preview:large"><link rel="canonical" href="${canonical}"><link rel="icon" href="/logo.svg" type="image/svg+xml"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/explorer.css"><meta property="og:type" content="article"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${canonical}"><meta property="og:image" content="${SITE}/og.png"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(description)}"><meta name="twitter:image" content="${SITE}/og.png"><script type="application/ld+json">${jsonLd(schema)}</script><script type="application/ld+json">${jsonLd(crumbs)}</script><style>.event-seo{max-width:1120px;margin:0 auto;padding:48px 24px}.event-seo .lede{max-width:780px}.event-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px;margin-top:28px}.event-fight{border:1px solid var(--line,#d8d8d8);border-radius:18px;padding:22px;background:var(--panel,#fff)}.event-fight h2{font-size:1.25rem;margin:.3rem 0 .7rem}.event-fight p{line-height:1.55}.event-nav{display:flex;gap:12px;flex-wrap:wrap;margin-top:24px}</style></head><body><header class="topbar"><a class="brand" href="/"><img class="brand-mark" src="/logo.svg" width="44" height="44" alt=""><span>CageMetrix™</span></a><nav><a href="/predictions.html">Predictions</a><a href="/#rankings">Rankings</a><a href="/validation.html">Track record</a></nav></header><main class="event-seo"><p class="eyebrow">${esc(String(event.promotion||'UFC').toUpperCase())} · ${esc(prettyDate(event.event_date))}</p><h1>${esc(label)} Predictions: ${esc(matchup)}</h1><p class="lede">CageMetrix™ model picks and win probabilities for ${esc(label)}, headlined by ${esc(matchup)}. Every prediction is locked before the event and remains on the public record.</p><div class="event-nav"><a class="button primary" href="/predictions.html">All UFC predictions</a>${event.source_url?`<a class="button secondary" href="${esc(event.source_url)}" rel="nofollow noopener">Official UFC event page</a>`:''}</div><p class="model-note">Win probabilities are model estimates, not betting odds. Technical statistics remain UFC-specific; verified pre-UFC résumé context may inform low-sample fighters.</p><section><div class="section-heading"><div><p class="eyebrow">FULL CARD</p><h2>${esc(label)} fight predictions</h2></div><p>${bouts.length} matchups with preserved model probabilities and fight-specific breakdowns.</p></div><div class="event-grid">${cards||'<p>Fight predictions are being prepared.</p>'}</div></section></main><footer><span>CageMetrix™</span><span>Transparent, opponent-adjusted MMA analytics.</span></footer></body></html>`;
  return new Response(html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'public, max-age=60, s-maxage=300','x-content-type-options':'nosniff'}});
}

export async function enhanceFighterPage(response:Response,env:Env,slug:string){
  if(!response.ok||!response.headers.get('content-type')?.includes('text/html'))return response;
  const fighter=await env.DB.prepare(`SELECT id,slug,name,current_weight_class,ufc_bouts,active FROM fighters WHERE slug=? LIMIT 1`).bind(slug).first<Row>();
  if(!fighter)return response;
  const [rating,history]=await Promise.all([
    env.DB.prepare(`SELECT rh.cmr,rh.strength_of_schedule,rh.resume_rating,rh.confidence FROM ratings_history rh JOIN model_versions mv ON mv.id=rh.model_version_id WHERE rh.fighter_id=? AND mv.name='CageMetrix Opponent-Adjusted Rating' AND mv.version=? ORDER BY rh.as_of_date DESC,rh.id DESC LIMIT 1`).bind(fighter.id,env.MODEL_VERSION).first<Row>(),
    env.DB.prepare(`SELECT pre_ufc_bouts,pre_ufc_wins,pre_ufc_losses FROM ufc_fighter_history_summary WHERE fighter_id=? LIMIT 1`).bind(fighter.id).first<Row>()
  ]);
  const division=fighter.current_weight_class||'UFC';
  const rawScore=rating?.cmr;
  const score=Number.isFinite(Number(rawScore))?Number(rawScore).toFixed(1):null;
  const pre=Number(history?.pre_ufc_bouts||0);
  const title=`${fighter.name} Stats, CMR™ & Fight History | CageMetrix™`;
  const description=`${fighter.name} ${division} stats and fight history${score?` with a ${score} CageMetrix™ rating`:''}. See opponent-adjusted CMR™, strength of schedule${pre?`, ${pre} verified pre-UFC bouts`:''} and UFC performance.`.slice(0,190);
  const canonical=`${SITE}/fighters/${encodeURIComponent(slug)}`;
  const schema={'@context':'https://schema.org','@type':'Person',name:fighter.name,url:canonical,jobTitle:'Mixed Martial Artist',description,mainEntityOfPage:canonical,additionalProperty:score?[{'@type':'PropertyValue',name:'CageMetrix Rating',value:score},{'@type':'PropertyValue',name:'Weight class',value:division}]:[{'@type':'PropertyValue',name:'Weight class',value:division}]};
  const crumbs={'@context':'https://schema.org','@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'CageMetrix',item:`${SITE}/`},{'@type':'ListItem',position:2,name:'UFC Rankings',item:`${SITE}/#rankings`},{'@type':'ListItem',position:3,name:fighter.name,item:canonical}]};
  return new HTMLRewriter().on('title',{element(el){el.setInnerContent(title);}}).on('meta[name="description"]',{element(el){el.setAttribute('content',description);}}).on('meta[property="og:title"]',{element(el){el.setAttribute('content',title);}}).on('meta[property="og:description"]',{element(el){el.setAttribute('content',description);}}).on('meta[name="twitter:title"]',{element(el){el.setAttribute('content',title);}}).on('meta[name="twitter:description"]',{element(el){el.setAttribute('content',description);}}).on('#fighter-loading',{element(el){el.setAttribute('hidden','');}}).on('#fighter-content',{element(el){el.removeAttribute('hidden');}}).on('#fighter-name',{element(el){el.setInnerContent(String(fighter.name));}}).on('#fighter-division',{element(el){el.setInnerContent(`${division} · CAGEMETRIX™ FIGHTER PROFILE`);}}).on('#fighter-meta',{element(el){el.setInnerContent(`${Number(fighter.ufc_bouts||0)} UFC bouts${pre?` · ${pre} verified pre-UFC bouts`:''}`);}}).on('#fighter-cmr',{element(el){el.setInnerContent(score||'—');}}).on('#fighter-rank',{element(el){el.setInnerContent(score?'Current opponent-adjusted CMR™':'Rating pending');}}).on('head',{element(el){el.append(`<meta name="robots" content="index,follow,max-image-preview:large"><meta property="og:image" content="${SITE}/og.png"><meta name="twitter:image" content="${SITE}/og.png"><script type="application/ld+json">${jsonLd(schema)}</script><script type="application/ld+json">${jsonLd(crumbs)}</script>`,{html:true});}}).transform(response);
}

export async function enhanceFightPage(response:Response,env:Env,id:string){
  if(!response.ok||!response.headers.get('content-type')?.includes('text/html'))return response;
  const payload=await getFight(id,env);if(!payload)return response;
  const {bout,prediction}=payload;
  const event=await env.DB.prepare(`SELECT slug,name,event_date,starts_at,status,venue,city,region,country,source_url FROM events WHERE id=? LIMIT 1`).bind(bout.event_id).first<Row>();
  const names=prediction.snapshot?.available?prediction.snapshot.fighters:null;
  const a=names?.a?.name||bout.fighter_a_name,b=names?.b?.name||bout.fighter_b_name,eventLabel=event?eventSeoName(event):String(bout.event_name||'UFC');
  const title=`${a} vs ${b} Prediction & Stats — ${eventLabel} | CageMetrix™`;
  const description=`${a} vs ${b} prediction for ${eventLabel}${event?.event_date?` on ${prettyDate(event.event_date)}`:''}: CageMetrix™ gives ${a} ${pct(prediction.fighter_a_probability)} and ${b} ${pct(prediction.fighter_b_probability)}. See CMR™, stats and model edges.`.slice(0,190);
  const canonical=`${SITE}/fights/${id}`,eventCanonical=event?.slug?`${SITE}/events/${event.slug}`:undefined,location=event?schemaLocation(event):undefined;
  const schema:any={'@context':'https://schema.org','@type':'SportsEvent',name:`${a} vs ${b}`,url:canonical,startDate:event?.starts_at||bout.starts_at||bout.event_date,eventStatus:schemaStatus(bout.status),sport:'Mixed Martial Arts',organizer:{'@type':'Organization',name:'UFC',url:'https://www.ufc.com/'},competitor:[{'@type':'Person',name:a,url:`${SITE}/fighters/${bout.fighter_a_slug}`},{'@type':'Person',name:b,url:`${SITE}/fighters/${bout.fighter_b_slug}`}],...(location?{location}:{}),...(eventCanonical?{superEvent:{'@type':'SportsEvent',name:eventLabel,url:eventCanonical}}:{})};
  const crumbs={'@context':'https://schema.org','@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'CageMetrix',item:`${SITE}/`},{'@type':'ListItem',position:2,name:eventLabel,item:eventCanonical||`${SITE}/predictions.html`},{'@type':'ListItem',position:3,name:`${a} vs ${b}`,item:canonical}]};
  const eventHtml=eventCanonical?`<a href="${eventCanonical}">${esc(eventLabel)}</a>${event?.event_date?` · ${esc(prettyDate(event.event_date))}`:''}`:`${esc(eventLabel)}${event?.event_date?` · ${esc(prettyDate(event.event_date))}`:''}`;
  const probabilityHtml=`<p class="lede"><strong>${esc(a)} ${pct(prediction.fighter_a_probability)}</strong> · <strong>${esc(b)} ${pct(prediction.fighter_b_probability)}</strong></p><p class="muted">Locked Predictor ${esc(prediction.model_version)} win probabilities. Model estimates, not betting odds.</p>`;
  return new HTMLRewriter().on('title',{element(el){el.setInnerContent(title);}}).on('meta[name="description"]',{element(el){el.setAttribute('content',description);}}).on('meta[property="og:title"]',{element(el){el.setAttribute('content',title);}}).on('meta[property="og:description"]',{element(el){el.setAttribute('content',description);}}).on('meta[name="twitter:title"]',{element(el){el.setAttribute('content',title);}}).on('meta[name="twitter:description"]',{element(el){el.setAttribute('content',description);}}).on('#fight-event',{element(el){el.setInnerContent(eventHtml,{html:true});}}).on('#fight-context',{element(el){el.setInnerContent(`${esc(a)} vs ${esc(b)} matchup analysis, opponent-adjusted ratings and preserved pre-fight model inputs.`,{html:true});}}).on('#fight-probability',{element(el){el.setInnerContent(probabilityHtml,{html:true});}}).on('head',{element(el){el.append(`<meta name="robots" content="index,follow,max-image-preview:large"><meta property="og:image" content="${SITE}/og.png"><meta name="twitter:image" content="${SITE}/og.png"><script type="application/ld+json">${jsonLd(schema)}</script><script type="application/ld+json">${jsonLd(crumbs)}</script>`,{html:true});}}).transform(response);
}
