import {createHash} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {normalizeContractText,exactFighterMatches,articleText} from './contract-intel-discovery.mjs';

export {articleText};

// Real MMA news sources already verified reachable by this pipeline's actual
// production fetch mechanism (see contract-intel-discovery.mjs's dry-run
// history) also carry camp/team-change reporting, not just contract news --
// confirmed directly on Sherdog: "UFC Featherweight Champ Amanda Nunes Parts
// Ways with American Top Team", "UFC Flyweight Contender Kyoji Horiguchi
// Moves to US, Joins American Top Team", "Former UFC Welterweight Champ
// Robbie Lawler Leaves American Top Team". Reusing a proven-reachable source
// avoids re-learning the ESPN Mexico lesson (a source that looks perfect
// under manual curl verification but is bot-walled for Node's real fetch()).
export const CAMP_DISCOVERY_SOURCES=[
  {slug:'sherdog-camp-news',publisher:'Sherdog',sourceType:'reputable_trade_reporting',kind:'rss',url:'https://www.sherdog.com/rss/news2.xml',host:'www.sherdog.com',path:/\/news\/news\//i,contentSelector:'.article .body_content'},
  {slug:'ufc-news-camp',publisher:'UFC',sourceType:'promotion_direct',kind:'html',url:'https://www.ufc.com/trending/all',host:'www.ufc.com',path:/\/news\//i}
];

// Verified, publicly documented real training camps (Wikipedia: "List of
// professional MMA training camps", cross-checked against official sites),
// same list seeded into the training_camps table by migration 0044. Common
// real abbreviations used in actual reporting (ATT, AKA) are included as
// alternation, matching the PROMOTIONS pattern in contract-intel-discovery.mjs.
const CAMPS=[
  ['american-top-team','(?:american top team|att)'],
  ['american-kickboxing-academy','(?:american kickboxing academy|aka)'],
  ['alliance-mma','alliance mma'],
  ['allstars-training-center','allstars training center'],
  ['amc-pankration','amc pankration'],
  ['brazilian-top-team','brazilian top team'],
  ['busan-team-mad','busan team m a d'],
  ['cesar-gracie-fight-team','cesar gracie fight team'],
  ['china-top-team','china top team'],
  ['chute-boxe-academy','chute boxe(?:\\s+academy)?'],
  ['city-kickboxing','city kickboxing'],
  ['elevation-fight-team','elevation fight team'],
  ['enbo-fight-club','enbo fight club'],
  ['evolve-mma','evolve mma'],
  ['factory-x','factory x'],
  ['fortis-mma','fortis mma'],
  ['fedor-team','fedor\\s*team'],
  ['fight-ready','fight ready'],
  ['jackson-wink-mma','jackson[- ]?wink(?:\\s+mma\\s+academy)?'],
  ['kill-cliff-fc','kill cliff fc'],
  ['kings-mma','kings mma'],
  ['korean-top-team','korean top team'],
  ['krazy-bee','krazy bee'],
  ['long-island-mma','long island mma'],
  ['london-shootfighters','london shootfighters'],
  ['minnesota-martial-arts-academy','minnesota martial arts academy'],
  ['mma-factory','mma factory'],
  ['mma-lab','mma lab'],
  ['nova-uniao','nova uniao'],
  ['onx-sports','onx sports'],
  ['phuket-top-team','phuket top team'],
  ['roufusport','roufusport'],
  ['sbg-ireland','sbg ireland'],
  ['serra-longo-fight-team','serra[- ]longo fight team'],
  ['syndicate-mma','syndicate mma'],
  ['team-alpha-male','team alpha male'],
  ['team-lloyd-irvin','team lloyd irvin'],
  ['team-renegade','team renegade'],
  ['teixeira-mma-fitness','teixeira mma(?:\\s+(?:and|&)\\s+fitness)?'],
  ['tiger-muay-thai','tiger muay thai'],
  ['tribe-tokyo-mma','tribe tokyo mma'],
  ['tristar-gym','tristar(?:\\s+gym)?'],
  ['xtreme-couture','xtreme couture']
];

const JOIN_RE=/\b(?:join(?:s|ed|ing)?|moves?\s+to|moving\s+to|announces?\s+move\s+to|signs?\s+with|trains?\s+(?:at|with)|training\s+(?:at|with))\b/i;
const LEAVE_RE=/\b(?:leaves?|left|departs?|departed|departure(?:s)?(?:\s+from)?|parts?\s+ways(?:\s+with)?)\b/i;
export const CAMP_SIGNAL_RE=new RegExp(`${JOIN_RE.source}|${LEAVE_RE.source}`,'i');

export function hasCampSignal(value){return CAMP_SIGNAL_RE.test(normalizeContractText(value));}

export function detectCampEventType(value){
  const text=normalizeContractText(value);
  if(LEAVE_RE.test(text))return 'left';
  if(JOIN_RE.test(text)){
    if(/\btrains?\s+(?:at|with)\b|\btraining\s+(?:at|with)\b/.test(text))return 'status_update';
    return 'joined';
  }
  return 'status_update';
}

export function detectCamp(value,fallback=null){
  const text=normalizeContractText(value);
  for(const [slug,pattern] of CAMPS){
    const patterns=[
      new RegExp(`\\b(?:${JOIN_RE.source})\\b.{0,60}?\\b${pattern}\\b`),
      new RegExp(`\\b(?:${LEAVE_RE.source})\\b.{0,60}?\\b${pattern}\\b`),
      new RegExp(`\\b${pattern}\\b.{0,60}?\\b(?:${JOIN_RE.source}|${LEAVE_RE.source})\\b`)
    ];
    if(patterns.some(pattern=>pattern.test(text)))return slug;
  }
  return fallback;
}

function absoluteUrl(href,base){try{return new URL(href,base).href}catch{return null;}}
function approvedUrl(url,source){try{const parsed=new URL(url);return parsed.protocol==='https:'&&parsed.hostname===source.host&&source.path.test(parsed.pathname);}catch{return false;}}
function clean(value){return String(value??'').replace(/\s+/g,' ').trim();}
function dedupeArticles(rows){const seen=new Set();return rows.filter(row=>{if(seen.has(row.url))return false;seen.add(row.url);return true;});}

export function parseCampListing(body,source){
  if(source.kind==='rss'){
    const dom=new JSDOM(String(body||''),{contentType:'text/xml'}),doc=dom.window.document,out=[];
    for(const item of doc.querySelectorAll('item')){
      const title=clean(item.querySelector('title')?.textContent),link=clean(item.querySelector('link')?.textContent),summary=clean(item.querySelector('description')?.textContent),publishedAt=clean(item.querySelector('pubDate')?.textContent);
      const signalText=source.titleSignalOnly?title:`${title} ${summary}`;
      if(link&&approvedUrl(link,source)&&hasCampSignal(signalText))out.push({title,url:link,summary,publishedAt});
    }
    dom.window.close();return dedupeArticles(out);
  }
  const dom=new JSDOM(String(body||'')),doc=dom.window.document,out=[];
  for(const anchor of doc.querySelectorAll('a[href]')){
    const url=absoluteUrl(anchor.getAttribute('href'),source.url);if(!url||!approvedUrl(url,source))continue;
    const title=clean(anchor.textContent),container=anchor.closest('article,li,div'),context=clean(container?.textContent||title).slice(0,1200);
    const signalText=source.titleSignalOnly?title:`${title} ${context}`;
    if(!title||!hasCampSignal(signalText))continue;
    const time=container?.querySelector('time');
    out.push({title,url,summary:context,publishedAt:time?.getAttribute('datetime')||clean(time?.textContent)});
  }
  dom.window.close();return dedupeArticles(out);
}

function incidentalCampMention(block,normalizedName){
  const text=normalizeContractText(block),name=String(normalizedName).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const patterns=[
    new RegExp(`\\b(?:compared|comparing)\\b[^.]{0,40}\\bto\\s+(?:a\\s+young\\s+)?${name}\\b`),
    new RegExp(`\\b(?:remind(?:s|ed)?(?:\\s+\\w+){0,5}\\s+of|memories\\s+of|similar\\s+to|like)\\s+(?:a\\s+young\\s+)?${name}\\b`),
    new RegExp(`\\b(?:take(?:s|n)?\\s+on|took\\s+on|face(?:s|d)?|facing|against|versus|vs|v)\\s+${name}\\b`)
  ];
  return patterns.some(pattern=>pattern.test(text));
}

export function campCandidateKey(sourceUrl,normalizedName,campSlug,eventType){
  return createHash('sha256').update(`${sourceUrl}\n${normalizedName}\n${campSlug}\n${eventType}`).digest('hex');
}

export function campCandidateRows(article,source,body,profiles){
  const blocks=String(body||'').split(/\n+/).map(clean).filter(Boolean).filter(hasCampSignal);
  if(!blocks.length)return [];
  const out=[],seen=new Set();
  for(const block of blocks){
    const campSlug=detectCamp(block);
    if(!campSlug)continue;
    const eventType=detectCampEventType(block),matches=exactFighterMatches(block,profiles);
    for(const match of matches){
      if(incidentalCampMention(block,match.name))continue;
      const key=campCandidateKey(article.url,match.name,campSlug,eventType);if(seen.has(key))continue;seen.add(key);
      const base={candidateKey:key,sourceUrl:article.url,sourceTitle:article.title,publisher:source.publisher,publishedAt:article.publishedAt||null,sourceType:source.sourceType,fighterName:match.profiles[0]?.fighter_name||match.name,normalizedName:match.name,campSlug,detectedEventType:eventType,detectedSummary:block.slice(0,1600),extractionMethod:'signal_block_scoped_subject_v1'};
      if(match.ambiguous){out.push({...base,sourceKey:null,sourceFighterId:null,reviewStatus:'needs_identity'});continue;}
      const profile=match.profiles[0];
      out.push({...base,sourceKey:profile.source_key,sourceFighterId:profile.source_fighter_id,reviewStatus:'pending'});
    }
  }
  return out;
}
