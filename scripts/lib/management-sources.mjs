import {JSDOM} from 'jsdom';

export const MANAGEMENT_SOURCES=[
  {
    slug:'first-round-management',name:'First Round Management',country:'United States',website:'https://1str.com/',confidence:'A',
    description:'Full-service athlete management company with dedicated UFC, PFL and regional MMA rosters. Its official site emphasizes career management, contract negotiation, sponsorship and brand partnerships, media guidance and long-term athlete development.',
    rosterScope:'official_public_roster',
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
    profileUrls:['https://dominancemma.com/our-company/'],
    urls:['https://dominancemma.com/roster/']
  },
  {
    slug:'iridium-sports-agency',name:'Iridium Sports Agency',country:'United States',website:'https://www.iridiumsportsagency.com/',confidence:'B',
    description:'Full-service combat-sports agency founded by attorney Jason House. Its official site lists fight opportunities, sponsorships, training and nutrition support, appearances, social-media management, commission compliance, PR, legal support, financial management and contract negotiation, with a multi-role agent and operations team.',
    rosterScope:'official_public_roster',
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
  }
];

const STOP=new Set([
  'first round management','regional mma roster','mixed martial arts','our services','latest news','featured news','contact info','join our family','the agency podcast','family orientated','building the next generation of mma talent','united states','south africa','new zealand','saudi arabia','united kingdom','czech republic','south korea','north korea','hong kong','new mexico','new york','new jersey','north carolina','south carolina','rhode island','west virginia','los angeles','las vegas','san diego','san francisco','oktagon athletes','ufc athletes','pfl athletes','combat sports','career management','contract negotiation','financial management','social media management','marketing sponsorships','our clients','our team','management team','all rights reserved','view all athletes','select page','search results','privacy policy','terms conditions'
]);
const BAD=/\b(?:management|athletes?|roster|clients?|services?|contact|copyright|champion|record|ranked|weight|division|media|marketing|sports|official|company|agency|fight(?:er|ing)?|mma|ufc|pfl|bellator|one championship|oktagon|regional|family|news|blog|podcast|sponsor|lbs?|email|phone|website|home|about|team)\b/i;

export function normalizeManagementName(value){
  return String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
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

export function parseManagementRoster(html){
  const doc=new JSDOM(html).window.document,candidates=[];
  const push=value=>{const name=plausibleName(value);if(name)candidates.push(name);};
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
  const seen=new Set(),out=[];
  for(const name of candidates){const k=normalizeManagementName(name);if(!seen.has(k)){seen.add(k);out.push(name);}}
  return out;
}

export function applyManagementAliases(name,aliases={}){
  const normalized=normalizeManagementName(name);
  return aliases[normalized]||name;
}
