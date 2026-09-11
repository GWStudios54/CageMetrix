import {JSDOM} from 'jsdom';

export const MANAGEMENT_SOURCES=[
  {
    slug:'first-round-management',name:'First Round Management',country:'United States',website:'https://1str.com/',confidence:'A',
    description:'Full-service athlete management company with dedicated UFC, PFL and regional MMA rosters. Its official site emphasizes career management, contract negotiation, sponsorship and brand partnerships, media guidance and long-term athlete development.',
    rosterScope:'official_public_roster',
    rosterSelectors:['h6:not([class])','span.fname'],
    profileUrls:['https://1str.com/'],
    urls:[
      'https://1str.com/clients/mixed-martial-arts/ufc/',
      'https://1str.com/clients/mixed-martial-arts/pfl/',
      'https://1str.com/clients/mixed-martial-arts/regional-mma-2/'
    ]
  },
  {
    slug:'ruby-sports-entertainment',name:'Ruby Sports & Entertainment',country:'United States',website:'https://www.rubyse.com/',confidence:'A',
    description:'Full-service combat-sports agency with publicly listed UFC, PFL and OKTAGON rosters. Official services include career management, contract negotiation, financial management, immigration and visas, sponsorships and endorsements, and social-media/brand building.',
    rosterScope:'official_public_roster',
    rosterSelectors:['.image-title.sqs-dynamic-text'],
    profileUrls:['https://www.rubyse.com/services'],
    urls:[
      'https://www.rubyse.com/ufc-athletes',
      'https://www.rubyse.com/pfl-athletes',
      'https://www.rubyse.com/oktagon'
    ]
  },
  {
    slug:'dominance-mma',name:'Dominance MMA Management',country:'United States',website:'https://dominancemma.com/',confidence:'B',
    description:'MMA management company based in Las Vegas and New York City. Its official company page lists Ali Abdelaziz as President & Founder, Rizvan Magomedov as President International Development, regional leadership in Brazil and additional managers; it highlights contract negotiation, sponsorships and relationship-building across major MMA organizations.',
    rosterScope:'official_public_roster',
    rosterSelectors:['.spectra-image-gallery__media-thumbnail-caption'],
    profileUrls:['https://dominancemma.com/our-company/'],
    urls:['https://dominancemma.com/roster/']
  },
  {
    slug:'iridium-sports-agency',name:'Iridium Sports Agency',country:'United States',website:'https://www.iridiumsportsagency.com/',confidence:'B',
    description:'Full-service combat-sports agency founded by attorney Jason House. Its official site lists fight opportunities, sponsorships, training and nutrition support, appearances, social-media management, commission compliance, PR, legal support, financial management and contract negotiation, with a multi-role agent and operations team.',
    rosterScope:'official_public_roster',
    rosterSelectors:['img.gallery-item[alt]'],
    profileUrls:['https://www.iridiumsportsagency.com/'],
    urls:['https://www.iridiumsportsagency.com/roster']
  },
  {
    slug:'suckerpunch-entertainment',name:'SuckerPunch Entertainment',country:'United States',website:'https://suckerpunchent.com/',confidence:'A',
    description:'Established in 2007, SuckerPunch Entertainment describes itself as an MMA athlete management and marketing company. Its current official team page lists Brian Butler-Au as CEO, Bryan Hamper as President, athlete-relations/agent, operations, marketing/PR and Eastern Europe leadership roles.',
    rosterScope:'profile_only',
    profileUrls:['https://suckerpunchent.com/','https://suckerpunchent.com/about-us/'],
    urls:[]
  },
  {
    slug:'paradigm-sports',name:'Paradigm Sports',country:'United States',website:'https://www.paradigmsports.com/',confidence:'A',
    description:'Full-service sports representation agency active in combat sports. Its official representation page currently reports a 19-person team, 9 agents, 137 combat-sports titles and belts, and more than $1 billion in athlete representation contracts while emphasizing brand, value and revenue growth for clients.',
    rosterScope:'profile_only',
    profileUrls:['https://www.paradigmsports.com/representation'],
    urls:[]
  },
  {
    slug:'tam-global',name:'TAM Global',country:'United States',website:'https://tamglobalmma.com/',confidence:'A',
    description:'Professional MMA athlete management and media agency whose official site says it was founded on the vision of UFC legend Urijah Faber. TAM emphasizes athlete development, elite training, strategic partnerships, brand building, financial growth and career support across UFC, PFL and other national and international promotions.',
    rosterScope:'official_public_roster',
    rosterSelectors:['h4.sc_team_item_title'],
    profileUrls:['https://tamglobalmma.com/'],
    urls:['https://tamglobalmma.com/roster/']
  },
  {
    slug:'galaktik-sports',name:'Galaktik Sports',country:'United States',website:'https://galaktiksports.com/',confidence:'A',
    description:'Combat-sports management and event-consulting company with offices listed in Miami, Las Vegas and Baku. Its official site reports 50+ fighters managed and 500+ contracts negotiated, and lists contract negotiation, fight booking, sponsorships, visas, travel, camp logistics, media preparation and brand strategy among its fighter services.',
    rosterScope:'official_public_roster',
    rosterSelectors:['a.fcard img[alt]'],
    profileUrls:['https://galaktiksports.com/','https://galaktiksports.com/about'],
    urls:['https://galaktiksports.com/fighters']
  },
  {
    slug:'magnar-sports-entertainment',name:'Magnar Sports & Entertainment',country:'International',website:'https://www.magnarse.com/',confidence:'A',
    description:'Full-service combat-sports agency specializing in worldwide career management and promotion. Its official site reports 50+ athletes, 10+ years in the business, athletes across five organizations and 100+ events, with fighters competing in UFC, PFL, OKTAGON and other promotions.',
    rosterScope:'official_public_roster',
    rosterSelectors:['a.athlete-card h3'],
    profileUrls:['https://www.magnarse.com/'],
    urls:[
      'https://www.magnarse.com/athletes/?org=UFC',
      'https://www.magnarse.com/athletes/?org=PFL',
      'https://www.magnarse.com/athletes/?org=Oktagon',
      'https://www.magnarse.com/athletes/?org=Bellator',
      'https://www.magnarse.com/athletes/?org=Other'
    ]
  },
  {
    slug:'littles-mma-management',name:"Little's MMA Management",country:'United States',website:'https://littlesmma.com/',confidence:'A',
    description:'Fighter-first boutique MMA management practice launched in 2025 by U.S. military veteran Tyler Little. Its official site describes a small, selectively managed U.S. roster and a long-term career-guidance approach; a May 2026 notice states the agency is not currently taking new clients but will retain inquiries for future openings.',
    rosterScope:'profile_only',
    profileUrls:['https://littlesmma.com/'],
    urls:[]
  },
  {
    slug:'goat-worldwide',name:'GOAT Worldwide',country:'United States',website:'https://goatworldwide.com/',confidence:'A',
    description:'Miami-based boutique MMA management and marketing agency focused on prospects. Its official site describes full-service representation covering athletic-commission compliance, career management, marketing and sponsorships, contract negotiation, brand development and legal support, and publishes a dedicated fighter roster.',
    rosterScope:'official_public_roster',
    rosterSelectors:['.grid__item.medium-up--one-third.text-center .rte-setting.text-spacing'],
    profileUrls:['https://goatworldwide.com/'],
    urls:['https://goatworldwide.com/pages/fighters']
  },
  {
    slug:'artnox-fight-sport',name:'Artnox Fight Sport',country:'Poland',website:'https://artnoxfightsport.pl/',confidence:'A',
    description:'Polish combat-sports management group founded in 2017. Its official site publishes a large current fighter roster spanning UFC, KSW, OKTAGON, Babilon MMA, FEN, FNC and other organizations, and describes contract negotiation, career strategy, sponsorship and media support.',
    rosterScope:'official_public_roster',
    rosterSelectors:['h3.artnox-fighter-name-gradient','h3.roster-name'],
    profileUrls:['https://artnoxfightsport.pl/en/pages/o-nas'],
    urls:['https://artnoxfightsport.pl/pages/zawodnicy']
  },
  {
    slug:'fair-play-mma',name:'Fair Play MMA',country:'Netherlands',website:'https://fairplaymma.com/',confidence:'A',
    description:'Amsterdam-based full-service athlete management and marketing agency focused on combat sports. Its official site publishes named roster cards and describes fighter contract support, career development, brand growth and commercial representation.',
    rosterScope:'official_public_roster',
    rosterSelectors:['h4.w-person-name'],
    profileUrls:['https://fairplaymma.com/'],
    urls:['https://fairplaymma.com/']
  },
  {
    slug:'ak-fighter-management',name:'AK Fighter Management',country:'United Kingdom',website:'https://akfightermanagement.com/',confidence:'A',
    description:'UK-based MMA fighter representation and career-management agency. Its official site publishes a current named roster, distinguishes fighters signed to major promotions from fighters seeking opportunities, and describes strategic matchmaking, promotion liaison and long-term career development.',
    rosterScope:'official_public_roster',
    rosterSection:{start:'Our Fighters',end:'Apply to Be Talent',selector:'h3:not(.roster-category)'},
    profileUrls:['https://akfightermanagement.com/'],
    urls:['https://akfightermanagement.com/']
  }
];

