import {createHash} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {normalizeContractText,exactFighterMatches,articleText} from './contract-intel-discovery.mjs';

export {articleText};

// ufcantidoping.com/news is the UFC's own current anti-doping program site
// (it replaced USADA as the program administrator); its "News" listing links
// directly to official UFC.com statement pages ("Statement On Mohammed
// Usman", "Conor McGregor Accepts 18-Month Sanction..."), confirmed real via
// direct fetch. Sherdog is reused as a second source since it already covers
// these stories independently (confirmed: "UFC Heavyweight Suspended Until
// 2028 After Failed Drug Test") and is already proven reachable by this
// pipeline's real fetch() from the contract/camp-intel work.
// Widened to match the same reputable-trade-reporting bar already used for camp/coach/injury
// discovery: LowKickMMA.com, MiddleEasy.com and CagesidePress.com all confirmed reachable by this
// pipeline's real Node fetch() (not just curl) and carrying real, current MMA news. MiddleEasy runs
// on Elementor, whose real post body lives under `.elementor-widget-theme-post-content` -- the
// generic article/entry-content fallback in articleText() lands on an unrelated related-posts teaser
// there instead, so it needs its own contentSelector the way Sherdog does. FightBookMMA.com was also
// tried: its /feed/ redirects to its own homepage under this pipeline's real fetch(redirect:'follow'),
// landing on homepage HTML instead of feed content -- the same "resolve differently under Node fetch
// than curl" trap MMAFighting.com hit, so it's left out rather than shipped broken.
export const ANTIDOPING_DISCOVERY_SOURCES=[
  {slug:'ufcantidoping-news',publisher:'UFC Anti-Doping Program',sourceType:'promotion_direct',kind:'html',url:'https://ufcantidoping.com/news',host:'www.ufc.com',path:/^\/news\/[a-z0-9-]+$/i,titleSignalOnly:true},
  {slug:'sherdog-antidoping-news',publisher:'Sherdog',sourceType:'reputable_trade_reporting',kind:'rss',url:'https://www.sherdog.com/rss/news2.xml',host:'www.sherdog.com',path:/\/news\/news\//i,contentSelector:'.article .body_content'},
  {slug:'lowkickmma-antidoping-news',publisher:'LowKickMMA',sourceType:'reputable_trade_reporting',kind:'rss',url:'https://www.lowkickmma.com/feed/',host:'www.lowkickmma.com',path:/^\/[a-z0-9-]+\/$/i},
  {slug:'middleeasy-antidoping-news',publisher:'MiddleEasy',sourceType:'reputable_trade_reporting',kind:'rss',url:'https://middleeasy.com/feed/',host:'middleeasy.com',path:/^\/[a-z0-9-]+\/[a-z0-9-]+\/$/i,contentSelector:'.elementor-widget-theme-post-content'},
  {slug:'cagesidepress-antidoping-news',publisher:'Cageside Press',sourceType:'reputable_trade_reporting',kind:'rss',url:'https://cagesidepress.com/feed/',host:'cagesidepress.com',path:/^\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+\/$/i}
];

// Vocabulary verified against real reporting: Ben Rothwell/Tom Lawlor/Carlos
// Diego Ferreira/Nick Diaz all "flagged for a potential anti-doping
// violation" and provisionally suspended; Mohammed Usman/Iasmin Lucindo/
// Levi Rodrigues/Aliaskhab Idiris all "tested positive for" a named
// substance; Usman "accepted a 2-year and 6-month period of ineligibility"
// and Conor McGregor "accepts 18-month sanction" (both real UFC.com
// statement titles); Cristiane "Cyborg" Justino was real-world "cleared of
// a potential policy violation"; McGregor was real-world "officially
// cleared for UFC return after completing" his suspension.
const FLAGGED_RE=/\bflagged\s+for\s+(?:a\s+)?potential\b|\bprovisional(?:ly)?\s+suspen(?:ded|sion)\b/i;
const POSITIVE_RE=/\btest(?:ed|ing)\s+positive\s+for\b/i;
const SUSPENDED_RE=/\baccept(?:s|ed)\s+(?:a\s+)?(?:\d+[-\s]?(?:month|year)\b[^.]{0,30}?)?(?:period\s+of\s+ineligibility|sanction)\b|\bsuspended\s+(?:for|until)\b/i;
const CLEARED_RE=/\bcleared\s+(?:[a-z0-9']+\s+){0,6}?of\s+(?:a\s+)?(?:potential\s+)?(?:policy\s+)?violation\b|\bofficially\s+cleared\s+for\s+(?:ufc\s+)?return\b/i;
const REINSTATED_RE=/\bcompleted\s+(?:his|her|their)?\s*(?:\d+[-\s]?month\s+)?(?:suspension|ban)\b/i;

export const SIGNAL_RE=new RegExp([FLAGGED_RE.source,POSITIVE_RE.source,SUSPENDED_RE.source,CLEARED_RE.source,REINSTATED_RE.source].join('|'),'i');
const NON_FIGHTER_RE=/\b(?:supplement\s+(?:policy|guidance)|sponsorship|broadcast)\b/i;

export function hasAntidopingSignal(value){
  const text=normalizeContractText(value);
  return SIGNAL_RE.test(text)&&!NON_FIGHTER_RE.test(text);
}

export function detectAntidopingEventType(value){
  const text=normalizeContractText(value);
  if(CLEARED_RE.test(text))return 'cleared';
  if(REINSTATED_RE.test(text))return 'reinstated';
  if(FLAGGED_RE.test(text))return 'flagged';
  if(POSITIVE_RE.test(text))return 'positive_test';
  if(SUSPENDED_RE.test(text))return 'suspended';
  return 'status_update';
}

function absoluteUrl(href,base){try{return new URL(href,base).href}catch{return null;}}
function approvedUrl(url,source){try{const parsed=new URL(url);return parsed.protocol==='https:'&&parsed.hostname===source.host&&source.path.test(parsed.pathname);}catch{return false;}}
function clean(value){return String(value??'').replace(/\s+/g,' ').trim();}
function dedupeArticles(rows){const seen=new Set();return rows.filter(row=>{if(seen.has(row.url))return false;seen.add(row.url);return true;});}

export function parseAntidopingListing(body,source){
  if(source.kind==='rss'){
    const cleaned=String(body||'').replace(/^\s+/,'').replace(/<media:[a-z]+(?:\s[^>]*)?\/>/gi,'').replace(/<media:([a-z]+)(?:\s[^>]*)?>[\s\S]*?<\/media:\1>/gi,'');
    const dom=new JSDOM(cleaned,{contentType:'text/xml'}),doc=dom.window.document,out=[];
    for(const item of doc.querySelectorAll('item')){
      const title=clean(item.querySelector('title')?.textContent),link=clean(item.querySelector('link')?.textContent),summary=clean(item.querySelector('description')?.textContent),publishedAt=clean(item.querySelector('pubDate')?.textContent);
      const signalText=source.titleSignalOnly?title:`${title} ${summary}`;
      if(link&&approvedUrl(link,source)&&hasAntidopingSignal(signalText))out.push({title,url:link,summary,publishedAt});
    }
    dom.window.close();return dedupeArticles(out);
  }
  const dom=new JSDOM(String(body||'')),doc=dom.window.document,out=[];
  for(const anchor of doc.querySelectorAll('a[href]')){
    const url=absoluteUrl(anchor.getAttribute('href'),source.url);if(!url||!approvedUrl(url,source))continue;
    const title=clean(anchor.textContent),container=anchor.closest('article,li,div'),context=clean(container?.textContent||title).slice(0,1200);
    const signalText=source.titleSignalOnly?title:`${title} ${context}`;
    if(!title||!hasAntidopingSignal(signalText))continue;
    const time=container?.querySelector('time');
    out.push({title,url,summary:context,publishedAt:time?.getAttribute('datetime')||clean(time?.textContent)});
  }
  dom.window.close();return dedupeArticles(out);
}

function incidentalAntidopingMention(block,normalizedName){
  const text=normalizeContractText(block),name=String(normalizedName).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const patterns=[
    new RegExp(`\\b(?:unlike|compared|comparing)\\b[^.]{0,60}\\b${name}\\b`),
    new RegExp(`\\b(?:remind(?:s|ed)?(?:\\s+\\w+){0,5}\\s+of|similar\\s+to|like)\\s+(?:a\\s+young\\s+)?${name}\\b`),
    new RegExp(`\\b(?:take(?:s|n)?\\s+on|took\\s+on|face(?:s|d)?|facing|against|versus|vs|v)\\s+${name}\\b`)
  ];
  return patterns.some(pattern=>pattern.test(text));
}

export function antidopingCandidateKey(sourceUrl,normalizedName,eventType){
  return createHash('sha256').update(`${sourceUrl}\n${normalizedName}\n${eventType}`).digest('hex');
}

export function antidopingCandidateRows(article,source,body,profiles){
  const blocks=String(body||'').split(/\n+/).map(clean).filter(Boolean).filter(hasAntidopingSignal);
  if(!blocks.length)return [];
  const out=[],seen=new Set();
  for(const block of blocks){
    const eventType=detectAntidopingEventType(block),matches=exactFighterMatches(block,profiles);
    for(const match of matches){
      if(incidentalAntidopingMention(block,match.name))continue;
      const key=antidopingCandidateKey(article.url,match.name,eventType);if(seen.has(key))continue;seen.add(key);
      const base={candidateKey:key,sourceUrl:article.url,sourceTitle:article.title,publisher:source.publisher,publishedAt:article.publishedAt||null,sourceType:source.sourceType,fighterName:match.profiles[0]?.fighter_name||match.name,normalizedName:match.name,detectedEventType:eventType,detectedSummary:block.slice(0,1600),extractionMethod:'signal_block_scoped_subject_v1'};
      if(match.ambiguous){out.push({...base,sourceKey:null,sourceFighterId:null,reviewStatus:'needs_identity'});continue;}
      const profile=match.profiles[0];
      out.push({...base,sourceKey:profile.source_key,sourceFighterId:profile.source_fighter_id,reviewStatus:'pending'});
    }
  }
  return out;
}
