import {createHash} from 'node:crypto';
import {JSDOM} from 'jsdom';

export const CONTRACT_DISCOVERY_SOURCES=[
  {slug:'ufc-news',publisher:'UFC',sourceType:'promotion_direct',promotionSlug:'ufc',kind:'html',url:'https://www.ufc.com/trending/all',host:'www.ufc.com',path:/\/news\//i},
  {slug:'pfl-news',publisher:'Professional Fighters League',sourceType:'promotion_direct',promotionSlug:'pfl',kind:'html',url:'https://pflmma.com/news/',host:'pflmma.com',path:/\/news\//i},
  {slug:'one-mma-rss',publisher:'ONE Championship',sourceType:'promotion_direct',promotionSlug:'one',kind:'rss',url:'https://www.onefc.com/category/mixed-martial-arts/feed/',host:'www.onefc.com',path:/\/(?:news|features)\//i},
  {slug:'cage-warriors-news',publisher:'Cage Warriors',sourceType:'promotion_direct',promotionSlug:null,kind:'html',url:'https://cagewarriors.com/news/',host:'cagewarriors.com',path:/^\/(?!news\/?$|events\/?$|videos\/?$|champions\/?$|contact\/?$|about\/?$|athletes\/?$|careers\/?$)[a-z0-9-]+\/$/i,titleSignalOnly:true},
  {slug:'mma-fighting',publisher:'MMA Fighting',sourceType:'reputable_trade_reporting',promotionSlug:null,kind:'html',url:'https://www.mmafighting.com/',host:'www.mmafighting.com',path:/\/(?:ufc|pfl|mma-news|latest-news)\//i},
  {slug:'sherdog-news-rss',publisher:'Sherdog',sourceType:'reputable_trade_reporting',promotionSlug:null,kind:'rss',url:'https://www.sherdog.com/rss/news2.xml',host:'www.sherdog.com',path:/\/news\/news\//i,contentSelector:'.article .body_content'}
];

const SIGNAL_RE=/\b(?:sign(?:s|ed|ing)?|re[- ]?sign(?:s|ed|ing)?|new\s+(?:multi[- ]fight\s+)?deal|contract(?:s|ed)?|extension|renew(?:s|ed|al)?|renegotiat(?:e|ed|ion)|free\s+agent|free\s+agency|release(?:d|s)?|part(?:s|ed)?\s+ways|option\s+(?:exercised|declined)|remaining\s+fights?|last\s+fight\s+(?:on|under)\s+(?:his|her|the)?\s*contract|complet(?:e|es|ed|ing)\s+(?:his|her|the)?\s*(?:[a-z0-9]+\s+){0,2}contract)\b/i;
const NON_FIGHTER_RE=/\b(?:media rights|broadcast|streaming|sponsorship deal|partnership|venue deal|rights agreement)\b/i;
const PROMOTIONS=[
  ['ufc','(?:ultimate fighting championship|ufc)'],['pfl','(?:professional fighters league|pfl)'],['one','one championship'],['cage-warriors','cage warriors'],['oktagon','oktagon(?: mma)?'],['ksw','(?:konfrontacja sztuk walki|ksw)'],['rizin','rizin(?: fighting federation)?'],['lfa','(?:legacy fighting alliance|lfa)'],['cage-fury','(?:cage fury fighting championships?|cffc)'],['fury-fc','(?:fury fighting championship|fury fc)'],['pancrase','pancrase'],['shooto','shooto'],['aca','(?:absolute championship akhmat|aca)'],['tuff-n-uff','tuff n uff'],['fnc','(?:fight nation championship|fnc)']
];

export function normalizeContractText(value){return String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[’']/g,"'").toLowerCase().replace(/[^a-z0-9' -]+/g,' ').replace(/[-]+/g,' ').replace(/\s+/g,' ').trim();}
function semanticContractText(value){return normalizeContractText(value).replace(/\bfree agent\s+(?:fight|bout|match|matchup)\b/g,'');}
export function hasContractSignal(value){const text=semanticContractText(value);return SIGNAL_RE.test(text)&&!NON_FIGHTER_RE.test(text);}
export function detectContractSignal(value){
  const text=semanticContractText(value);
  if(/\bcomplet(?:e|es|ed|ing)\s+(?:his|her|the)?\s*(?:[a-z0-9]+\s+){0,2}contract\b|\bcontract\s+(?:has\s+)?(?:expired|ended)\b/.test(text))return {eventType:'expiration',status:'expired'};
  if(/\bdeclin(?:e|es|ed|ing)\s+to\s+re\s?sign\b|\bnot\s+re\s?sign(?:s|ed|ing)?\b/.test(text))return {eventType:'status_update',status:'unknown'};
  if(/\bfree\s+agent(?:cy)?\b/.test(text))return {eventType:'free_agency',status:'free_agent'};
  if(/\brelease(?:d|s)?\b|\bpart(?:s|ed)?\s+ways\b/.test(text))return {eventType:'release',status:'released'};
  if(/\boption\s+exercised\b/.test(text))return {eventType:'option_exercised',status:'under_contract'};
  if(/\boption\s+declined\b/.test(text))return {eventType:'option_declined',status:'unknown'};
  if(/\brenegotiat(?:e|ed|ion)\b/.test(text))return {eventType:'renegotiation',status:'under_contract'};
  if(/\bextension\b|\bre\s?sign(?:s|ed|ing)?\b/.test(text))return {eventType:'extension',status:'under_contract'};
  if(/\brenew(?:s|ed|al)?\b/.test(text))return {eventType:'renewal',status:'under_contract'};
  if(/\blast\s+fight\s+(?:on|under)\b|\bremaining\s+fights?\b/.test(text))return {eventType:'status_update',status:'unknown'};
  if(/\bsign(?:s|ed|ing)?\b|\bnew\s+(?:multi\s+fight\s+)?deal\b|\bcontract(?:s|ed)?\b/.test(text))return {eventType:'signing',status:'under_contract'};
  return {eventType:'status_update',status:'unknown'};
}

export function detectContractPromotion(value,fallback=null){
  const text=semanticContractText(value);
  for(const [slug,promotion] of PROMOTIONS){
    const patterns=[
      new RegExp(`\\b(?:sign(?:s|ed|ing)?|re\\s?sign(?:s|ed|ing)?|contract(?:s|ed)?)\\b.{0,160}\\b(?:with|to|by)\\s+(?:the\\s+)?${promotion}\\b`),
      new RegExp(`\\b(?:earn(?:s|ed|ing)?|secur(?:e|es|ed|ing)?|grant(?:s|ed|ing)?|award(?:s|ed|ing)?|hand(?:s|ed|ing)?)\\b.{0,100}\\b(?:a\\s+|an\\s+|the\\s+)?${promotion}\\s+(?:contract|deal)\\b`),
      new RegExp(`\\b${promotion}\\s+(?:contract|deal|extension|renewal|signing)\\b`)
    ];
    if(patterns.some(pattern=>pattern.test(text)))return slug;
  }
  return fallback||null;
}

function absoluteUrl(href,base){try{return new URL(href,base).href}catch{return null;}}
function approvedUrl(url,source){try{const parsed=new URL(url);return parsed.protocol==='https:'&&parsed.hostname===source.host&&source.path.test(parsed.pathname);}catch{return false;}}
function clean(value){return String(value??'').replace(/\s+/g,' ').trim();}
function escapeRe(value){return String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}

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
    const title=clean(anchor.textContent),container=anchor.closest('article,li,div'),context=clean(container?.textContent||title).slice(0,1200);
    const signalText=source.titleSignalOnly?title:`${title} ${context}`;
    if(!title||!hasContractSignal(signalText))continue;
    const time=container?.querySelector('time');out.push({title,url,summary:context,publishedAt:time?.getAttribute('datetime')||clean(time?.textContent)});
  }
  dom.window.close();return dedupeArticles(out);
}
function dedupeArticles(rows){const seen=new Set();return rows.filter(row=>{if(seen.has(row.url))return false;seen.add(row.url);return true;});}

export function articleText(html,source={}){
  const dom=new JSDOM(String(html||'')),doc=dom.window.document;
  for(const node of doc.querySelectorAll('script,style,noscript,nav,footer,form,aside,[role="complementary"],.related_articles,.latest_articles,.latest_features,.tools_list,.pagination,.right-tabs-content,[class*="recommend"],[class*="outbrain"]'))node.remove();
  const root=(source.contentSelector?doc.querySelector(source.contentSelector):null)||doc.querySelector('article .body_content,article .article-content,article .entry-content,article,main')||doc.body;
  const blocks=[];const seen=new Set();
  for(const node of root?.querySelectorAll('h2,h3,p,li')||[]){const value=clean(node.textContent);if(value.length<12||seen.has(value))continue;seen.add(value);blocks.push(value);}
  if(!blocks.length){const fallback=clean(root?.textContent);if(fallback)blocks.push(fallback);}
  dom.window.close();return blocks.join('\n');
}

export function exactFighterMatches(value,profiles){
  const haystack=` ${normalizeContractText(value)} `,matches=[],grouped=new Map();
  for(const profile of profiles){const name=normalizeContractText(profile.fighter_name);if(!name||name.split(' ').length<2||name.length<6)continue;if(!grouped.has(name))grouped.set(name,[]);grouped.get(name).push(profile);}
  for(const [name,rows] of grouped){if(haystack.includes(` ${name} `))matches.push({name,profiles:rows,ambiguous:rows.length!==1});}
  return matches;
}

function incidentalMention(block,normalizedName){
  const text=normalizeContractText(block),name=escapeRe(normalizedName);
  const patterns=[
    new RegExp(`\\b(?:compared|comparing)\\b[^.]{0,40}\\bto\\s+(?:a\\s+young\\s+)?${name}\\b`),
    new RegExp(`\\b(?:remind(?:s|ed)?(?:\\s+\\w+){0,5}\\s+of|memories\\s+of|similar\\s+to|like)\\s+(?:a\\s+young\\s+)?${name}\\b`),
    new RegExp(`\\b(?:take(?:s|n)?\\s+on|took\\s+on|face(?:s|d)?|facing|against|versus|vs|v|defeats?|def|credits?|thanks?|praises?|calls?\\s+out)\\s+${name}\\b`),
    new RegExp(`\\b${name}\\s+(?:vs|versus|v|against|proposes?\\s+(?:a\\s+)?free\\s+agent\\s+(?:fight|bout|match|matchup))\\b`)
  ];
  return patterns.some(pattern=>pattern.test(text));
}

export function contractCandidateKey(sourceUrl,normalizedName,eventType){return createHash('sha256').update(`${sourceUrl}\n${normalizedName}\n${eventType}`).digest('hex');}

export function candidateRows(article,source,body,profiles){
  const blocks=String(body||'').split(/\n+/).map(clean).filter(Boolean).filter(hasContractSignal);if(!blocks.length)return [];
  const out=[],seen=new Set();
  for(const block of blocks){
    const signal=detectContractSignal(block),promotionSlug=detectContractPromotion(block,source.promotionSlug),matches=exactFighterMatches(block,profiles);
    for(const match of matches){
      if(incidentalMention(block,match.name))continue;
      const key=contractCandidateKey(article.url,match.name,signal.eventType);if(seen.has(key))continue;seen.add(key);
      const base={candidateKey:key,sourceUrl:article.url,sourceTitle:article.title,publisher:source.publisher,publishedAt:article.publishedAt||null,sourceType:source.sourceType,fighterName:match.profiles[0]?.fighter_name||match.name,normalizedName:match.name,promotionSlug,detectedEventType:signal.eventType,detectedStatus:signal.status,detectedSummary:block.slice(0,1600),extractionMethod:'signal_block_subject_v3'};
      if(match.ambiguous){out.push({...base,sourceKey:null,sourceFighterId:null,reviewStatus:'needs_identity'});continue;}
      const profile=match.profiles[0];out.push({...base,sourceKey:profile.source_key,sourceFighterId:profile.source_fighter_id,reviewStatus:'pending'});
    }
  }
  return out;
}
