import {getFight} from './fights.ts';

type Env={DB:D1Database;ASSETS:Fetcher;MODEL_VERSION:string};
type Row=Record<string,any>;
const SITE='https://cagemetrix.com';
const jsonLd=(v:unknown)=>JSON.stringify(v).replace(/</g,'\\u003c');
const pct=(v:unknown)=>`${(Number(v||0)*100).toFixed(1)}%`;
const dateOnly=(v:unknown)=>/^\d{4}-\d{2}-\d{2}/.test(String(v||''))?String(v).slice(0,10):null;
const prettyDate=(v:unknown)=>{const d=dateOnly(v);return d?new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(`${d}T12:00:00Z`)):'';};
const eventStatus=(status:unknown)=>status==='completed'?'https://schema.org/EventCompleted':status==='cancelled'?'https://schema.org/EventCancelled':'https://schema.org/EventScheduled';

export function canonicalRedirect(request:Request){
  const url=new URL(request.url),host=url.hostname.toLowerCase();
  const alternateHost=host==='www.cagemetrix.com';
  const insecureCanonical=host==='cagemetrix.com'&&url.protocol==='http:';
  if(!alternateHost&&!insecureCanonical)return null;
  url.protocol='https:';url.hostname='cagemetrix.com';url.port='';
  return new Response(null,{status:308,headers:{location:url.toString(),'cache-control':'public, max-age=31536000, immutable'}});
}

function eventName(event:Row|null,bout:Row){
  const raw=String(event?.name||bout.event_name||'UFC event');
  return raw.replace(/\s*:\s*[^:]+\s+vs\s+[^:]+$/i,'').trim()||'UFC event';
}
function location(event:Row|null){
  if(!event)return undefined;
  const venue=event.venue||undefined,city=event.city||undefined,region=event.region||undefined,country=event.country||undefined;
  if(!venue&&!city&&!region&&!country)return undefined;
  return {'@type':'Place',...(venue?{name:venue}:{}),...((city||region||country)?{address:{'@type':'PostalAddress',addressLocality:city,addressRegion:region,addressCountry:country}}:{})};
}

export async function enhanceFightSearchSnippet(response:Response,env:Env,id:string){
  if(!response.ok||!response.headers.get('content-type')?.includes('text/html'))return response;
  const payload=await getFight(id,env);if(!payload)return response;
  const {bout,prediction}=payload;
  const event=await env.DB.prepare(`SELECT slug,name,event_date,starts_at,status,venue,city,region,country,updated_at FROM events WHERE id=? LIMIT 1`).bind(bout.event_id).first<Row>();
  const names=prediction.snapshot?.available?prediction.snapshot.fighters:null;
  const a=String(names?.a?.name||bout.fighter_a_name),b=String(names?.b?.name||bout.fighter_b_name);
  const pickedA=Number(prediction.picked_fighter_id)===Number(bout.fighter_a_id),pickedB=Number(prediction.picked_fighter_id)===Number(bout.fighter_b_id);
  const pickName=pickedA?a:pickedB?b:Number(prediction.fighter_a_probability)>=Number(prediction.fighter_b_probability)?a:b;
  const pickProbability=pickName===a?prediction.fighter_a_probability:prediction.fighter_b_probability;
  const pickPct=pct(pickProbability),label=eventName(event,bout);
  const fullTitle=`${a} vs ${b} Prediction: ${pickName} ${pickPct} | CageMetrix`;
  const title=fullTitle.length<=72?fullTitle:`${a} vs ${b} Prediction & Pick | CageMetrix`;
  const description=`${a} vs ${b} prediction: CageMetrix picks ${pickName} with a ${pickPct} win probability for ${label}${event?.event_date?` on ${prettyDate(event.event_date)}`:''}. Compare opponent-adjusted ratings, stats, model edges, crowd picks and reasoning.`.slice(0,175);
  const canonical=`${SITE}/fights/${id}`,eventCanonical=event?.slug?`${SITE}/events/${encodeURIComponent(String(event.slug))}`:undefined;
  const aUrl=`${SITE}/fighters/${encodeURIComponent(String(bout.fighter_a_slug))}`,bUrl=`${SITE}/fighters/${encodeURIComponent(String(bout.fighter_b_slug))}`;
  const place=location(event),startDate=event?.starts_at||bout.starts_at||bout.event_date;
  const modified=prediction.created_at||event?.updated_at||bout.updated_at||undefined;
  const graph:any[]=[
    {'@type':'WebPage','@id':`${canonical}#webpage`,url:canonical,name:title,description,isPartOf:{'@id':`${SITE}/#website`},mainEntity:{'@id':`${canonical}#fight`},about:[{'@id':`${aUrl}#fighter`},{'@id':`${bUrl}#fighter`}],...(modified?{dateModified:modified}:{})},
    {'@type':'SportsEvent','@id':`${canonical}#fight`,name:`${a} vs ${b}`,url:canonical,description,startDate,eventStatus:eventStatus(event?.status||bout.status),eventAttendanceMode:'https://schema.org/OfflineEventAttendanceMode',sport:'Mixed Martial Arts',organizer:{'@type':'Organization',name:'UFC',url:'https://www.ufc.com/'},competitor:[{'@id':`${aUrl}#fighter`},{'@id':`${bUrl}#fighter`}],performer:[{'@id':`${aUrl}#fighter`},{'@id':`${bUrl}#fighter`}],...(place?{location:place}:{}),...(eventCanonical?{superEvent:{'@type':'SportsEvent',name:label,url:eventCanonical}}:{})},
    {'@type':'Person','@id':`${aUrl}#fighter`,name:a,url:aUrl,jobTitle:'Mixed Martial Artist'},
    {'@type':'Person','@id':`${bUrl}#fighter`,name:b,url:bUrl,jobTitle:'Mixed Martial Artist'},
    {'@type':'BreadcrumbList','@id':`${canonical}#breadcrumbs`,itemListElement:[{'@type':'ListItem',position:1,name:'CageMetrix',item:`${SITE}/`},{'@type':'ListItem',position:2,name:label,item:eventCanonical||`${SITE}/predictions.html`},{'@type':'ListItem',position:3,name:`${a} vs ${b}`,item:canonical}]}
  ];
  const structured={'@context':'https://schema.org','@graph':graph};
  const transformed=new HTMLRewriter()
    .on('title',{element(el){el.setInnerContent(title);}})
    .on('meta[name="description"]',{element(el){el.setAttribute('content',description);}})
    .on('meta[name="robots"]',{element(el){el.setAttribute('content','index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1');}})
    .on('link[rel="canonical"]',{element(el){el.setAttribute('href',canonical);}})
    .on('meta[property="og:title"]',{element(el){el.setAttribute('content',title);}})
    .on('meta[property="og:description"]',{element(el){el.setAttribute('content',description);}})
    .on('meta[property="og:url"]',{element(el){el.setAttribute('content',canonical);}})
    .on('meta[name="twitter:title"]',{element(el){el.setAttribute('content',title);}})
    .on('meta[name="twitter:description"]',{element(el){el.setAttribute('content',description);}})
    .on('meta[name="twitter:card"]',{element(el){el.setAttribute('content','summary_large_image');}})
    .on('script[type="application/ld+json"]',{element(el){el.remove();}})
    .on('head',{element(el){el.append(`<meta property="og:site_name" content="CageMetrix"><meta property="og:locale" content="en_US"><script type="application/ld+json">${jsonLd(structured)}</script>`,{html:true});}})
    .transform(response);
  const out=new Response(transformed.body,transformed);
  out.headers.set('Link',`<${canonical}>; rel="canonical"`);
  return out;
}
