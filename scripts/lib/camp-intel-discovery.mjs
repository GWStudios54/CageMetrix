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
// BJPenn.com (RSS 2.0) and MMAMania.com (Atom, SB Nation/Vox Media) confirmed reachable by this
// pipeline's real fetch() and carrying real camp-change/coach reporting (e.g. BJPenn.com's live feed
// included "Ilia Topuria's coach shuts down imminent UFC comeback"). Widens the net beyond the
// original two sources, which mostly surface only Sherdog/UFC's own camp coverage. MMAFighting.com
// was also tried: it returns 200 to curl but a consistent 403 to this pipeline's actual Node fetch()
// (a TLS-fingerprint-level bot check, not a UA-string one -- confirmed by testing with the exact same
// UA in both), the same "looks fine under curl, blocked for real" trap the ESPN Mexico source hit
// during contract-intel discovery. Left out rather than shipped broken.
// Widened again: LowKickMMA.com, MiddleEasy.com and CagesidePress.com all confirmed reachable by this
// pipeline's real Node fetch() (not just curl) and carrying real, current MMA news (verified live:
// LowKickMMA's "Nate Diaz Drops Confidence Bomb on Conor McGregor Trilogy", CagesidePress's UFC 331
// fighter-camp coverage). MiddleEasy runs on Elementor, whose real post body lives under
// `.elementor-widget-theme-post-content` -- the generic article/entry-content fallback in
// articleText() lands on an unrelated related-posts teaser there instead, so it needs its own
// contentSelector the way Sherdog does. FightBookMMA.com was also tried: its /feed/ redirects to its
// own homepage under this pipeline's real fetch(redirect:'follow'), landing on homepage HTML instead
// of feed content -- the same "resolve differently under Node fetch than curl" trap MMAFighting.com
// and ESPN Mexico hit, so it's left out rather than shipped broken.
export const CAMP_DISCOVERY_SOURCES=[
  {slug:'sherdog-camp-news',publisher:'Sherdog',sourceType:'reputable_trade_reporting',kind:'rss',url:'https://www.sherdog.com/rss/news2.xml',host:'www.sherdog.com',path:/\/news\/news\//i,contentSelector:'.article .body_content'},
  {slug:'ufc-news-camp',publisher:'UFC',sourceType:'promotion_direct',kind:'html',url:'https://www.ufc.com/trending/all',host:'www.ufc.com',path:/\/news\//i},
  {slug:'bjpenn-camp-news',publisher:'BJPenn.com',sourceType:'reputable_trade_reporting',kind:'rss',url:'https://www.bjpenn.com/feed/',host:'www.bjpenn.com',path:/\/mma-news\//i},
  {slug:'mmamania-camp-news',publisher:'MMA Mania',sourceType:'reputable_trade_reporting',kind:'rss',url:'https://www.mmamania.com/rss/index.xml',host:'www.mmamania.com',path:/^\/[a-z0-9-]+\/\d+\//i},
  {slug:'lowkickmma-camp-news',publisher:'LowKickMMA',sourceType:'reputable_trade_reporting',kind:'rss',url:'https://www.lowkickmma.com/feed/',host:'www.lowkickmma.com',path:/^\/[a-z0-9-]+\/$/i},
  {slug:'middleeasy-camp-news',publisher:'MiddleEasy',sourceType:'reputable_trade_reporting',kind:'rss',url:'https://middleeasy.com/feed/',host:'middleeasy.com',path:/^\/[a-z0-9-]+\/[a-z0-9-]+\/$/i,contentSelector:'.elementor-widget-theme-post-content'},
  {slug:'cagesidepress-camp-news',publisher:'Cageside Press',sourceType:'reputable_trade_reporting',kind:'rss',url:'https://cagesidepress.com/feed/',host:'cagesidepress.com',path:/^\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+\/$/i}
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

// Widened against a real, verified example: ESPN's "Kamaru Usman changes camp ahead of title defense
// vs. Gilbert Burns" (Brett Okamoto, live, not retracted) -- body text "Usman ... has moved his camp
// to Denver, under head coach Trevor Wittman" has "camp" between "moved" and "to", which the old
// `moves?\s+to` alternative (adjacent words only, and only "move"/"moves", not "moved") did not match,
// and the headline's own "changes camp" phrasing carried no "to <camp>" clause at all, so a title-only
// listing check would have rejected this exact real story outright.
// `mov(?:es?|ed|ing)\s+(?:(?:his|her|their)\s+)?(?:camp\s+)?to` and `changes?\s+camp|camp\s+change`
// close both gaps.
const JOIN_RE=/\b(?:join(?:s|ed|ing)?|mov(?:es?|ed|ing)\s+(?:(?:his|her|their)\s+)?(?:camp\s+)?to|announces?\s+move\s+to|signs?\s+with|trains?\s+(?:at|with)|training\s+(?:at|with)|changes?\s+camp|camp\s+change)\b/i;
const LEAVE_RE=/\b(?:leaves?|left|departs?|departed|departure(?:s)?(?:\s+from)?|parts?\s+ways(?:\s+with)?)\b/i;
export const CAMP_SIGNAL_RE=new RegExp(`${JOIN_RE.source}|${LEAVE_RE.source}`,'i');

export function hasCampSignal(value){return CAMP_SIGNAL_RE.test(normalizeContractText(value));}

export function detectCampEventType(value){
  const text=normalizeContractText(value);
  if(LEAVE_RE.test(text))return 'left';
  if(JOIN_RE.test(text)){
    // "changes camp" alone doesn't say which direction (unlike "moved to <camp>"), so it's treated the
    // same conservative way as "trains at/with": a status update for a human to resolve, not an
    // assumed join.
    if(/\btrains?\s+(?:at|with)\b|\btraining\s+(?:at|with)\b|\bchanges?\s+camp\b|\bcamp\s+change\b/.test(text))return 'status_update';
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
    // RSS 2.0 (<item>/<link> text/<description>/<pubDate>) and Atom (<entry>/<link href>/<summary>/<published>)
    // both appear across real MMA feeds -- MMAFighting.com and MMAMania.com (SB Nation/Vox Media) publish
    // Atom, confirmed directly against their live feeds, while Sherdog and BJPenn.com publish RSS 2.0.
    for(const item of doc.querySelectorAll('item,entry')){
      const isAtom=item.tagName.toLowerCase()==='entry';
      const title=clean(item.querySelector('title')?.textContent);
      const link=isAtom?clean(item.querySelector('link[rel="alternate"]')?.getAttribute('href')||item.querySelector('link')?.getAttribute('href')):clean(item.querySelector('link')?.textContent);
      const summary=clean(item.querySelector('summary')?.textContent||item.querySelector('description')?.textContent);
      const publishedAt=clean(item.querySelector('pubDate')?.textContent||item.querySelector('published')?.textContent);
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
