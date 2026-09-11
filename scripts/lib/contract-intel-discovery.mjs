import {createHash} from 'node:crypto';
import {JSDOM} from 'jsdom';

export const CONTRACT_DISCOVERY_SOURCES=[
  {slug:'ufc-news',publisher:'UFC',sourceType:'promotion_direct',promotionSlug:'ufc',kind:'html',url:'https://www.ufc.com/trending/all',host:'www.ufc.com',path:/\/news\//i},
  {slug:'pfl-news',publisher:'Professional Fighters League',sourceType:'promotion_direct',promotionSlug:'pfl',kind:'html',url:'https://pflmma.com/news/',host:'pflmma.com',path:/\/news\//i,
    seedArticles:[
      {title:'Middleweight Contender Bryan Battle Signs Exclusive, Multi-Year Contract With Professional Fighters League',url:'https://pflmma.com/news/middleweight-contender-bryan-battle-signs-exclusive-multiyear-contract-with-professional-fighters-league',publishedAt:'2025-09-05'},
      {title:'Professional Fighters League Signs Hottest Free Agent In All Of MMA, Paul Hughes, To Exclusive, Multi-Fight Contract',url:'https://pflmma.com/news/professional-fighters-league-signs-hottest-free-agent-in-all-of-mma-paul-hughes-to-exclusive-multifight-contract',publishedAt:'2024-04-21'},
      {title:'Cedric Doumbe Signs Exclusive, Multi-Year Contract Extension With Professional Fighters League',url:'https://pflmma.com/news/cedric-doumbe-signs-exclusive-multiyear-contract-extension-with-professional-fighters-league-will-fight-at-bellator-champions-series-paris-on-may-17',publishedAt:'2024-04-22'},
      {title:'Hattan Alsaif Makes History As First-Ever Woman From Saudi Arabia To Sign With Major Global MMA Promotion',url:'https://pflmma.com/news/hattan-alsaif-makes-history-as-firstever-woman-from-the-kingdom-of-saudi-arabia-to-sign-with-major-global-mma-promotion',publishedAt:'2024-01-30'},
      {title:'Professional Fighters League Signs Undefeated Murad Ramazanov To Exclusive, Multi-Fight Contract',url:'https://pflmma.com/news/professional-fighters-league-signs-undefeated-murad-ramazanov-to-exclusive-multifight-contract',publishedAt:'2024-01-10'},
      {title:'Professional Fighters League Signs Cedric Doumbe To Global Roster',url:'https://pflmma.com/news/professional-fighters-league-signs-cedric-doumbe-to-global-roster',publishedAt:'2023-05-10'},
      {title:'Professional Fighters League Partners With Jake Paul In Historic Exclusive Agreement In MMA',url:'https://pflmma.com/news/professional-fighters-league-partners-with-jake-paul-in-historic-exclusive-agreement-in-mma',publishedAt:'2023-01-05'},
      {title:'Professional Fighters League Expands Global Talent Roster With Middle Eastern MMA Fighters',url:'https://pflmma.com/news/professional-fighters-league-expands-global-talent-roster-with-middle-eastern-mma-fighters',publishedAt:'2022-06-22'}
    ]},
  {slug:'one-mma-rss',publisher:'ONE Championship',sourceType:'promotion_direct',promotionSlug:'one',kind:'rss',url:'https://www.onefc.com/category/mixed-martial-arts/feed/',host:'www.onefc.com',path:/\/(?:news|features)\//i,
    seedArticles:[
      {title:'Undefeated Heavyweight Dustin Joynson Signs With ONE Championship',url:'https://www.onefc.com/news/undefeated-heavyweight-dustin-joynson-signs-with-one-championship/',publishedAt:'2021-01-07'},
      {title:'5-Time MMA Champion Stephen Loman Joins ONE Championship',url:'https://www.onefc.com/news/5-time-mma-champion-stephen-loman-joins-one-championship/',publishedAt:'2021-02-11'},
      {title:'Mark Sangiao’s Son Jhanlo Signs With ONE Championship',url:'https://www.onefc.com/news/mark-sangiaos-son-jhanlo-signs-with-one-championship/',publishedAt:'2021-06-01'},
      {title:'Team Lakay’s Jeremy Pacatiw Signs With ONE Championship',url:'https://www.onefc.com/news/team-lakays-jeremy-pacatiw-signs-with-one-championship/',publishedAt:'2021-06-15'},
      {title:'Dagestani Sensation Saygid Izagakhmaev Signs With ONE Championship',url:'https://www.onefc.com/news/dagestani-sensation-saygid-izagakhmaev-signs-with-one-championship/',publishedAt:'2021-10-12'},
      {title:'Marcus Almeida Officially Signs With ONE Championship',url:'https://www.onefc.com/news/marcus-almeida-officially-signs-with-one-championship/',publishedAt:'2020-07-31'},
      {title:'India’s Kantharaj Shankar Agasa Signs With ONE Championship',url:'https://www.onefc.com/news/indias-kantharaj-shankar-agasa-signs-with-one-championship/',publishedAt:'2020-09-01'},
      {title:'Indian Wrestling Champion Ritu Phogat Joins ONE Championship',url:'https://www.onefc.com/news/indian-wrestling-champion-ritu-phogat-joins-one-championship/',publishedAt:'2019-02-26'},
      {title:'Undefeated MMA Star Willie Van Rooyen Joins ONE Championship, Draws Avazbek Kholmirzaev At ONE Fight Night 37',url:'https://www.onefc.com/news/undefeated-mma-star-willie-van-rooyen-joins-one-championship-draws-avazbek-kholmirzaev-at-one-fight-night-37/',publishedAt:'2025-10-15'}
    ]},
  {slug:'cage-warriors-news',publisher:'Cage Warriors',sourceType:'promotion_direct',promotionSlug:null,kind:'html',url:'https://cagewarriors.com/news/',host:'cagewarriors.com',path:/^\/(?!news\/?$|events\/?$|videos\/?$|champions\/?$|contact\/?$|about\/?$|athletes\/?$|careers\/?$)[a-z0-9-]+\/$/i,titleSignalOnly:true},
  {slug:'brave-cf-news',publisher:'BRAVE Combat Federation',sourceType:'promotion_direct',promotionSlug:null,kind:'html',url:'https://www.bravecf.com/news',host:'www.bravecf.com',path:/^\/news\/[a-z0-9-]+\/?$/i,
    seedArticles:[
      {title:'Amil Tutic Signs Exclusive Multi-Fight Deal with BRAVE CF',url:'https://www.bravecf.com/news/amil-tutic-signs-exclusive-multi-fight-deal-with-brave-cf',publishedAt:'2026-06-15'},
      {title:'Unbeaten Serbian Star Nikola Joksovic Signs Multi-Fight Deal With BRAVE Combat Federation',url:'https://www.bravecf.com/news/unbeaten-serbian-star-nikola-joksovic-signs-multi-fight-deal-with-brave-combat-federation',publishedAt:'2025-09-10'},
      {title:'Filipino superstar Drex Zamboanga signs multi-fight deal with BRAVE Combat Federation',url:'https://www.bravecf.com/news/filipino-superstar-drex-zamboanga-signs-multi-fight-deal-with-brave-combat-federation',publishedAt:'2025-02-26'},
      {title:'Indian Judo Champion Suchika Tariyal Signs Multi-Fight Deal with BRAVE CF',url:'https://www.bravecf.com/news/indian-judo-champion-suchika-tariyal-signs-multi-fight-deal-with-brave-cf',publishedAt:'2024-11-17'},
      {title:'Gerard Burns signs multi-fight deal with BRAVE CF following thunderous KO win',url:'https://www.bravecf.com/news/gerard-burns-signs-multi-fight-deal-with-brave-cf-following-thunderous-ko-win',publishedAt:'2024-02-05'},
      {title:'BRAVE CF signs undefeated Tajik superstar Khurshed Nazarov',url:'https://www.bravecf.com/news/brave-cf-signs-undefeated-tajik-superstar-khurshed-nazarov',publishedAt:'2024-01-27'},
      {title:'BRAVE Combat Federation signs Ramazan Gitinov',url:'https://www.bravecf.com/news/brave-combat-federation-signs-ramazan-gitinov-the-best-fighter-in-amateur-mma-history',publishedAt:'2023-05-11'}
    ]},
  {slug:'cffc-news',publisher:'Cage Fury Fighting Championships',sourceType:'promotion_direct',promotionSlug:null,kind:'html',url:'https://cffc.tv/news',host:'cffc.tv',path:/^\/news\/\d{4}\/\d{1,2}\/\d{1,2}\/[a-z0-9-]+\/?$/i,
    seedArticles:[
      {title:'CFFC flyweight champion Bilal Hasan remains undefeated, secures UFC deal',url:'https://cffc.tv/news/2026/8/11/cffc-flyweight-champion-bilal-hasan-remains-undefeated-secures-ufc-deal',publishedAt:'2026-08-11'}
    ]},
  {slug:'oktagon-news',publisher:'OKTAGON MMA',sourceType:'promotion_direct',promotionSlug:null,kind:'html',url:'https://oktagonmma.com/en/news/',host:'oktagonmma.com',path:/^\/en\/blog\/[a-z0-9-]+\/?$/i,
    seedArticles:[
      {title:'Liam Pitts earns an OKTAGON contract through AFN',url:'https://oktagonmma.com/en/fighters/liam-pitts/',publishedAt:null},
      {title:'Patrik Kincl signed a contract with OKTAGON MMA in 2021',url:'https://oktagonmma.com/en/blog/patrik-kincl-everything-you-ever-wanted-to-know/',publishedAt:'2023-10-26'}
    ]},
  {slug:'mma-fighting',publisher:'MMA Fighting',sourceType:'reputable_trade_reporting',promotionSlug:null,kind:'html',url:'https://www.mmafighting.com/',host:'www.mmafighting.com',path:/\/(?:ufc|pfl|one|mma-news|latest-news)\//i,contentSelector:'.duet--layout--entry-body',
    seedArticles:[
      {title:'Dana White confirms Michael ‘Venom’ Page’s tenure with the UFC is over',subjectFighterName:'Michael Page',promotionSlug:'ufc',url:'https://www.mmafighting.com/ufc/509329/dana-white-confirms-michael-venom-pages-tenure-with-the-ufc-is-over',publishedAt:'2026-09-09'},
      {title:'Roberto Soldic announces free agency after ONE Championship contract expires',subjectFighterName:'Roberto Soldic',promotionSlug:'one',url:'https://www.mmafighting.com/one/503724/roberto-soldic-announces-free-agency-after-one-championship-contract-expires',publishedAt:'2026-08-07'},
      {title:'Michel Pereira removed from UFC roster after loss to Shara Bullet in Baku',subjectFighterName:'Michel Pereira',promotionSlug:'ufc',url:'https://www.mmafighting.com/ufc/499434/michel-pereira-removed-from-ufc-roster-after-loss-to-shara-bullet-in-baku',publishedAt:'2026-07-14'},
      {title:'PFL releases Francis Ngannou',subjectFighterName:'Francis Ngannou',promotionSlug:'pfl',url:'https://www.mmafighting.com/pfl/475059/pfl-releases-francis-ngannou',publishedAt:'2026-03-06'},
      {title:'Former ONE champion Adriano Moraes enters free agency, confident ‘I can be part of the UFC roster’',subjectFighterName:'Adriano Moraes',promotionSlug:'one',url:'https://www.mmafighting.com/one/474625/former-one-champion-adriano-moraes-enters-free-agency-confident-i-can-be-part-of-the-ufc-roster',publishedAt:'2026-03-03'},
      {title:'Dana White responds to Usman Nurmagomedov free agency and UFC’s interest, decision coming ‘very soon’',subjectFighterName:'Usman Nurmagomedov',promotionSlug:'pfl',url:'https://www.mmafighting.com/ufc/502930/dana-white-responds-to-usman-nurmagomedov-free-agency-and-potentially-signing-him-to-ufc',publishedAt:'2026-08-02'}
    ]},
  {slug:'sherdog-news-rss',publisher:'Sherdog',sourceType:'reputable_trade_reporting',promotionSlug:null,kind:'rss',url:'https://www.sherdog.com/rss/news2.xml',host:'www.sherdog.com',path:/\/news\/news\//i,contentSelector:'.article .body_content'}
];

const SIGNAL_RE=/\b(?:sign(?:s|ed|ing)?|re[- ]?sign(?:s|ed|ing)?|new\s+(?:multi[- ]fight\s+)?deal|(?:secur(?:e|es|ed|ing)|earn(?:s|ed|ing)?|award(?:s|ed|ing)?)\s+(?:a\s+|an\s+)?(?:[a-z0-9-]+\s+){0,2}(?:contract|deal)|contract(?:s|ed)?|extension|renew(?:s|ed|al)?|renegotiat(?:e|ed|ion)|free\s+agent|free\s+agency|release(?:d|s)?|part(?:s|ed)?\s+ways|option\s+(?:exercised|declined)|remaining\s+fights?|last\s+fight\s+(?:on|under)\s+(?:his|her|the)?\s*(?:[a-z0-9-]+\s+){0,3}contract|(?:complet(?:e|es|ed|ing)|finish(?:es|ed|ing)?)\s+(?:his|her|the)?\s*(?:[a-z0-9]+\s+){0,2}(?:contract|deal))\b/i;
const NON_FIGHTER_RE=/\b(?:media rights|broadcast|streaming|sponsorship deal|partnership|venue deal|rights agreement)\b/i;
const PROMOTIONS=[
  ['ufc','(?:ultimate fighting championship|ufc)'],['pfl','(?:professional fighters league|pfl)'],['one','one championship'],['brave-cf','(?:brave combat federation|brave cf)'],['cffc','(?:cage fury fighting championships?|cage fury fc|cffc)'],['cage-warriors','cage warriors'],['oktagon','oktagon(?: mma)?'],['ksw','(?:konfrontacja sztuk walki|ksw)'],['rizin','rizin(?: fighting federation)?'],['lfa','(?:legacy fighting alliance|lfa)'],['fury-fc','(?:fury fighting championship|fury fc)'],['pancrase','pancrase'],['shooto','shooto'],['aca','(?:absolute championship akhmat|aca)'],['tuff-n-uff','tuff n uff'],['fnc','(?:fight nation championship|fnc)']
];

export function normalizeContractText(value){return String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[’']/g,"'").toLowerCase().replace(/[^a-z0-9' -]+/g,' ').replace(/[-]+/g,' ').replace(/\s+/g,' ').trim();}
function normalizeContractIdentityText(value){return normalizeContractText(value).replace(/\b([a-z0-9]+)'s\b/g,'$1');}
function semanticContractText(value){return normalizeContractText(value).replace(/\bfree agent\s+(?:fight|bout|match|matchup)\b/g,'');}
export function hasContractSignal(value){const text=semanticContractText(value);return SIGNAL_RE.test(text)&&!NON_FIGHTER_RE.test(text);}
export function detectContractSignal(value){
  const text=semanticContractText(value);
  if(/\b(?:complet(?:e|es|ed|ing)|finish(?:es|ed|ing)?)\s+(?:his|her|the)?\s*(?:[a-z0-9]+\s+){0,2}(?:contract|deal)\b|\bcontract\s+(?:has\s+)?(?:expired|ended)\b/.test(text))return {eventType:'expiration',status:'expired'};
  if(/\bdeclin(?:e|es|ed|ing)\s+to\s+re\s?sign\b|\bnot\s+re\s?sign(?:s|ed|ing)?\b/.test(text))return {eventType:'status_update',status:'unknown'};
  if(/\bfree\s+agent(?:cy)?\b/.test(text))return {eventType:'free_agency',status:'free_agent'};
  if(/\brelease(?:d|s)?\b|\bpart(?:s|ed)?\s+ways\b/.test(text))return {eventType:'release',status:'released'};
  if(/\boption\s+exercised\b/.test(text))return {eventType:'option_exercised',status:'under_contract'};
  if(/\boption\s+declined\b/.test(text))return {eventType:'option_declined',status:'unknown'};
  if(/\brenegotiat(?:e|ed|ion)\b/.test(text))return {eventType:'renegotiation',status:'under_contract'};
  if(/\bextension\b|\bre\s?sign(?:s|ed|ing)?\b/.test(text))return {eventType:'extension',status:'under_contract'};
  if(/\brenew(?:s|ed|al)?\b/.test(text))return {eventType:'renewal',status:'under_contract'};
  if(/\blast\s+fight\s+(?:on|under)\s+(?:his|her|the)?\s*(?:[a-z0-9-]+\s+){0,3}contract\b|\bremaining\s+fights?\b/.test(text))return {eventType:'status_update',status:'unknown'};
  if(/\bsign(?:s|ed|ing)?\b|\bnew\s+(?:multi\s+fight\s+)?deal\b|\b(?:secur(?:e|es|ed|ing)|earn(?:s|ed|ing)?|award(?:s|ed|ing)?)\s+(?:a\s+|an\s+)?(?:[a-z0-9-]+\s+){0,2}(?:contract|deal)\b|\bcontract(?:s|ed)?\b/.test(text))return {eventType:'signing',status:'under_contract'};
  return {eventType:'status_update',status:'unknown'};
}

export function detectContractSignals(value){
  const text=semanticContractText(value),primary=detectContractSignal(value),out=[primary];
  if(/\bfree\s+agent(?:cy)?\b/.test(text)&&primary.eventType!=='free_agency')out.push({eventType:'free_agency',status:'free_agent'});
  return out;
}

export function detectContractPromotion(value,fallback=null){
  const text=semanticContractText(value);
  for(const [slug,promotion] of PROMOTIONS){
    const patterns=[
      new RegExp(`\\b(?:sign(?:s|ed|ing)?|re\\s?sign(?:s|ed|ing)?|contract(?:s|ed)?)\\b.{0,160}\\b(?:with|to|by)\\s+(?:the\\s+)?${promotion}\\b`),
      new RegExp(`\\b(?:earn(?:s|ed|ing)?|secur(?:e|es|ed|ing)?|grant(?:s|ed|ing)?|award(?:s|ed|ing)?|hand(?:s|ed|ing)?)\\b.{0,100}\\b(?:a\\s+|an\\s+|the\\s+)?${promotion}\\s+(?:contract|deal)\\b`),
      new RegExp(`\\b${promotion}\\s+(?:contract|deal|extension|renewal|signing)\\b`),
      new RegExp(`\\b${promotion}\\s+(?:release(?:s|d)?|waive(?:s|d)?|cuts?)\\b`),
      new RegExp(`\\b(?:release(?:s|d)?|waive(?:s|d)?|part(?:s|ed)?\\s+ways)\\b.{0,120}\\b(?:by|from|with)\\s+(?:the\\s+)?${promotion}\\b`),
      new RegExp(`\\b(?:removed|depart(?:s|ed)?|exits?)\\b.{0,100}\\b(?:from|the)\\s+(?:the\\s+)?${promotion}\\s+(?:roster|promotion|organization)\\b`),
      new RegExp(`\\b(?:complet(?:e|es|ed|ing)|finish(?:es|ed|ing)?)\\b.{0,100}\\b(?:contract|deal)\\b.{0,80}\\b(?:with|under)\\s+(?:the\\s+)?${promotion}\\b`),
      new RegExp(`\\b(?:contract|deal|extension)\\b.{0,100}\\b(?:with|under)\\s+(?:the\\s+)?${promotion}\\b`)
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

function seedSubjectTitleText(value){
  const withoutQuotedNickname=String(value??'')
    .replace(/[“][^”]{1,40}[”]/g,' ')
    .replace(/[‘][^’]{1,40}[’]/g,' ')
    .replace(/"[^"]{1,40}"/g,' ');
  return normalizeContractIdentityText(withoutQuotedNickname);
}

function curatedSeedSubject(article,profiles){
  const subject=normalizeContractIdentityText(article?.subjectFighterName);
  if(!subject)return null;
  const title=` ${seedSubjectTitleText(article?.title)} `;
  if(!title.includes(` ${subject} `))return null;
  const rows=profiles.filter(profile=>normalizeContractIdentityText(profile.fighter_name)===subject);
  if(!rows.length)return null;
  return {name:subject,profiles:rows,ambiguous:rows.length!==1};
}

export function exactFighterMatches(value,profiles){
  const haystack=` ${normalizeContractIdentityText(value)} `,matches=[],grouped=new Map();
  for(const profile of profiles){const name=normalizeContractIdentityText(profile.fighter_name);if(!name||name.split(' ').length<2||name.length<6)continue;if(!grouped.has(name))grouped.set(name,[]);grouped.get(name).push(profile);}
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
  const bodyBlocks=String(body||'').split(/\n+/).map(clean).filter(Boolean).filter(hasContractSignal).map(text=>({text,scope:'body'}));
  const title=clean(article?.title),blocks=[...(title&&hasContractSignal(title)?[{text:title,scope:'title'}]:[]),...bodyBlocks];
  if(!blocks.length)return [];
  const out=[],seen=new Set();
  const seedSubject=curatedSeedSubject(article,profiles);
  for(const item of blocks){
    const block=item.text,signals=detectContractSignals(block),promotionSlug=detectContractPromotion(block,article?.promotionSlug||source.promotionSlug);
    const directMatches=exactFighterMatches(block,profiles),matches=directMatches.length?directMatches:(seedSubject?[seedSubject]:[]);
    for(const match of matches){
      if(incidentalMention(block,match.name))continue;
      for(const signal of signals){
        const key=contractCandidateKey(article.url,match.name,signal.eventType);if(seen.has(key))continue;seen.add(key);
        const base={candidateKey:key,sourceUrl:article.url,sourceTitle:article.title,publisher:source.publisher,publishedAt:article.publishedAt||null,sourceType:source.sourceType,fighterName:match.profiles[0]?.fighter_name||match.name,normalizedName:match.name,promotionSlug,detectedEventType:signal.eventType,detectedStatus:signal.status,detectedSummary:block.slice(0,1600),extractionMethod:directMatches.length?(item.scope==='title'?'signal_title_exact_subject_v5':'signal_block_scoped_subject_v4'):'seed_subject_scoped_v6'};
        if(match.ambiguous){out.push({...base,sourceKey:null,sourceFighterId:null,reviewStatus:'needs_identity'});continue;}
        const profile=match.profiles[0];out.push({...base,sourceKey:profile.source_key,sourceFighterId:profile.source_fighter_id,reviewStatus:'pending'});
      }
    }
  }
  return out;
}
