import {getFight} from './fights.ts';
import {BRAND_NAME,SITE_ORIGIN} from './brand.ts';

type Env={DB:D1Database;ASSETS:Fetcher;MODEL_VERSION:string};
type Row=Record<string,any>;
const SITE=SITE_ORIGIN;
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
function schemaLocation(event:Row|null){
  if(!event)return undefined;
  const paris=event.slug==='ufc-fight-night-september-05-2026';
  const venue=event.venue||(paris?'Accor Arena':undefined),city=event.city||(paris?'Paris':undefined),region=event.region||undefined,country=event.country||(paris?'France':undefined);
  if(!venue&&!city&&!region&&!country)return undefined;
  return {'@type':'Place',...(venue?{name:venue}:{}),...((city||region||country)?{address:{'@type':'PostalAddress',addressLocality:city,addressRegion:region,addressCountry:country}}:{})};
}

export async function enhanceFighterPage(response:Response,env:Env,slug:string){
  if(!response.ok||!response.headers.get('content-type')?.includes('text/html'))return response;
  const fighter=await env.DB.prepare(`SELECT id,slug,name,current_weight_class,ufc_bouts,active FROM fighters WHERE slug=? LIMIT 1`).bind(slug).first<Row>();
  if(!fighter)return response;
  const [rating,history]=await Promise.all([
    env.DB.prepare(`SELECT rh.cmr,rh.strength_of_schedule,rh.resume_rating,rh.confidence FROM ratings_history rh JOIN model_versions mv ON mv.id=rh.model_version_id WHERE rh.fighter_id=? AND mv.name='CageMetrix Opponent-Adjusted Rating' AND mv.version=? ORDER BY rh.as_of_date DESC,rh.id DESC LIMIT 1`).bind(fighter.id,env.MODEL_VERSION).first<Row>(),
    env.DB.prepare(`SELECT pre_ufc_bouts,pre_ufc_wins,pre_ufc_losses FROM ufc_fighter_history_summary WHERE fighter_id=? LIMIT 1`).bind(fighter.id).first<Row>()
  ]);
  const division=fighter.current_weight_class||'UFC',rawScore=rating?.cmr;
  const score=Number.isFinite(Number(rawScore))?Number(rawScore).toFixed(1):null,pre=Number(history?.pre_ufc_bouts||0);
  const title=`${fighter.name} Stats, Scout Rating & Fight History | ${BRAND_NAME}`;
  const description=`${fighter.name} ${division} stats, record and fight history${score?` with a ${score} opponent-adjusted Scout Rating`:''}. See strength of schedule${pre?`, ${pre} verified pre-UFC bouts`:''} and UFC performance.`.slice(0,190);
  const canonical=`${SITE}/fighters/${encodeURIComponent(slug)}`;
  const schema={'@context':'https://schema.org','@type':'Person',name:fighter.name,url:canonical,jobTitle:'Mixed Martial Artist',description,mainEntityOfPage:canonical,additionalProperty:score?[{'@type':'PropertyValue',name:'MMA Scouts Rating',value:score},{'@type':'PropertyValue',name:'Weight class',value:division}]:[{'@type':'PropertyValue',name:'Weight class',value:division}]};
  const crumbs={'@context':'https://schema.org','@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:BRAND_NAME,item:`${SITE}/`},{'@type':'ListItem',position:2,name:'MMA Rankings',item:`${SITE}/#rankings`},{'@type':'ListItem',position:3,name:fighter.name,item:canonical}]};
  return new HTMLRewriter()
    .on('title',{element(el){el.setInnerContent(title);}})
    .on('meta[name="description"]',{element(el){el.setAttribute('content',description);}})
    .on('link[rel="canonical"]',{element(el){el.setAttribute('href',canonical);}})
    .on('meta[property="og:title"]',{element(el){el.setAttribute('content',title);}})
    .on('meta[property="og:description"]',{element(el){el.setAttribute('content',description);}})
    .on('meta[property="og:url"]',{element(el){el.setAttribute('content',canonical);}})
    .on('meta[name="twitter:title"]',{element(el){el.setAttribute('content',title);}})
    .on('meta[name="twitter:description"]',{element(el){el.setAttribute('content',description);}})
    .on('#fighter-loading',{element(el){el.setAttribute('hidden','');}})
    .on('#fighter-content',{element(el){el.removeAttribute('hidden');}})
    .on('#fighter-name',{element(el){el.setInnerContent(String(fighter.name));}})
    .on('#fighter-division',{element(el){el.setInnerContent(`${division} · MMA SCOUTS FIGHTER PROFILE`);}})
    .on('#fighter-meta',{element(el){el.setInnerContent(`${Number(fighter.ufc_bouts||0)} UFC bouts${pre?` · ${pre} verified pre-UFC bouts`:''}`);}})
    .on('#fighter-cmr',{element(el){el.setInnerContent(score||'—');}})
    .on('#fighter-rank',{element(el){el.setInnerContent(score?'Current opponent-adjusted Scout Rating':'Rating pending');}})
    .on('script[type="application/ld+json"]',{element(el){el.remove();}})
    .on('head',{element(el){el.append(`<meta name="robots" content="index,follow,max-image-preview:large"><meta property="og:site_name" content="${BRAND_NAME}"><meta property="og:image" content="${SITE}/og.png"><meta name="twitter:image" content="${SITE}/og.png"><script type="application/ld+json">${jsonLd(schema)}</script><script type="application/ld+json">${jsonLd(crumbs)}</script>`,{html:true});}})
    .transform(response);
}

export async function enhanceFightPage(response:Response,env:Env,id:string){
  if(!response.ok||!response.headers.get('content-type')?.includes('text/html'))return response;
  const payload=await getFight(id,env);if(!payload)return response;
  const {bout,prediction}=payload;
  const event=await env.DB.prepare(`SELECT slug,name,event_date,starts_at,status,venue,city,region,country,updated_at FROM events WHERE id=? LIMIT 1`).bind(bout.event_id).first<Row>();
  const names=prediction.snapshot?.available?prediction.snapshot.fighters:null;
  const a=String(names?.a?.name||bout.fighter_a_name),b=String(names?.b?.name||bout.fighter_b_name);
  const pickedA=Number(prediction.picked_fighter_id)===Number(bout.fighter_a_id),pickedB=Number(prediction.picked_fighter_id)===Number(bout.fighter_b_id);
  const pickName=pickedA?a:pickedB?b:Number(prediction.fighter_a_probability)>=Number(prediction.fighter_b_probability)?a:b;
  const pickProbability=pickName===a?prediction.fighter_a_probability:prediction.fighter_b_probability;
  const pickPct=pct(pickProbability),label=event?eventSeoName(event):String(bout.event_name||'UFC event');
  const fullTitle=`${a} vs ${b} Prediction: ${pickName} ${pickPct} | ${BRAND_NAME}`;
  const title=fullTitle.length<=72?fullTitle:`${a} vs ${b} Prediction & Pick | ${BRAND_NAME}`;
  const description=`${a} vs ${b} prediction: ${BRAND_NAME} picks ${pickName} with a ${pickPct} model win probability for ${label}${event?.event_date?` on ${prettyDate(event.event_date)}`:''}. Compare opponent-adjusted ratings, stats, model edges and reasoning.`.slice(0,175);
  const canonical=`${SITE}/fights/${id}`,eventCanonical=event?.slug?`${SITE}/events/${encodeURIComponent(String(event.slug))}`:undefined;
  const aUrl=`${SITE}/fighters/${encodeURIComponent(String(bout.fighter_a_slug))}`,bUrl=`${SITE}/fighters/${encodeURIComponent(String(bout.fighter_b_slug))}`;
  const place=schemaLocation(event),startDate=event?.starts_at||bout.starts_at||bout.event_date,modified=prediction.created_at||event?.updated_at||bout.updated_at||undefined;
  const graph:any[]=[
    {'@type':'WebSite','@id':`${SITE}/#website`,url:`${SITE}/`,name:BRAND_NAME},
    {'@type':'WebPage','@id':`${canonical}#webpage`,url:canonical,name:title,description,isPartOf:{'@id':`${SITE}/#website`},mainEntity:{'@id':`${canonical}#fight`},about:[{'@id':`${aUrl}#fighter`},{'@id':`${bUrl}#fighter`}],...(modified?{dateModified:modified}:{})},
    {'@type':'SportsEvent','@id':`${canonical}#fight`,name:`${a} vs ${b}`,url:canonical,description,startDate,eventStatus:schemaStatus(event?.status||bout.status),eventAttendanceMode:'https://schema.org/OfflineEventAttendanceMode',sport:'Mixed Martial Arts',organizer:{'@type':'Organization',name:'UFC',url:'https://www.ufc.com/'},competitor:[{'@id':`${aUrl}#fighter`},{'@id':`${bUrl}#fighter`}],performer:[{'@id':`${aUrl}#fighter`},{'@id':`${bUrl}#fighter`}],...(place?{location:place}:{}),...(eventCanonical?{superEvent:{'@type':'SportsEvent',name:label,url:eventCanonical}}:{})},
    {'@type':'Person','@id':`${aUrl}#fighter`,name:a,url:aUrl,jobTitle:'Mixed Martial Artist'},
    {'@type':'Person','@id':`${bUrl}#fighter`,name:b,url:bUrl,jobTitle:'Mixed Martial Artist'},
    {'@type':'BreadcrumbList','@id':`${canonical}#breadcrumbs`,itemListElement:[{'@type':'ListItem',position:1,name:BRAND_NAME,item:`${SITE}/`},{'@type':'ListItem',position:2,name:label,item:eventCanonical||`${SITE}/predictions.html`},{'@type':'ListItem',position:3,name:`${a} vs ${b}`,item:canonical}]}
  ];
  const structured={'@context':'https://schema.org','@graph':graph};
  const eventHtml=eventCanonical?`<a href="${eventCanonical}">${esc(label)}</a>${event?.event_date?` · ${esc(prettyDate(event.event_date))}`:''}`:`${esc(label)}${event?.event_date?` · ${esc(prettyDate(event.event_date))}`:''}`;
  const probabilityHtml=`<p class="lede"><strong>${esc(a)} ${pct(prediction.fighter_a_probability)}</strong> · <strong>${esc(b)} ${pct(prediction.fighter_b_probability)}</strong></p><p class="muted">Locked Predictor ${esc(prediction.model_version)} win probabilities. Model probabilities, not sportsbook lines.</p>`;
  const transformed=new HTMLRewriter()
    .on('title',{element(el){el.setInnerContent(title);}})
    .on('meta[name="description"]',{element(el){el.setAttribute('content',description);}})
    .on('link[rel="canonical"]',{element(el){el.setAttribute('href',canonical);}})
    .on('meta[property="og:title"]',{element(el){el.setAttribute('content',title);}})
    .on('meta[property="og:description"]',{element(el){el.setAttribute('content',description);}})
    .on('meta[property="og:url"]',{element(el){el.setAttribute('content',canonical);}})
    .on('meta[name="twitter:title"]',{element(el){el.setAttribute('content',title);}})
    .on('meta[name="twitter:description"]',{element(el){el.setAttribute('content',description);}})
    .on('meta[name="twitter:card"]',{element(el){el.setAttribute('content','summary_large_image');}})
    .on('#fight-event',{element(el){el.setInnerContent(eventHtml,{html:true});}})
    .on('#fight-context',{element(el){el.setInnerContent(`${esc(a)} vs ${esc(b)} matchup analysis, opponent-adjusted ratings and preserved pre-fight model inputs.`,{html:true});}})
    .on('#fight-probability',{element(el){el.setInnerContent(probabilityHtml,{html:true});}})
    .on('script[type="application/ld+json"]',{element(el){el.remove();}})
    .on('head',{element(el){el.append(`<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1"><meta property="og:site_name" content="${BRAND_NAME}"><meta property="og:locale" content="en_US"><meta property="og:image" content="${SITE}/og.png"><meta name="twitter:image" content="${SITE}/og.png"><script type="application/ld+json">${jsonLd(structured)}</script>`,{html:true});}})
    .transform(response);
  const out=new Response(transformed.body,transformed);
  out.headers.set('Link',`<${canonical}>; rel="canonical"`);
  return out;
}
