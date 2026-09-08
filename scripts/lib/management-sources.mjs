import {JSDOM} from 'jsdom';

export const MANAGEMENT_SOURCES=[
  {
    slug:'first-round-management',name:'First Round Management',country:'United States',website:'https://1str.com/',confidence:'A',
    description:'Full-service athlete management company with dedicated UFC, PFL and regional MMA rosters.',
    urls:[
      'https://1str.com/clients/mixed-martial-arts/ufc/',
      'https://1str.com/clients/mixed-martial-arts/pfl/',
      'https://1str.com/clients/mixed-martial-arts/regional-mma-2/'
    ]
  },
  {
    slug:'ruby-sports-entertainment',name:'Ruby Sports & Entertainment',country:'United States',website:'https://www.rubyse.com/',confidence:'A',
    description:'Combat-sports management agency with publicly listed UFC, PFL and OKTAGON athlete rosters.',
    urls:[
      'https://www.rubyse.com/ufc-athletes',
      'https://www.rubyse.com/pfl-athletes',
      'https://www.rubyse.com/oktagon'
    ]
  },
  {
    slug:'dominance-mma',name:'Dominance MMA Management',country:'United States',website:'https://dominancemma.com/',confidence:'B',
    description:'MMA management company with an official public athlete roster.',
    urls:['https://dominancemma.com/roster/']
  },
  {
    slug:'iridium-sports-agency',name:'Iridium Sports Agency',country:'United States',website:'https://www.iridiumsportsagency.com/',confidence:'B',
    description:'Full-service combat-sports agency founded by Jason House with a public roster page.',
    urls:['https://www.iridiumsportsagency.com/roster']
  },
  {
    slug:'knock-out-representation',name:'Knock Out Representation',country:'United States',website:'https://www.koreps.com/',confidence:'A',headingOnly:true,
    description:'MMA representation agency with an official public athlete roster spanning prospects through champions.',
    urls:['https://www.koreps.com/athletes/']
  },
  {
    slug:'lca-sports-management',name:'LCA Sports Management',country:'United States',website:'https://www.lcasportsmanagement.com/',confidence:'A',headingOnly:true,
    description:'Sports management agency with a dedicated official MMA athlete roster.',
    urls:['https://www.lcasportsmanagement.com/mma-athletes']
  },
  {
    slug:'3mgt',name:'3MGT Sports and Media Management',country:'Germany',website:'https://3mgt.de/',confidence:'A',headingOnly:true,
    description:'German sports and media management agency with an official public combat-sports athlete roster.',
    urls:['https://3mgt.de/en']
  },
  {
    slug:'guerilla-sportsmanagement',name:'Guerilla Sportsmanagement',country:'Austria',website:'https://guerillasportsmanagement.com/',confidence:'A',headingOnly:true,
    description:'Austrian combat-sports management agency with official athlete profiles and representation statements.',
    urls:['https://guerillasportsmanagement.com/athletes/']
  }
];

const STOP=new Set([
  'first round management','regional mma roster','mixed martial arts','our services','latest news','featured news','contact info','join our family','the agency podcast','family orientated','building the next generation of mma talent','united states','south africa','new zealand','saudi arabia','united kingdom','czech republic','south korea','north korea','hong kong','new mexico','new york','new jersey','north carolina','south carolina','rhode island','west virginia','los angeles','las vegas','san diego','san francisco','oktagon athletes','ufc athletes','pfl athletes','combat sports','career management','contract negotiation','financial management','social media management','marketing sponsorships','our clients','our team','management team','all rights reserved','view all athletes','select page','search results','privacy policy','terms conditions','meet our athletes','under our house','the fighters','weight classes','all weight classes','our athletes','mma athletes','beyond management','case studie','our mission','full service representation'
]);
const BAD=/\b(?:management|athletes?|roster|clients?|services?|contact|copyright|champion|record|ranked|weight|division|media|marketing|sports|official|company|agency|fight(?:er|ing)?|mma|ufc|pfl|bellator|one championship|oktagon|regional|family|news|blog|podcast|sponsor|lbs?|email|phone|website|home|about|team|class(?:es)?)\b/i;

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

export function parseManagementRoster(html,source={}){
  const doc=new JSDOM(html).window.document,candidates=[];
  const push=value=>{const name=plausibleName(value);if(name)candidates.push(name);};
  for(const image of doc.querySelectorAll('img[alt]'))push(image.getAttribute('alt'));
  const selectors=source.headingOnly?'h1,h2,h3,h4,h5,h6':'h1,h2,h3,h4,h5,h6,p,li,a,strong,b,span,td';
  for(const el of doc.querySelectorAll(selectors)){
    const text=String(el.textContent??'').replace(/\s+/g,' ').trim();
    if(text.length<=80)push(text);
  }
  if(!source.headingOnly){
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
