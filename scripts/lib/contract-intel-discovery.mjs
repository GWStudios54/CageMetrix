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
  {slug:'one-mma-rss',publisher:'ONE Championship',sourceType:'promotion_direct',promotionSlug:'one',kind:'rss',url:'https://www.onefc.com/category/mixed-martial-arts/feed/',host:'www.onefc.com',path:/\/(?:news|features)\//i},
  {slug:'cage-warriors-news',publisher:'Cage Warriors',sourceType:'promotion_direct',promotionSlug:null,kind:'html',url:'https://cagewarriors.com/news/',host:'cagewarriors.com',path:/^\/(?!news\/?$|events\/?$|videos\/?$|champions\/?$|contact\/?$|about\/?$|athletes\/?$|careers\/?$)[a-z0-9-]+\/$/i,titleSignalOnly:true},
  {slug:'lfa-news',publisher:'Legacy Fighting Alliance',sourceType:'promotion_direct',promotionSlug:'lfa',kind:'html',url:'https://www.lfa.com/news',host:'www.lfa.com',path:/^\/(?!news\/?$|events\/?$|champions\/?$|watch-lfa\/?$|lfafightnetwork\/?$|media\/?$|contact\/?$)[a-z0-9-]+\/$/i,titleSignalOnly:true},
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
  // MMA Fighting was here (kind:'html', https://www.mmafighting.com/) but is no longer: a dry run
  // during the camp/coach/injury/anti-doping source-widening work confirmed its homepage now returns
  // a consistent 403 to this pipeline's real Node fetch() (both /rss/current and / itself) -- the same
  // TLS-fingerprint-level bot check documented in the other discovery libs, not a UA-string one.
  // Removed rather than left in the list silently failing every run.
  {slug:'sherdog-news-rss',publisher:'Sherdog',sourceType:'reputable_trade_reporting',promotionSlug:null,kind:'rss',url:'https://www.sherdog.com/rss/news2.xml',host:'www.sherdog.com',path:/\/news\/news\//i,contentSelector:'.article .body_content'},
  {slug:'lowkickmma-contract-news',publisher:'LowKickMMA',sourceType:'reputable_trade_reporting',promotionSlug:null,kind:'rss',url:'https://www.lowkickmma.com/feed/',host:'www.lowkickmma.com',path:/^\/[a-z0-9-]+\/$/i},
  {slug:'middleeasy-contract-news',publisher:'MiddleEasy',sourceType:'reputable_trade_reporting',promotionSlug:null,kind:'rss',url:'https://middleeasy.com/feed/',host:'middleeasy.com',path:/^\/[a-z0-9-]+\/[a-z0-9-]+\/$/i,contentSelector:'.elementor-widget-theme-post-content'},
  {slug:'cagesidepress-contract-news',publisher:'Cageside Press',sourceType:'reputable_trade_reporting',promotionSlug:null,kind:'rss',url:'https://cagesidepress.com/feed/',host:'cagesidepress.com',path:/^\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+\/$/i},
  {slug:'tuff-n-uff-rss',publisher:'Tuff-N-Uff',sourceType:'promotion_direct',promotionSlug:'tuff-n-uff',kind:'rss',url:'https://tuffnuff.com/feed/',host:'tuffnuff.com',path:/^\/\d{4}\/\d{1,2}\/\d{1,2}\/[a-z0-9-]+\/?$/i},
  {slug:'inthecage-pl-rss',publisher:'InTheCage.pl',sourceType:'reputable_trade_reporting',promotionSlug:null,kind:'rss',url:'https://inthecage.pl/feed/',host:'inthecage.pl',path:/^\/[a-z0-9-]+\/$/i,lang:'pl'},
  {slug:'valetudo-ru-rss',publisher:'Valetudo.Ru',sourceType:'reputable_trade_reporting',promotionSlug:null,kind:'rss',url:'https://valetudo.ru/mma/news?format=feed&type=rss',host:'valetudo.ru',path:/^\/mma\/news\/[a-z0-9-]+$/i,lang:'ru'},
  {slug:'khan-sports-mma',publisher:'Sports Kyunghyang',sourceType:'reputable_trade_reporting',promotionSlug:null,kind:'html',url:'https://sports.khan.co.kr/sports-all/mma/',host:'sports.khan.co.kr',path:/^\/article\/\d+$/i,lang:'ko',titleSignalOnly:true},
  {slug:'mmaplanet-jp-rss',publisher:'MMAPLANET',sourceType:'reputable_trade_reporting',promotionSlug:null,kind:'rss',url:'https://mmaplanet.jp/feed',host:'mmaplanet.jp',path:/^\/\d+$/i,lang:'ja'},
  {slug:'agfight-rss',publisher:'Ag. Fight',sourceType:'reputable_trade_reporting',promotionSlug:null,kind:'rss',url:'https://agfight.com/feed/',host:'agfight.com',path:/^\/[a-z0-9-]+\/[a-z0-9-]+\/?$/i,lang:'pt'},
  {slug:'agdeportes-rss',publisher:'AG Deportes',sourceType:'reputable_trade_reporting',promotionSlug:null,kind:'rss',url:'https://agdeportes.com/feed/',host:'agdeportes.com',path:/^\/[a-z0-9-]+\/?$/i,lang:'es',titleSignalOnly:true},
  {slug:'ufc-fr-rss',publisher:'UFC Fans',sourceType:'reputable_trade_reporting',promotionSlug:null,kind:'rss',url:'https://www.ufc-fr.com/feed',host:'www.ufc-fr.com',path:/^\/[a-z0-9-]+-\d+\.html$/i,lang:'fr'}
];

const SIGNAL_RE=/\b(?:sign(?:s|ed|ing)?|re[- ]?sign(?:s|ed|ing)?|new\s+(?:multi[- ]fight\s+)?deal|(?:secur(?:e|es|ed|ing)|earn(?:s|ed|ing)?|award(?:s|ed|ing)?)\s+(?:a\s+|an\s+)?(?:[a-z0-9-]+\s+){0,2}(?:contract|deal)|contract(?:s|ed)?|extension|renew(?:s|ed|al)?|renegotiat(?:e|ed|ion)|free\s+agent|free\s+agency|release(?:d|s)?|part(?:s|ed)?\s+ways|option\s+(?:exercised|declined)|remaining\s+fights?|last\s+fight\s+(?:on|under)\s+(?:his|her|the)?\s*contract|complet(?:e|es|ed|ing)\s+(?:his|her|the)?\s*(?:[a-z0-9]+\s+){0,2}contract)\b/i;
const NON_FIGHTER_RE=/\b(?:media rights|broadcast|streaming|sponsorship deal|partnership|venue deal|rights agreement)\b/i;
const PROMOTIONS=[
  ['ufc','(?:ultimate fighting championship|ufc)'],['pfl','(?:professional fighters league|pfl)'],['one','one championship'],['brave-cf','(?:brave combat federation|brave cf)'],['cffc','(?:cage fury fighting championships?|cage fury fc|cffc)'],['cage-warriors','cage warriors'],['oktagon','oktagon(?: mma)?'],['ksw','(?:konfrontacja sztuk walki|ksw)'],['rizin','rizin(?: fighting federation)?'],['lfa','(?:legacy fighting alliance|lfa)'],['fury-fc','(?:fury fighting championship|fury fc)'],['pancrase','pancrase'],['shooto','shooto'],['aca','(?:absolute championship akhmat|aca)'],['tuff-n-uff','tuff n uff'],['fnc','(?:fight nation championship|fnc)']
];

const LATIN_COMPAT=new Map(Object.entries({'ł':'l','ø':'o','đ':'d','ð':'d','þ':'th','æ':'ae','œ':'oe','ß':'ss','ħ':'h','ı':'i'}));
function foldLatinCompatibility(value){return String(value??'').replace(/[łøđðþæœßħı]/gi,ch=>LATIN_COMPAT.get(ch.toLowerCase())||ch);}

const CYRILLIC_LATIN=new Map(Object.entries({
  'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i','й':'i',
  'к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u',
  'ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya'
}));
function transliterateCyrillic(value){return String(value??'').replace(/[\u0400-\u04ff]/g,ch=>{const lower=ch.toLowerCase();return CYRILLIC_LATIN.has(lower)?CYRILLIC_LATIN.get(lower):ch;});}

const HANGUL_INITIALS=['g','kk','n','d','tt','r','m','b','pp','s','ss','','j','jj','ch','k','t','p','h'];
const HANGUL_MEDIALS=['a','ae','ya','yae','eo','e','yeo','ye','o','wa','wae','oe','yo','u','wo','we','wi','yu','eu','ui','i'];
const HANGUL_FINALS=['','k','k','k','n','n','n','t','l','k','m','l','l','l','p','l','m','p','p','t','t','ng','t','t','k','t','p','t'];
function transliterateHangul(value){return String(value??'').replace(/[\uac00-\ud7a3]/g,ch=>{const code=ch.codePointAt(0)-0xac00,final=code%28,medial=((code-final)/28)%21,initial=(((code-final)/28)-medial)/21;return HANGUL_INITIALS[initial]+HANGUL_MEDIALS[medial]+HANGUL_FINALS[final];});}

// Korean fighter names are catalogued in the Sherdog-sourced database in Western given-name-first order
// with idiosyncratic (non-Revised-Romanization) spelling chosen by the fighter/promotion, e.g. Sherdog lists
// 정찬성 as "Chan Sung Jung", not the algorithmic RR form "Jeong Chan-seong". Generic transliteration
// cannot recover that, so identity for these known fighters is resolved via this verified curated alias
// table (Sherdog/Wikipedia-confirmed spellings) rather than the algorithmic transliteration used for
// everything else in the text. This is a starting set, not exhaustive.
const KOREAN_FIGHTER_ALIASES=new Map(Object.entries({
  '정찬성':'Chan Sung Jung',
  '김동현':'Dong Hyun Kim',
  '강경호':'Kyung Ho Kang',
  '최두호':'Doo Ho Choi',
  '최승우':'Seung Woo Choi',
  '박준용':'Jun Yong Park'
}));
function substituteKoreanFighterAliases(value){let text=String(value??'');for(const [hangul,latin] of KOREAN_FIGHTER_ALIASES)text=text.split(hangul).join(` ${latin} `);return text;}

// Japanese fighter names have no algorithmic transliteration at all (unlike Hangul, kanji readings are
// ambiguous without a reading dictionary), so identity for known fighters is resolved the same way as
// Korean -- a small verified curated alias table (Sherdog-confirmed spellings), applied as a substitution
// pass. This is a starting set, not exhaustive.
const JAPANESE_FIGHTER_ALIASES=new Map(Object.entries({
  '堀口恭司':'Kyoji Horiguchi',
  '朝倉海':'Kai Asakura',
  '平良達郎':'Tatsuro Taira',
  '朝倉未来':'Mikuru Asakura',
  '那須川天心':'Tenshin Nasukawa',
  '扇久保博正':'Hiromasa Ougikubo'
}));
function substituteJapaneseFighterAliases(value){let text=String(value??'');for(const [kanji,latin] of JAPANESE_FIGHTER_ALIASES)text=text.split(kanji).join(` ${latin} `);return text;}

export function normalizeContractText(value){return transliterateHangul(transliterateCyrillic(foldLatinCompatibility(substituteKoreanFighterAliases(substituteJapaneseFighterAliases(String(value??'')))))).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[’']/g,"'").toLowerCase().replace(/[^a-z0-9' -]+/g,' ').replace(/[-]+/g,' ').replace(/\s+/g,' ').trim();}
function semanticContractText(value){return normalizeContractText(value).replace(/\bfree agent\s+(?:fight|bout|match|matchup)\b/g,'');}
const SIGNAL_RE_PL=/\b(?:podpisa(?:l|la|li|no)\s+(?:nowy\s+)?kontrakt|podpisuj[ei]\s+kontrakt|przedluz(?:yl|yla|yli|enie)\s+kontrakt|na\s+dluzej\s+z|wolny?m?\s*agent(?:em|ka|ki)?|rozsta(?:l|la|li)\s+sie\s+z|bez\s+kontraktu|kontrakt\s+wygas(?:l|a)|zwolnion(?:y|a|ych|ego)|koncz(?:y|a)\s+kontrakt)\b/i;
const NON_FIGHTER_RE_PL=/\b(?:prawa\s+medialne|transmisj[ae]|sponsoring|umowa\s+o\s+wspolprac[ye])\b/i;

const SIGNAL_RE_RU=/\b(?:podpisa(?:l|la|li)\s+(?:novyi\s+)?kontrakt|podpisyva(?:et|yut)\s+kontrakt|zaklyuchi(?:l|la|li)\s+kontrakt|prodli(?:l|la|li)\s+kontrakt|svobodn(?:yi|ym|aya|ogo|omu)\s+agent(?:a|om|u)?|ne\s+prodli(?:l|la|li)\s+kontrakt|zakonchi(?:lsya|las)\s+kontrakt|uvolneni[ey]\s+iz|ukhod\s+iz|rasst(?:alsya|alas)\s+s\s|otkaza(?:lsya|las)\s+ot\s+kontrakta)\b/i;
const NON_FIGHTER_RE_RU=/\b(?:mediaprava|translyatsi[iy]|sponsorstv[oa])\b/i;

const SIGNAL_RE_KO=/\b(?:gyeyak\s*chegyeol|jaegyeyak|jayugyeyak|gyeyak\s+yeonjang\s+geobu|bangchul|gyeyakhaeji)/i;
const NON_FIGHTER_RE_KO=/\b(?:seuponseosip|junggyegwon|bangsong)\b/i;

// Kanji cannot be transliterated algorithmically at all (no jamo-style decomposition exists; readings are
// ambiguous without a dictionary), so unlike every other language here, Japanese vocabulary is matched
// directly against the original kanji/katakana text rather than a transliterated/normalized form -- see
// the lang==='ja' branches in hasContractSignal/detectContractSignal/detectContractPromotion below, which
// intentionally skip semanticContractText for this language.
const SIGNAL_RE_JA=/(?:契約.{0,3}更新|契約.{0,3}満了|契約解除|移籍|契約)/;
// キロ契約/契約体重 ("N kg contract weight") is how Japanese fight-card results describe an agreed
// catchweight bout -- a completely different, very common sense of 契約 that has nothing to do with a
// fighter's promotional contract. Found by testing against the real live MMAPLANET feed, not guessed.
const NON_FIGHTER_RE_JA=/(?:放送権|スポンサー契約|中継|キロ契約|契約体重)/;

const SIGNAL_RE_PT=/\b(?:assin(?:ou|a|aram)\s+.{0,20}?contrato|contratad[oa]s?\s+pel[oa]|renov(?:ou|a|aram)\s+(?:o\s+)?contrato|renovacao\s+de\s+contrato|dispensad[oa]s?\s+pel[oa]|dispensa|demitid[oa]s?\s+(?:pel[oa]|do)|liberad[oa]s?\s+pel[oa]|encerr(?:ou|a|aram)\s+(?:o\s+)?contratos?|contratos?\s+encerrados?|fim\s+de\s+contrato|sem\s+contrato|free\s+agent)\b/i;
const NON_FIGHTER_RE_PT=/\b(?:direitos?\s+de\s+transmissao|patrocinio|parceria)\b/i;

const SIGNAL_RE_ES=/\b(?:contrat\w*|despid[eo]|despedid[oa]s?|agente\s+libre|abandona)\b/i;
const NON_FIGHTER_RE_ES=/\b(?:derechos\s+de\s+transmision|patrocinio|acuerdo\s+de\s+transmision)\b/i;

const SIGNAL_RE_FR=/\b(?:signe\w*|prolonge\w*|libere\w*\s+de\s+son\s+contrat|agent\s+libre|contrat\w*)\b/i;
const NON_FIGHTER_RE_FR=/\b(?:droits?\s+(?:tv|de\s+diffusion)|ses\s+droits|partenariat|sponsoring)\b/i;

export function hasContractSignal(value,lang='en'){
  if(lang==='ja'){const raw=clean(value);return SIGNAL_RE_JA.test(raw)&&!NON_FIGHTER_RE_JA.test(raw);}
  const text=semanticContractText(value);
  const signal=lang==='pl'?SIGNAL_RE_PL:lang==='ru'?SIGNAL_RE_RU:lang==='ko'?SIGNAL_RE_KO:lang==='pt'?SIGNAL_RE_PT:lang==='es'?SIGNAL_RE_ES:lang==='fr'?SIGNAL_RE_FR:SIGNAL_RE;
  const nonFighter=lang==='pl'?NON_FIGHTER_RE_PL:lang==='ru'?NON_FIGHTER_RE_RU:lang==='ko'?NON_FIGHTER_RE_KO:lang==='pt'?NON_FIGHTER_RE_PT:lang==='es'?NON_FIGHTER_RE_ES:lang==='fr'?NON_FIGHTER_RE_FR:NON_FIGHTER_RE;
  return signal.test(text)&&!nonFighter.test(text);
}
export function detectContractSignal(value,lang='en'){
  if(lang==='ja'){
    const raw=clean(value);
    if(/契約.{0,3}満了|契約を更新せず/.test(raw))return {eventType:'expiration',status:'expired'};
    if(/契約解除/.test(raw))return {eventType:'release',status:'released'};
    if(/移籍/.test(raw))return {eventType:'status_update',status:'unknown'};
    if(/契約.{0,3}更新/.test(raw))return {eventType:'extension',status:'under_contract'};
    if(/契約/.test(raw))return {eventType:'signing',status:'under_contract'};
    return {eventType:'status_update',status:'unknown'};
  }
  const text=semanticContractText(value);
  if(lang==='pl'){
    if(/\bbez\s+kontraktu\b|\bkontrakt\s+wygas(?:l|a)\b|\bkoncz(?:y|a)\s+kontrakt\b/.test(text))return {eventType:'expiration',status:'expired'};
    if(/\bwolny?m?\s*agent(?:em|ka|ki)?\b/.test(text))return {eventType:'free_agency',status:'free_agent'};
    if(/\brozsta(?:l|la|li)\s+sie\s+z\b|\bzwolnion(?:y|a|ych|ego)\b/.test(text))return {eventType:'release',status:'released'};
    if(/\bprzedluz(?:yl|yla|yli|enie)\s+kontrakt\b|\bna\s+dluzej\s+z\b/.test(text))return {eventType:'extension',status:'under_contract'};
    if(/\bpodpisa(?:l|la|li|no)\s+(?:nowy\s+)?kontrakt\b|\bpodpisuj[ei]\s+kontrakt\b/.test(text))return {eventType:'signing',status:'under_contract'};
    return {eventType:'status_update',status:'unknown'};
  }
  if(lang==='ru'){
    if(/\bne\s+prodli(?:l|la|li)\s+kontrakt\b|\bzakonchi(?:lsya|las)\s+kontrakt\b/.test(text))return {eventType:'expiration',status:'expired'};
    if(/\bsvobodn(?:yi|ym|aya|ogo|omu)\s+agent(?:a|om|u)?\b/.test(text))return {eventType:'free_agency',status:'free_agent'};
    if(/\brasst(?:alsya|alas)\s+s\b|\buvolneni[ey]\s+iz\b|\bukhod\s+iz\b/.test(text))return {eventType:'release',status:'released'};
    if(/\botkaza(?:lsya|las)\s+ot\s+kontrakta\b/.test(text))return {eventType:'option_declined',status:'unknown'};
    if(/\bprodli(?:l|la|li)\s+kontrakt\b/.test(text))return {eventType:'extension',status:'under_contract'};
    if(/\bpodpisa(?:l|la|li)\s+(?:novyi\s+)?kontrakt\b|\bpodpisyva(?:et|yut)\s+kontrakt\b|\bzaklyuchi(?:l|la|li)\s+kontrakt\b/.test(text))return {eventType:'signing',status:'under_contract'};
    return {eventType:'status_update',status:'unknown'};
  }
  if(lang==='ko'){
    if(/\bgyeyakhaeji/.test(text))return {eventType:'expiration',status:'expired'};
    if(/\bjayugyeyak/.test(text))return {eventType:'free_agency',status:'free_agent'};
    if(/\bbangchul/.test(text))return {eventType:'release',status:'released'};
    if(/\bgyeyak\s+yeonjang\s+geobu/.test(text))return {eventType:'status_update',status:'unknown'};
    if(/\bjaegyeyak/.test(text))return {eventType:'extension',status:'under_contract'};
    if(/\bgyeyak\s*chegyeol/.test(text))return {eventType:'signing',status:'under_contract'};
    return {eventType:'status_update',status:'unknown'};
  }
  if(lang==='pt'){
    if(/\bsem\s+contrato\b|\bfree\s+agent\b/.test(text))return {eventType:'free_agency',status:'free_agent'};
    if(/\bfim\s+de\s+contrato\b|\bcontratos?\s+encerrados?\b|\bencerr(?:ou|a|aram)\s+(?:o\s+)?contratos?\b/.test(text))return {eventType:'expiration',status:'expired'};
    if(/\bdispensad[oa]s?\s+pel[oa]\b|\bdispensa\b|\bdemitid[oa]s?\s+(?:pel[oa]|do)\b|\bliberad[oa]s?\s+pel[oa]\b/.test(text))return {eventType:'release',status:'released'};
    if(/\brenov(?:ou|a|aram)\s+(?:o\s+)?contrato\b|\brenovacao\s+de\s+contrato\b/.test(text))return {eventType:'extension',status:'under_contract'};
    if(/\bassin(?:ou|a|aram)\s+.{0,20}?contrato\b|\bcontratad[oa]s?\s+pel[oa]\b/.test(text))return {eventType:'signing',status:'under_contract'};
    return {eventType:'status_update',status:'unknown'};
  }
  if(lang==='es'){
    if(/\bagente\s+libre\b/.test(text))return {eventType:'free_agency',status:'free_agent'};
    if(/\bno\s+renovar[aá]\s+.{0,15}?contrat\w*\b|\bno\s+renov[oó]\s+.{0,15}?contrat\w*\b|\bsin\s+ampliacion\s+de\s+contrat\w*\b|\bno\s+renovacion\s+de\s+contrat\w*\b/.test(text))return {eventType:'expiration',status:'expired'};
    if(/\bdespid[eo]\b|\bdespedid[oa]s?\b|\babandona\b/.test(text))return {eventType:'release',status:'released'};
    if(/\brenov[oó]\s+.{0,10}?contrat\w*\b|\bextension\s+de\s+contrat\w*\b/.test(text))return {eventType:'extension',status:'under_contract'};
    if(/\bfirm[oa]\s+.{0,20}?contrat\w*\b|\bconsigui[oó]\s+.{0,15}?contrat\w*\b|\bgan[oó]\s+.{0,10}?contrat\w*\b|\bcontratad[oa]s?\b/.test(text))return {eventType:'signing',status:'under_contract'};
    if(/\bcontrat\w*\b/.test(text))return {eventType:'signing',status:'under_contract'};
    return {eventType:'status_update',status:'unknown'};
  }
  if(lang==='fr'){
    if(/\bagent\s+libre\b/.test(text))return {eventType:'free_agency',status:'free_agent'};
    if(/\blibere\w*\s+de\s+son\s+contrat\b/.test(text))return {eventType:'release',status:'released'};
    if(/\bprolonge\w*\b/.test(text))return {eventType:'extension',status:'under_contract'};
    if(/\bsigne\w*\b/.test(text))return {eventType:'signing',status:'under_contract'};
    if(/\bcontrat\w*\b/.test(text))return {eventType:'signing',status:'under_contract'};
    return {eventType:'status_update',status:'unknown'};
  }
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
  if(/\bsign(?:s|ed|ing)?\b|\bnew\s+(?:multi\s+fight\s+)?deal\b|\b(?:secur(?:e|es|ed|ing)|earn(?:s|ed|ing)?|award(?:s|ed|ing)?)\s+(?:a\s+|an\s+)?(?:[a-z0-9-]+\s+){0,2}(?:contract|deal)\b|\bcontract(?:s|ed)?\b/.test(text))return {eventType:'signing',status:'under_contract'};
  return {eventType:'status_update',status:'unknown'};
}

export function detectContractPromotion(value,fallback=null,lang='en'){
  if(lang==='ja'){
    const raw=clean(value);
    for(const [slug,promotion] of PROMOTIONS){
      const patterns=[
        new RegExp(`${promotion}(?:とは|との|と)\\s*.{0,20}?契約`,'i'),
        new RegExp(`${promotion}(?:とは|との|と)\\s*.{0,20}?契約解除`,'i'),
        new RegExp(`${promotion}\\s*へ\\s*.{0,10}?移籍`,'i'),
        new RegExp(`移籍.{0,10}?${promotion}`,'i'),
        new RegExp(`${promotion}\\s*契約`,'i')
      ];
      if(patterns.some(pattern=>pattern.test(raw)))return slug;
    }
    return fallback||null;
  }
  const text=semanticContractText(value);
  for(const [slug,promotion] of PROMOTIONS){
    const patterns=lang==='pl'?[
      new RegExp(`\\bkontrakt(?:u|em)?\\s+z\\s+(?:federacja\\s+|organizacja\\s+)?${promotion}\\b`),
      new RegExp(`\\brozsta(?:l|la|li)\\s+sie\\s+z\\s+(?:federacja\\s+)?${promotion}\\b`),
      new RegExp(`\\bna\\s+dluzej\\s+z\\s+(?:federacja\\s+)?${promotion}\\b`),
      new RegExp(`\\b${promotion}\\s+(?:kontrakt|kontraktu)\\b`)
    ]:lang==='ru'?[
      new RegExp(`\\bkontrakt(?:a|om|u|e)?\\s+s\\s+${promotion}\\b`),
      new RegExp(`\\brasst(?:alsya|alas)\\s+s\\s+${promotion}\\b`),
      new RegExp(`\\bprodli(?:l|la|li)\\s+kontrakt\\s+s\\s+${promotion}\\b`),
      new RegExp(`\\b${promotion}\\s+kontrakt\\b`)
    ]:lang==='ko'?[
      new RegExp(`\\b${promotion}\\s*(?:wa|gwa)\\s+.{0,40}?(?:gyeyak|chegyeol)`),
      new RegExp(`\\b${promotion}\\s*(?:wa|gwa)\\s+jaegyeyak`),
      new RegExp(`\\b${promotion}\\s*(?:seo|eseo)\\s+.{0,20}?bangchul`),
      new RegExp(`\\b${promotion}\\s*e\\s+.{0,20}?gyeyakhaeji`),
      new RegExp(`\\b${promotion}\\s+gyeyak`)
    ]:lang==='pt'?[
      new RegExp(`\\bcontratos?\\b.{0,20}?\\s+com\\s+(?:o\\s+|a\\s+)?${promotion}\\b`),
      new RegExp(`\\b(?:contratad|dispensad|demitid|liberad)[oa]s?\\s+pel[oa]\\s+${promotion}\\b`),
      new RegExp(`\\b${promotion}\\s+(?:contrato|dispensa)\\b`)
    ]:lang==='es'?[
      new RegExp(`\\bcontrat\\w*\\b.{0,20}?\\s+(?:con|por|a)\\s+(?:el\\s+|la\\s+)?${promotion}\\b`),
      new RegExp(`\\b(?:contratad|despedid|liberad)[oa]s?\\s+(?:por|de)\\s+(?:el\\s+|la\\s+)?${promotion}\\b`),
      new RegExp(`\\babandona\\s+(?:la\\s+|el\\s+)?${promotion}\\b`),
      new RegExp(`\\b${promotion}\\b.{0,30}?(?:contrat\\w*|despido)\\b`)
    ]:lang==='fr'?[
      new RegExp(`\\bsigne\\w*\\b.{0,40}?\\b${promotion}\\b`),
      new RegExp(`\\bprolonge\\w*\\b.{0,40}?\\b${promotion}\\b`),
      new RegExp(`\\blibere\\w*\\b.{0,40}?\\b${promotion}\\b`),
      new RegExp(`\\b${promotion}\\b.{0,20}?\\bcontrat\\w*\\b`)
    ]:[
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
    // Some real feeds (e.g. ufc-fr.com) emit a stray leading newline/whitespace before the XML
    // declaration, which JSDOM's strict text/xml parser rejects outright ("XML declaration must be
    // at the start of the document"). Trimming is always safe for well-formed XML. The same feed also
    // uses <media:content> without declaring xmlns:media (a real authoring bug, not this pipeline's),
    // which the strict parser rejects as an unbound namespace prefix; that element is never needed for
    // extraction, so stripping it (self-closing or with a body) is always safe too.
    const cleaned=String(body||'').replace(/^\s+/,'').replace(/<media:[a-z]+(?:\s[^>]*)?\/>/gi,'').replace(/<media:([a-z]+)(?:\s[^>]*)?>[\s\S]*?<\/media:\1>/gi,'');
    const dom=new JSDOM(cleaned,{contentType:'text/xml'}),doc=dom.window.document,out=[];
    for(const item of doc.querySelectorAll('item')){
      const title=clean(item.querySelector('title')?.textContent),link=clean(item.querySelector('link')?.textContent),summary=clean(item.querySelector('description')?.textContent),publishedAt=clean(item.querySelector('pubDate')?.textContent);
      const signalText=source.titleSignalOnly?title:`${title} ${summary}`;
      if(link&&approvedUrl(link,source)&&hasContractSignal(signalText,source.lang||'en'))out.push({title,url:link,summary,publishedAt});
    }
    dom.window.close();return dedupeArticles(out);
  }
  const dom=new JSDOM(String(body||'')),doc=dom.window.document,out=[];
  for(const anchor of doc.querySelectorAll('a[href]')){
    const url=absoluteUrl(anchor.getAttribute('href'),source.url);if(!url||!approvedUrl(url,source))continue;
    const title=clean(anchor.textContent),container=anchor.closest('article,li,div'),context=clean(container?.textContent||title).slice(0,1200);
    const signalText=source.titleSignalOnly?title:`${title} ${context}`;
    if(!title||!hasContractSignal(signalText,source.lang||'en'))continue;
    const time=container?.querySelector('time');out.push({title,url,summary:context,publishedAt:time?.getAttribute('datetime')||clean(time?.textContent)});
  }
  dom.window.close();return dedupeArticles(out);
}
function dedupeArticles(rows){const seen=new Set();return rows.filter(row=>{if(seen.has(row.url))return false;seen.add(row.url);return true;});}

export function articleText(html,source={}){
  const dom=new JSDOM(String(html||'')),doc=dom.window.document;
  // [class*="related"] catches BJPenn.com's own related-posts river (<section class="related
  // os-related">), confirmed live: its "Read more" excerpt blocks for OTHER, unrelated stories were
  // being swept into the block scan alongside the real article, producing candidates that misattribute
  // one story's fighters/events to a completely different article. Kept broad (a class-name substring
  // match, not BJPenn's exact class) so it also covers other sites' equivalent widgets without needing
  // a fix per site. [class*="recirc"] catches the same failure mode under a different name: MMA
  // Mania's real "More in <event>" river (a Vox Media/SB Nation "Duet" platform site, same as MMA
  // Fighting) wraps it in `.duet--layout--article-recirc` -- confirmed live, it let "Brian Ortega was
  // forced to withdraw..." leak into an unrelated fight-preview article's extracted text. Vox names
  // this content-recycling pattern "recirc" rather than "related", so it slipped past the first fix.
  for(const node of doc.querySelectorAll('script,style,noscript,nav,footer,form,aside,[role="complementary"],.related_articles,.latest_articles,.latest_features,.tools_list,.pagination,.right-tabs-content,[class*="recommend"],[class*="outbrain"],[class*="related"],[class*="recirc"]'))node.remove();
  const root=(source.contentSelector?doc.querySelector(source.contentSelector):null)||doc.querySelector('article .body_content,article .article-content,article .entry-content,article,main')||doc.body;
  const blocks=[];const seen=new Set();
  // A "see also"/"related articles" link list isn't always its own wrapper: found live on ufc-fr.com,
  // where it's a single <p> (no distinguishing class) containing a "Voir aussi les articles suivants"
  // lead-in plus five links to other stories -- one of which named a fighter with no connection to
  // this article at all, producing a misattributed candidate. Checked across every real block already
  // relied on in this pipeline (BJPenn, Sherdog, PFL): genuine prose never carries more than 3 anchors
  // in one block, so >=4 anchors is a safe, language-independent signal that a block is a link list,
  // not real content -- no per-language lead-in phrase needed.
  for(const node of root?.querySelectorAll('h2,h3,p,li')||[]){if(node.querySelectorAll('a').length>=4)continue;const value=clean(node.textContent);if(value.length<12||seen.has(value))continue;seen.add(value);blocks.push(value);}
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
  const blocks=String(body||'').split(/\n+/).map(clean).filter(Boolean).filter(block=>hasContractSignal(block,source.lang||'en'));if(!blocks.length)return [];
  const out=[],seen=new Set();
  for(const block of blocks){
    const lang=source.lang||'en',signal=detectContractSignal(block,lang),promotionSlug=detectContractPromotion(block,source.promotionSlug,lang),matches=exactFighterMatches(block,profiles);
    for(const match of matches){
      if(incidentalMention(block,match.name))continue;
      const key=contractCandidateKey(article.url,match.name,signal.eventType);if(seen.has(key))continue;seen.add(key);
      const base={candidateKey:key,sourceUrl:article.url,sourceTitle:article.title,publisher:source.publisher,publishedAt:article.publishedAt||null,sourceType:source.sourceType,fighterName:match.profiles[0]?.fighter_name||match.name,normalizedName:match.name,promotionSlug,detectedEventType:signal.eventType,detectedStatus:signal.status,detectedSummary:block.slice(0,1600),extractionMethod:'signal_block_scoped_subject_v4'};
      if(match.ambiguous){out.push({...base,sourceKey:null,sourceFighterId:null,reviewStatus:'needs_identity'});continue;}
      const profile=match.profiles[0];out.push({...base,sourceKey:profile.source_key,sourceFighterId:profile.source_fighter_id,reviewStatus:'pending'});
    }
  }
  return out;
}
