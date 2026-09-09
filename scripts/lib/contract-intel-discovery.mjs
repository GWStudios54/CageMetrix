import {createHash} from 'node:crypto';
import {JSDOM} from 'jsdom';

export const CONTRACT_DISCOVERY_SOURCES=[
  {slug:'ufc-news',publisher:'UFC',sourceType:'promotion_direct',promotionSlug:'ufc',kind:'html',url:'https://www.ufc.com/trending/all',host:'www.ufc.com',path:/\/news\//i},
  {slug:'pfl-news',publisher:'Professional Fighters League',sourceType:'promotion_direct',promotionSlug:'pfl',kind:'html',url:'https://pflmma.com/news/',host:'pflmma.com',path:/\/news\//i},
  {slug:'one-mma-rss',publisher:'ONE Championship',sourceType:'promotion_direct',promotionSlug:'one',kind:'rss',url:'https://www.onefc.com/category/mixed-martial-arts/feed/',host:'www.onefc.com',path:/\/(?:news|features)\//i},
  {slug:'mma-fighting',publisher:'MMA Fighting',sourceType:'reputable_trade_reporting',promotionSlug:null,kind:'html',url:'https://www.mmafighting.com/',host:'www.mmafighting.com',path:/\/(?:ufc|pfl|mma-news|latest-news)\//i}
];

const SIGNAL_RE=/\b(?:sign(?:s|ed|ing)?|re[- ]?sign(?:s|ed|ing)?|new\s+(?:multi[- ]fight\s+)?deal|contract(?:s|ed)?|extension|renew(?:s|ed|al)?|renegotiat(?:e|ed|ion)|free\s+agent|free\s+agency|release(?:d|s)?|part(?:s|ed)?\s+ways|option\s+(?:exercised|declined)|remaining\s+fights?|last\s+fight\s+(?:on|under)\s+(?:his|her|the)?\s*contract)\b/i;
const NON_FIGHTER_RE=/\b(?:media rights|broadcast|streaming|sponsorship deal|partnership|venue deal|rights agreement)\b/i;

export function normalizeContractText(value){return String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[’']/g,"'").toLowerCase().replace(/[^a-z0-9' -]+/g,' ').replace(/[-]+/g,' ').replace(/\s+/g,' ').trim();}
export function hasContractSignal(value){const text=normalizeContractText(value);return SIGNAL_RE.test(text)&&!NON_FIGHTER_RE.test(text);}
export function detectContractSignal(value){
  const text=normalizeContractText(value);
  if(/\bfree\s+agent(?:cy)?\b/.test(text))return {eventType:'free_agency',status:'free_agent'};
  if(/\brelease(?:d|s)?\b|\bpart(?:s|ed)?\s+ways\b/.test(text))return {eventType:'release',status:'released'};
  if(/\boption\s+exercised\b/.test(text))return {eventType:'option_exercised',status:'under_contract'};
  if(/\boption\s+declined\b/.test(text))return {eventType:'option_declined',status:'unknown'};
  if(/\brenegotiat(?:e|ed|ion)\b/.test(text))return {eventType:'renegotiation',status:'under_contract'};
  if(/\bextension\b|\bre[- ]?sign(?:s|ed|ing)?\b/.test(text))return {eventType:'extension',status:'under_contract'};
  if(/\brenew(?:s|ed|al)?\b/.test(text))return {eventType:'renewal',status:'under_contract'};
  if(/\blast\s+fight\s+(?:on|under)\b|\bremaining\s+fights?\b/.test(text))return {eventType:'status_update',status:'unknown'};
  if(/\bsign(?:s|ed|ing)?\b|\bnew\s+(?:multi\s+fight\s+)?deal\b|\bcontract(?:s|ed)?\b/.test(text))return {eventType:'signing',status:'under_contract'};
  return {eventType:'status_update',status:'unknown'};
}

function absoluteUrl(href,base){try{return new URL(href,base).href}catch{return null;}}
function approvedUrl(url,source){try{const parsed=new URL(url);return parsed.protocol==='https:'&&parsed.hostname===source.host&&source.path.test(parsed.pathname);}catch{return false;}}
function clean(value){return String(value??'').replace(/\s+/g,' ').trim();}

export function parseContractListing(body,source){
  if(source.kind==='rss'){
    const dom=new JSDOM(String(body||''),{contentType:'text/xml'}),doc=dom.window.document,out=[];
    for(const item of doc.querySelectorAll('item')){
      const title=clean(item.querySelector('title')?.textContent),link=clean(item.querySelector('link')?.textContent),summary=clean(item.querySelector('description')?.textContent),publishedAt=clean(item.querySelector('pubDate')?.textContent);
      if(link&&approvedUrl(link,source)&&hasContractSignal(`${title} ${summary}`))out.push({title,url:link,summary,publishedAt});
    }
    dom.window.close();return dedupeArticles(out);
  }
  const dom=new JSDOM(String(body||'')),doc=dom.window.document,out=[];
  for(const anchor of doc.querySelectorAll('a[href]')){
    const url=absoluteUrl(anchor.getAttribute('href'),source.url);if(!url||!approvedUrl(url,source))continue;
    const title=clean(anchor.textContent),context=clean(anchor.closest('article,li,div')?.textContent||title).slice(0,1200);
    if(!title||!hasContractSignal(`${title} ${context}`))continue;
    const time=anchor.closest('article,li,div')?.querySelector('time');
    out.push({title,url,summary:context,publishedAt:time?.getAttribute('datetime')||clean(time?.textContent)});
  }
  dom.window.close();return dedupeArticles(out);
}
function dedupeArticles(rows){const seen=new Set();return rows.filter(row=>{if(seen.has(row.url))return false;seen.add(row.url);return true;});}

export function articleText(html){
  const dom=new JSDOM(String(html||'')),doc=dom.window.document;
  for(const node of doc.querySelectorAll('script,style,noscript,nav,footer,form'))node.remove();
  const root=doc.querySelector('article,main')||doc.body;const text=clean(root?.textContent);
  dom.window.close();return text;
}

export function exactFighterMatches(value,profiles){
  const haystack=` ${normalizeContractText(value)} `,matches=[];
  const grouped=new Map();
  for(const profile of profiles){const name=normalizeContractText(profile.fighter_name);if(!name||name.split(' ').length<2||name.length<6)continue;if(!grouped.has(name))grouped.set(name,[]);grouped.get(name).push(profile);}
  for(const [name,rows] of grouped){if(haystack.includes(` ${name} `))matches.push({name,profiles:rows,ambiguous:rows.length!==1});}
  return matches;
}

export function contractCandidateKey(sourceUrl,normalizedName,eventType){return createHash('sha256').update(`${sourceUrl}\n${normalizedName}\n${eventType}`).digest('hex');}

export function candidateRows(article,source,body,profiles){
  const combined=`${article.title}\n${article.summary||''}\n${body||''}`;if(!hasContractSignal(combined))return [];
  const signal=detectContractSignal(combined),matches=exactFighterMatches(combined,profiles),out=[];
  for(const match of matches){
    if(match.ambiguous){out.push({candidateKey:contractCandidateKey(article.url,match.name,signal.eventType),sourceUrl:article.url,sourceTitle:article.title,publisher:source.publisher,publishedAt:article.publishedAt||null,sourceType:source.sourceType,fighterName:match.profiles[0]?.fighter_name||match.name,normalizedName:match.name,sourceKey:null,sourceFighterId:null,promotionSlug:source.promotionSlug,detectedEventType:signal.eventType,detectedStatus:signal.status,detectedSummary:article.summary||article.title,reviewStatus:'needs_identity'});continue;}
    const profile=match.profiles[0];out.push({candidateKey:contractCandidateKey(article.url,match.name,signal.eventType),sourceUrl:article.url,sourceTitle:article.title,publisher:source.publisher,publishedAt:article.publishedAt||null,sourceType:source.sourceType,fighterName:profile.fighter_name,normalizedName:match.name,sourceKey:profile.source_key,sourceFighterId:profile.source_fighter_id,promotionSlug:source.promotionSlug,detectedEventType:signal.eventType,detectedStatus:signal.status,detectedSummary:article.summary||article.title,reviewStatus:'pending'});
  }
  return out;
}
