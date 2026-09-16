import {createHash} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {normalizeContractText,exactFighterMatches,articleText} from './contract-intel-discovery.mjs';

export {articleText};

// Sherdog and UFC.com are already proven reachable by this pipeline's real fetch() (contract/camp/
// anti-doping discovery). BJPenn.com (RSS 2.0) and MMA Mania (Atom, SB Nation/Vox Media) confirmed
// directly reachable and carrying frequent injury/withdrawal reporting -- e.g. live headlines seen at
// the time this was added: "Brian Ortega shows cut that forced him out of UFC 331", "Brian Ortega
// releases statement after withdrawing from UFC 331 fight", "Henry Cejudo faces new opponent for
// Misfits boxing debut after Deen The Great backs out", "Tom Aspinall's UFC return hits medical
// roadblock due to eye injury". Injury/withdrawal news is far more frequent than camp changes, so this
// starts with a wider source set than camp discovery did. MMA Fighting was also tried and dropped: it
// returns 200 to curl but a consistent 403 to this pipeline's actual Node fetch() (a TLS-fingerprint-
// level bot check, not a UA-string one), the same "looks fine under curl, blocked for real" trap
// documented in camp-intel-discovery.mjs.
export const INJURY_DISCOVERY_SOURCES=[
  {slug:'sherdog-injury-news',publisher:'Sherdog',sourceType:'reputable_trade_reporting',kind:'rss',url:'https://www.sherdog.com/rss/news2.xml',host:'www.sherdog.com',path:/\/news\/news\//i,contentSelector:'.article .body_content'},
  {slug:'ufc-news-injury',publisher:'UFC',sourceType:'promotion_direct',kind:'html',url:'https://www.ufc.com/trending/all',host:'www.ufc.com',path:/\/news\//i},
  {slug:'bjpenn-injury-news',publisher:'BJPenn.com',sourceType:'reputable_trade_reporting',kind:'rss',url:'https://www.bjpenn.com/feed/',host:'www.bjpenn.com',path:/\/mma-news\//i},
  {slug:'mmamania-injury-news',publisher:'MMA Mania',sourceType:'reputable_trade_reporting',kind:'rss',url:'https://www.mmamania.com/rss/index.xml',host:'www.mmamania.com',path:/^\/[a-z0-9-]+\/\d+\//i}
];

// Vocabulary verified against real, live reporting (Sherdog/MMA Fighting/BJPenn.com, September 2026):
// "Brian Ortega...forced him out of UFC 331", "withdrawing from UFC 331 fight", "Deen The Great backs
// out", "Deen The Great pulls out"; "Bogdan Guskov steps in on 12 days notice", "Joel Alvarez steps in
// on short notice for UFC 330 after Geoff Neal injury", "Bogdan Guskov replaces injured Khalil
// Rountree"; "cannot get medically cleared to fight right now" (Tom Aspinall); "Tom Aspinall's UFC
// return hits medical roadblock due to eye injury", "fresh injury". "Pulls out a win/victory" is a real,
// common MMA turn of phrase for a come-from-behind result, not a withdrawal, and is explicitly excluded.
const WITHDRAWAL_RE=/\b(?:pulls?|pulled)\s+out\b|\bbacks?\s+out\b|\bwithdr(?:aws?|awing|ew|awn)\b|\bforced\s+(?:him|her|them)?\s*out\b|\bpullout\b/i;
const CLEARED_RE=/\bmedically\s+cleared\b|\bcleared\s+to\s+(?:fight|compete|return)\b/i;
const NOT_CLEARED_RE=/\b(?:can(?:no|')?t|cannot|not|isn'?t|hasn'?t|won'?t)\b[^.]{0,25}\b(?:medically\s+cleared|cleared\s+to\s+(?:fight|compete|return))\b/i;
const REPLACEMENT_RE=/\bsteps?\s+in\b|\breplaces?\s+injured\b|\bshort[- ]notice\s+replacement\b|\breplacement\s+(?:announced|found)\b/i;
const INJURY_DISCLOSED_RE=/\binjury\s+(?:setback|update)\b|\bsuffered\s+(?:a|an)\s+[a-z\s]{0,20}injury\b|\bongoing\s+injury\b|\bfresh\s+injury\b|\bmedical\s+roadblock\b/i;
const NON_INJURY_RE=/\bpulls?\s+out\s+(?:a|the)\s+(?:win|victory|decision|draw|upset)\b/i;

export const SIGNAL_RE=new RegExp([WITHDRAWAL_RE.source,CLEARED_RE.source,REPLACEMENT_RE.source,INJURY_DISCLOSED_RE.source].join('|'),'i');

export function hasInjurySignal(value){
  const text=normalizeContractText(value);
  return SIGNAL_RE.test(text)&&!NON_INJURY_RE.test(text);
}

export function detectInjuryEventType(value){
  const text=normalizeContractText(value);
  if(NOT_CLEARED_RE.test(text))return 'injury_disclosed';
  if(CLEARED_RE.test(text))return 'cleared_to_compete';
  if(REPLACEMENT_RE.test(text))return 'replacement_announced';
  if(WITHDRAWAL_RE.test(text))return 'withdrawal';
  return 'injury_disclosed';
}

function absoluteUrl(href,base){try{return new URL(href,base).href}catch{return null;}}
function approvedUrl(url,source){try{const parsed=new URL(url);return parsed.protocol==='https:'&&parsed.hostname===source.host&&source.path.test(parsed.pathname);}catch{return false;}}
function clean(value){return String(value??'').replace(/\s+/g,' ').trim();}
function dedupeArticles(rows){const seen=new Set();return rows.filter(row=>{if(seen.has(row.url))return false;seen.add(row.url);return true;});}

export function parseInjuryListing(body,source){
  if(source.kind==='rss'){
    const dom=new JSDOM(String(body||''),{contentType:'text/xml'}),doc=dom.window.document,out=[];
    // RSS 2.0 (<item>) and Atom (<entry>) both appear across these sources -- see camp-intel-discovery.mjs
    // for the same dual-format handling, confirmed against MMA Fighting/MMA Mania's live Atom feeds.
    for(const item of doc.querySelectorAll('item,entry')){
      const isAtom=item.tagName.toLowerCase()==='entry';
      const title=clean(item.querySelector('title')?.textContent);
      const link=isAtom?clean(item.querySelector('link[rel="alternate"]')?.getAttribute('href')||item.querySelector('link')?.getAttribute('href')):clean(item.querySelector('link')?.textContent);
      const summary=clean(item.querySelector('summary')?.textContent||item.querySelector('description')?.textContent);
      const publishedAt=clean(item.querySelector('pubDate')?.textContent||item.querySelector('published')?.textContent);
      const signalText=source.titleSignalOnly?title:`${title} ${summary}`;
      if(link&&approvedUrl(link,source)&&hasInjurySignal(signalText))out.push({title,url:link,summary,publishedAt});
    }
    dom.window.close();return dedupeArticles(out);
  }
  const dom=new JSDOM(String(body||'')),doc=dom.window.document,out=[];
  for(const anchor of doc.querySelectorAll('a[href]')){
    const url=absoluteUrl(anchor.getAttribute('href'),source.url);if(!url||!approvedUrl(url,source))continue;
    const title=clean(anchor.textContent),container=anchor.closest('article,li,div'),context=clean(container?.textContent||title).slice(0,1200);
    const signalText=source.titleSignalOnly?title:`${title} ${context}`;
    if(!title||!hasInjurySignal(signalText))continue;
    const time=container?.querySelector('time');
    out.push({title,url,summary:context,publishedAt:time?.getAttribute('datetime')||clean(time?.textContent)});
  }
  dom.window.close();return dedupeArticles(out);
}

function incidentalInjuryMention(block,normalizedName){
  const text=normalizeContractText(block),name=String(normalizedName).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const patterns=[
    new RegExp(`\\b(?:unlike|compared|comparing)\\b[^.]{0,60}\\b${name}\\b`),
    new RegExp(`\\b(?:remind(?:s|ed)?(?:\\s+\\w+){0,5}\\s+of|similar\\s+to|like)\\s+(?:a\\s+young\\s+)?${name}\\b`),
    new RegExp(`\\b(?:take(?:s|n)?\\s+on|took\\s+on|face(?:s|d)?|facing|against|versus|vs|v)\\s+${name}\\b`)
  ];
  return patterns.some(pattern=>pattern.test(text));
}

export function injuryCandidateKey(sourceUrl,normalizedName,eventType){
  return createHash('sha256').update(`${sourceUrl}\n${normalizedName}\n${eventType}`).digest('hex');
}

export function injuryCandidateRows(article,source,body,profiles){
  const blocks=String(body||'').split(/\n+/).map(clean).filter(Boolean).filter(hasInjurySignal);
  if(!blocks.length)return [];
  const out=[],seen=new Set();
  for(const block of blocks){
    const eventType=detectInjuryEventType(block),matches=exactFighterMatches(block,profiles);
    for(const match of matches){
      if(incidentalInjuryMention(block,match.name))continue;
      const key=injuryCandidateKey(article.url,match.name,eventType);if(seen.has(key))continue;seen.add(key);
      const base={candidateKey:key,sourceUrl:article.url,sourceTitle:article.title,publisher:source.publisher,publishedAt:article.publishedAt||null,sourceType:source.sourceType,fighterName:match.profiles[0]?.fighter_name||match.name,normalizedName:match.name,detectedEventType:eventType,detectedSummary:block.slice(0,1600),extractionMethod:'signal_block_scoped_subject_v1'};
      if(match.ambiguous){out.push({...base,sourceKey:null,sourceFighterId:null,reviewStatus:'needs_identity'});continue;}
      const profile=match.profiles[0];
      out.push({...base,sourceKey:profile.source_key,sourceFighterId:profile.source_fighter_id,reviewStatus:'pending'});
    }
  }
  return out;
}
