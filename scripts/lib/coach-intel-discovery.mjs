import {createHash} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {normalizeContractText,exactFighterMatches,articleText} from './contract-intel-discovery.mjs';

export {articleText};

// Same sources already proven reachable by this pipeline's real fetch() for camp/injury discovery.
// MMA Fighting was tried for those categories and dropped (200 to curl, consistent 403 to this
// pipeline's real Node fetch() -- a TLS-fingerprint-level bot check), so it is not included here either.
// Widened again: LowKickMMA.com, MiddleEasy.com and CagesidePress.com all confirmed reachable by this
// pipeline's real Node fetch() (not just curl) and carrying real, current MMA news. MiddleEasy runs
// on Elementor, whose real post body lives under `.elementor-widget-theme-post-content` -- the
// generic article/entry-content fallback in articleText() lands on an unrelated related-posts teaser
// there instead, so it needs its own contentSelector the way Sherdog does. FightBookMMA.com was also
// tried: its /feed/ redirects to its own homepage under this pipeline's real fetch(redirect:'follow'),
// landing on homepage HTML instead of feed content -- the same "resolve differently under Node fetch
// than curl" trap MMAFighting.com hit, so it's left out rather than shipped broken.
export const COACH_DISCOVERY_SOURCES=[
  {slug:'sherdog-coach-news',publisher:'Sherdog',sourceType:'reputable_trade_reporting',kind:'rss',url:'https://www.sherdog.com/rss/news2.xml',host:'www.sherdog.com',path:/\/news\/news\//i,contentSelector:'.article .body_content'},
  {slug:'ufc-news-coach',publisher:'UFC',sourceType:'promotion_direct',kind:'html',url:'https://www.ufc.com/trending/all',host:'www.ufc.com',path:/\/news\//i},
  {slug:'bjpenn-coach-news',publisher:'BJPenn.com',sourceType:'reputable_trade_reporting',kind:'rss',url:'https://www.bjpenn.com/feed/',host:'www.bjpenn.com',path:/\/mma-news\//i},
  {slug:'mmamania-coach-news',publisher:'MMA Mania',sourceType:'reputable_trade_reporting',kind:'rss',url:'https://www.mmamania.com/rss/index.xml',host:'www.mmamania.com',path:/^\/[a-z0-9-]+\/\d+\//i},
  {slug:'lowkickmma-coach-news',publisher:'LowKickMMA',sourceType:'reputable_trade_reporting',kind:'rss',url:'https://www.lowkickmma.com/feed/',host:'www.lowkickmma.com',path:/^\/[a-z0-9-]+\/$/i},
  {slug:'middleeasy-coach-news',publisher:'MiddleEasy',sourceType:'reputable_trade_reporting',kind:'rss',url:'https://middleeasy.com/feed/',host:'middleeasy.com',path:/^\/[a-z0-9-]+\/[a-z0-9-]+\/$/i,contentSelector:'.elementor-widget-theme-post-content'},
  {slug:'cagesidepress-coach-news',publisher:'Cageside Press',sourceType:'reputable_trade_reporting',kind:'rss',url:'https://cagesidepress.com/feed/',host:'cagesidepress.com',path:/^\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+\/$/i}
];

// Vocabulary verified against real reporting: "UFC news, rumors: Henry Cejudo parts with longtime
// coach" (CBS Sports) and its body text, "The former two-division champion handed longtime coach Eric
// Albarracin his walking papers"; "Ilia Topuria splits from coaches in shock move ahead of UFC 317
// title fight" (Yahoo Sports/AOL). Coach changes are reported far less often than contract/injury news
// and coach names aren't a fixed vocabulary the way camps are (arbitrary people, not ~40 known gyms),
// so detected_coach_name below is a best-effort proximity extraction for a human to confirm or correct,
// not a validated match -- same shape as injury discovery's opponent_name field. Kept deliberately
// narrower than camp/injury's signal list rather than guessing at unconfirmed phrasings (e.g. no
// "hires"/"brings in" pattern -- no real example of that exact phrasing was found for MMA coaching;
// when one is confirmed real, it belongs here, not before).
const PARTED_RE=/\bparts?\s+(?:ways\s+)?with\s+(?:(?:his|her|their)\s+)?(?:longtime\s+)?coach(?:es)?\b|\bsplits?\s+from\s+(?:(?:his|her|their)\s+)?(?:longtime\s+)?coach(?:es)?\b|\bhand(?:s|ed)\s+(?:his|her|their)?\s*(?:longtime\s+)?coach\b.{0,30}\bwalking\s+papers\b/i;
const HIRED_RE=/\bnew\s+head\s+coach\b/i;

export const COACH_SIGNAL_RE=new RegExp(`${PARTED_RE.source}|${HIRED_RE.source}`,'i');

export function hasCoachSignal(value){return COACH_SIGNAL_RE.test(normalizeContractText(value));}

export function detectCoachEventType(value){
  const text=normalizeContractText(value);
  if(PARTED_RE.test(text))return 'parted_ways';
  if(HIRED_RE.test(text))return 'hired';
  return 'parted_ways';
}

// Best-effort: capture a capitalized name immediately following the word "coach" (e.g. "longtime coach
// Eric Albarracin"). Returns null rather than guessing when no such name is present -- the review page
// lets a human fill in or correct the coach name before publishing either way.
export function detectCoachName(value){
  const match=String(value||'').match(/\bcoach(?:es)?\s+((?:[A-Z][a-zA-Z'.-]+\s*){1,3})/);
  if(!match)return null;
  const name=match[1].trim().replace(/\s+(?:his|her|their|and|is|was|to|for)$/i,'');
  return name||null;
}

function absoluteUrl(href,base){try{return new URL(href,base).href}catch{return null;}}
function approvedUrl(url,source){try{const parsed=new URL(url);return parsed.protocol==='https:'&&parsed.hostname===source.host&&source.path.test(parsed.pathname);}catch{return false;}}
function clean(value){return String(value??'').replace(/\s+/g,' ').trim();}
function dedupeArticles(rows){const seen=new Set();return rows.filter(row=>{if(seen.has(row.url))return false;seen.add(row.url);return true;});}

export function parseCoachListing(body,source){
  if(source.kind==='rss'){
    const dom=new JSDOM(String(body||''),{contentType:'text/xml'}),doc=dom.window.document,out=[];
    for(const item of doc.querySelectorAll('item,entry')){
      const isAtom=item.tagName.toLowerCase()==='entry';
      const title=clean(item.querySelector('title')?.textContent);
      const link=isAtom?clean(item.querySelector('link[rel="alternate"]')?.getAttribute('href')||item.querySelector('link')?.getAttribute('href')):clean(item.querySelector('link')?.textContent);
      const summary=clean(item.querySelector('summary')?.textContent||item.querySelector('description')?.textContent);
      const publishedAt=clean(item.querySelector('pubDate')?.textContent||item.querySelector('published')?.textContent);
      const signalText=source.titleSignalOnly?title:`${title} ${summary}`;
      if(link&&approvedUrl(link,source)&&hasCoachSignal(signalText))out.push({title,url:link,summary,publishedAt});
    }
    dom.window.close();return dedupeArticles(out);
  }
  const dom=new JSDOM(String(body||'')),doc=dom.window.document,out=[];
  for(const anchor of doc.querySelectorAll('a[href]')){
    const url=absoluteUrl(anchor.getAttribute('href'),source.url);if(!url||!approvedUrl(url,source))continue;
    const title=clean(anchor.textContent),container=anchor.closest('article,li,div'),context=clean(container?.textContent||title).slice(0,1200);
    const signalText=source.titleSignalOnly?title:`${title} ${context}`;
    if(!title||!hasCoachSignal(signalText))continue;
    const time=container?.querySelector('time');
    out.push({title,url,summary:context,publishedAt:time?.getAttribute('datetime')||clean(time?.textContent)});
  }
  dom.window.close();return dedupeArticles(out);
}

function incidentalCoachMention(block,normalizedName){
  const text=normalizeContractText(block),name=String(normalizedName).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const patterns=[
    new RegExp(`\\b(?:unlike|compared|comparing)\\b[^.]{0,60}\\b${name}\\b`),
    new RegExp(`\\b(?:remind(?:s|ed)?(?:\\s+\\w+){0,5}\\s+of|similar\\s+to|like)\\s+(?:a\\s+young\\s+)?${name}\\b`),
    new RegExp(`\\b(?:take(?:s|n)?\\s+on|took\\s+on|face(?:s|d)?|facing|against|versus|vs|v)\\s+${name}\\b`)
  ];
  return patterns.some(pattern=>pattern.test(text));
}

export function coachCandidateKey(sourceUrl,normalizedName,eventType){
  return createHash('sha256').update(`${sourceUrl}\n${normalizedName}\n${eventType}`).digest('hex');
}

export function coachCandidateRows(article,source,body,profiles){
  const blocks=String(body||'').split(/\n+/).map(clean).filter(Boolean).filter(hasCoachSignal);
  if(!blocks.length)return [];
  const out=[],seen=new Set();
  for(const block of blocks){
    const eventType=detectCoachEventType(block),coachName=detectCoachName(block),matches=exactFighterMatches(block,profiles);
    for(const match of matches){
      if(incidentalCoachMention(block,match.name))continue;
      const key=coachCandidateKey(article.url,match.name,eventType);if(seen.has(key))continue;seen.add(key);
      const base={candidateKey:key,sourceUrl:article.url,sourceTitle:article.title,publisher:source.publisher,publishedAt:article.publishedAt||null,sourceType:source.sourceType,fighterName:match.profiles[0]?.fighter_name||match.name,normalizedName:match.name,detectedCoachName:coachName,detectedEventType:eventType,detectedSummary:block.slice(0,1600),extractionMethod:'signal_block_scoped_subject_v1'};
      if(match.ambiguous){out.push({...base,sourceKey:null,sourceFighterId:null,reviewStatus:'needs_identity'});continue;}
      const profile=match.profiles[0];
      out.push({...base,sourceKey:profile.source_key,sourceFighterId:profile.source_fighter_id,reviewStatus:'pending'});
    }
  }
  return out;
}