const STOP=new Set([
  'first round management','regional mma roster','mixed martial arts','our services','latest news','featured news','contact info','join our family','the agency podcast','family orientated','building the next generation of mma talent','united states','south africa','new zealand','saudi arabia','united kingdom','czech republic','south korea','north korea','hong kong','new mexico','new york','new jersey','north carolina','south carolina','rhode island','west virginia','los angeles','las vegas','san diego','san francisco','oktagon athletes','ufc athletes','pfl athletes','combat sports','career management','contract negotiation','financial management','social media management','marketing sponsorships','our clients','our team','management team','all rights reserved','view all athletes','select page','search results','privacy policy','terms conditions','meet our fighters','fighter first management','our fighters compete in','full service representation','representing top prospects','our athletes','our athletes get in touch','get in touch','ready to take your career to the next level','view the roster','view our roster','see all fighters','work with us','book a fighter','questions let s chat'
]);
const BAD=/\b(?:management|athletes?|roster|clients?|services?|contact|copyright|champion|record|ranked|weight|division|media|marketing|sports|official|company|agency|fight(?:er|ing)?|mma|ufc|pfl|bellator|one championship|oktagon|regional|family|news|blog|podcast|sponsor|lbs?|email|phone|website|home|about|team)\b/i;

export function normalizeManagementName(value){
  return String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}

const LATIN_COMPAT=new Map(Object.entries({
  'ł':'l','ø':'o','đ':'d','ð':'d','þ':'th','æ':'ae','œ':'oe','ß':'ss','ħ':'h','ı':'i'
}));
export function foldManagementLatinCompatibility(value){
  return String(value??'').replace(/[łøđðþæœßħı]/gi,ch=>LATIN_COMPAT.get(ch.toLowerCase())||ch);
}
export function managementLookupKeys(value){
  const keys=[
    normalizeManagementName(value),
    normalizeManagementName(foldManagementLatinCompatibility(value))
  ].filter(Boolean);
  return [...new Set(keys)];
}

function cleanedCandidate(value){
  let text=String(value??'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
  text=text.replace(/\s*\((?:UFC|PFL|Bellator|ONE|ACB|BRAVE|BKFC|Bare Knuckle[^)]*)\)\s*$/i,'').trim();
  text=text.replace(/^#\d+\s+RANKED\s+/i,'').trim();
  return text;
}

function plausibleName(value){
  const text=cleanedCandidate(value),norm=normalizeManagementName(text);
  if(!text||text.length<4||text.length>72||STOP.has(norm)||BAD.test(text))return null;
  if(/[\d@]|https?:|\.(?:com|org|net)\b/i.test(text)||text.includes(','))return null;
  const words=text.split(/\s+/).filter(Boolean);
  if(words.length<2||words.length>6)return null;
  if(!words.every(word=>/^[\p{L}][\p{L}.'’\-]*$/u.test(word)||/^"[\p{L} .'-]+"$/u.test(word)))return null;
  return text.replace(/\s+/g,' ');
}

function sourceSelectedRoster(doc,source){
  if(source?.rosterSection){
    const headings=[...doc.querySelectorAll('h1,h2,h3,h4,h5,h6')],out=[];
    let active=false;
    for(const node of headings){
      const text=String(node.textContent??'').replace(/\s+/g,' ').trim();
      if(text===source.rosterSection.start){active=true;continue;}
      if(active&&text===source.rosterSection.end)break;
      if(active&&node.matches(source.rosterSection.selector))out.push(node.textContent);
    }
    return out;
  }
  if(Array.isArray(source?.rosterSelectors)&&source.rosterSelectors.length){
    const out=[];
    for(const selector of source.rosterSelectors){
      for(const el of doc.querySelectorAll(selector))out.push(el.getAttribute?.('alt')||el.textContent);
    }
    return out;
  }
  return null;
}

export function parseManagementRoster(html,source=null){
  const doc=new JSDOM(html).window.document,candidates=[];
  const push=value=>{const name=plausibleName(value);if(name)candidates.push(name);};
  const selected=sourceSelectedRoster(doc,source);
  if(selected!==null){
    for(const value of selected)push(value);
  }else{
    for(const image of doc.querySelectorAll('img[alt]'))push(image.getAttribute('alt'));
    for(const el of doc.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,a,strong,b,span,td')){
      const text=String(el.textContent??'').replace(/\s+/g,' ').trim();
      if(text.length<=80)push(text);
    }
    for(const el of doc.querySelectorAll('div')){
      if(el.children.length>3)continue;
      const text=String(el.textContent??'').replace(/\s+/g,' ').trim();
      if(text.length<=72)push(text);
    }
  }
  const seen=new Set(),out=[];
  for(const name of candidates){const k=normalizeManagementName(name);if(!seen.has(k)){seen.add(k);out.push(name);}}
  return out;
}

export function applyManagementAliases(name,aliases={}){
  const normalized=normalizeManagementName(name);
  return aliases[normalized]||name;
}
