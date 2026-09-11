import {JSDOM} from 'jsdom';

export const PFL_LOCATION_SOURCE={
  slug:'pfl-roster',
  publisher:'Professional Fighters League',
  rosterUrl:'https://pflmma.com/all-fighter-roster',
  rosterUrls:[
    'https://pflmma.com/all-fighter-roster',
    'https://pflmma.com/regular-fighter-roster',
    'https://pflmma.com/cs-fighter-roster',
    'https://pflmma.com/mena-fighter-roster',
    'https://pflmma.com/europe-fighter-roster',
    'https://pflmma.com/africa-fighter-roster'
  ],
  host:'pflmma.com',
  sourceType:'promotion_direct',
  confidence:'A',
  promotionSlug:'pfl'
};

export const ONE_LOCATION_SOURCE={
  slug:'one-athletes',
  publisher:'ONE Championship',
  rosterUrl:'https://www.onefc.com/athletes/',
  host:'www.onefc.com',
  sourceType:'promotion_direct',
  confidence:'A',
  promotionSlug:'one'
};

export const GLADIATOR_LOCATION_SOURCE={
  slug:'gladiator-management-roster',
  publisher:'Gladiator Management Agency',
  rosterUrl:'https://www.gladiatormgmtagency.com/roster',
  host:'www.gladiatormgmtagency.com',
  sourceType:'manager_or_agency_direct',
  confidence:'A',
  promotionSlug:null
};

export function normalizeFighterName(value){
  return String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}

const US_STATE_MAP=new Map(Object.entries({
  Alabama:'AL',Alaska:'AK',Arizona:'AZ',Arkansas:'AR',California:'CA',Colorado:'CO',Connecticut:'CT',Delaware:'DE',Florida:'FL',Georgia:'GA',Hawaii:'HI',Idaho:'ID',Illinois:'IL',Indiana:'IN',Iowa:'IA',Kansas:'KS',Kentucky:'KY',Louisiana:'LA',Maine:'ME',Maryland:'MD',Massachusetts:'MA',Michigan:'MI',Minnesota:'MN',Mississippi:'MS',Missouri:'MO',Montana:'MT',Nebraska:'NE',Nevada:'NV','New Hampshire':'NH','New Jersey':'NJ','New Mexico':'NM','New York':'NY','North Carolina':'NC','North Dakota':'ND',Ohio:'OH',Oklahoma:'OK',Oregon:'OR',Pennsylvania:'PA','Rhode Island':'RI','South Carolina':'SC','South Dakota':'SD',Tennessee:'TN',Texas:'TX',Utah:'UT',Vermont:'VT',Virginia:'VA',Washington:'WA','West Virginia':'WV',Wisconsin:'WI',Wyoming:'WY','District of Columbia':'DC'
}).flatMap(([name,abbr])=>[[name.toLowerCase(),abbr],[abbr.toLowerCase(),abbr]]));
const COUNTRIES=new Set([
  'Albania','Algeria','Argentina','Armenia','Australia','Austria','Azerbaijan','Bahrain','Bangladesh','Belarus','Belgium','Bolivia','Bosnia and Herzegovina','Brazil','Bulgaria','Cambodia','Cameroon','Canada','Chile','China','Colombia','Costa Rica','Croatia','Cuba','Cyprus','Czech Republic','Denmark','Dominican Republic','Ecuador','Egypt','El Salvador','England','Estonia','Finland','France','Georgia','Germany','Ghana','Greece','Guatemala','Honduras','Hong Kong','Hong Kong SAR China','Hungary','Iceland','India','Indonesia','Iran','Iraq','Ireland','Israel','Italy','Jamaica','Japan','Jordan','Kazakhstan','Kuwait','Kyrgyzstan','Laos','Latvia','Lebanon','Lithuania','Malaysia','Mexico','Moldova','Mongolia','Montenegro','Morocco','Myanmar','Myanmar [Burma]','Nepal','Netherlands','New Zealand','Nicaragua','Nigeria','North Macedonia','Norway','Pakistan','Panama','Paraguay','Peru','Philippines','Poland','Portugal','Puerto Rico','Qatar','Romania','Russia','Samoa','Saudi Arabia','Scotland','Senegal','Serbia','Singapore','Slovakia','Slovenia','South Africa','South Korea','Spain','Suriname','Sweden','Switzerland','Syria','Taiwan','Tajikistan','Thailand','Tonga','Tunisia','Turkey','Turkiye','Ukraine','United Arab Emirates','United Kingdom','United States','Uruguay','Uzbekistan','Venezuela','Vietnam','Wales'
]);
const COUNTRY_MAP=new Map([...COUNTRIES].map(country=>[country.toLowerCase(),country]));
const COUNTRY_ALIASES=new Map([
  ['usa','United States'],['u.s.a.','United States'],['united states of america','United States'],
  ['uk','United Kingdom'],['u.k.','United Kingdom'],
  ['uae','United Arab Emirates'],['u.a.e.','United Arab Emirates'],
  ['republic of ireland','Ireland'],['the netherlands','Netherlands']
]);
function canonicalCountry(value){
  const key=String(value??'').trim().toLowerCase();
  return COUNTRY_MAP.get(key)||COUNTRY_ALIASES.get(key)||null;
}

export function parseProfessionalLocation(value){
  const raw=String(value??'').replace(/\s+/g,' ').trim();
  if(!raw)return {raw_value:null,city:null,region:null,country:null};
  const parts=raw.split(',').map(x=>x.trim()).filter(Boolean);
  if(parts.length>=3){
    const country=canonicalCountry(parts[parts.length-1]);
    if(country){
      const middle=parts.slice(1,-1).join(', ');
      const region=country==='United States'?(US_STATE_MAP.get(middle.toLowerCase())||middle):middle;
      return {raw_value:raw,city:parts[0],region,country};
    }
    return {raw_value:raw,city:null,region:null,country:null};
  }
  if(parts.length===2){
    const state=US_STATE_MAP.get(parts[1].toLowerCase());
    if(state)return {raw_value:raw,city:parts[0],region:state,country:'United States'};
    const country=canonicalCountry(parts[1]);
    if(country)return {raw_value:raw,city:parts[0],region:null,country};
    return {raw_value:raw,city:null,region:null,country:null};
  }
  const country=canonicalCountry(raw);
  if(country)return {raw_value:raw,city:null,region:null,country};
  return {raw_value:raw,city:null,region:null,country:null};
}

function clean(value){return String(value??'').replace(/\s+/g,' ').trim();}
function absolute(href,base){try{return new URL(href,base).href}catch{return null;}}

export function extractPflCsrfToken(html){
  const match=String(html||'').match(/['"]X-CSRF-TOKEN['"]\s*:\s*['"]([^'"]+)['"]/i);
  return match?.[1]||null;
}

export function parsePflAjaxPayload(value){
  const data=typeof value==='string'?JSON.parse(value):value;
  return {
    html:String(data?.html||''),
    count:Number(data?.count||0),
    total:Number(data?.total||0)
  };
}

export function parsePflRoster(html,source=PFL_LOCATION_SOURCE){
  const dom=new JSDOM(String(html||'')),doc=dom.window.document,out=[],seen=new Set();
  for(const anchor of doc.querySelectorAll('a[href]')){
    const url=absolute(anchor.getAttribute('href'),source.rosterUrl);if(!url)continue;
    const parsed=new URL(url);
    if(parsed.hostname!==source.host)continue;
    if(!/^\/(?:all-fighter|regular-fighter|wt-fighter|cs-fighter)\/[a-z0-9-]+\/?$/i.test(parsed.pathname))continue;
    const canonical=parsed.origin+parsed.pathname.replace(/\/$/,'');
    if(seen.has(canonical))continue;seen.add(canonical);out.push({url:canonical});
  }
  dom.window.close();return out;
}

function between(body,start,end){
  const upper=body.toUpperCase(),a=upper.indexOf(start),b=a<0?-1:upper.indexOf(end,a+start.length);
  if(a<0||b<0)return null;
  return clean(body.slice(a+start.length,b));
}

export function parsePflProfile(html,url){
  const dom=new JSDOM(String(html||'')),doc=dom.window.document;
  const title=clean(doc.querySelector('meta[property="og:title"]')?.getAttribute('content')||doc.title);
  const fighterName=clean(title.split('|')[0]),body=clean(doc.body?.textContent);
  const fightingOutOf=between(body,'FIGHTING OUT OF','FIGHT CAMP');
  const fightCamp=between(body,'FIGHT CAMP','SOCIAL');
  dom.window.close();
  return {source_url:url,fighter_name:fighterName||null,normalized_name:normalizeFighterName(fighterName),fighting_out_of:fightingOutOf,location:parseProfessionalLocation(fightingOutOf),fight_camp:fightCamp};
}


export function stripQuotedNickname(value){
  return clean(String(value??'').replace(/[“"][^”"]+[”"]/g,' '));
}

export function parseOneRoster(html,source=ONE_LOCATION_SOURCE){
  const dom=new JSDOM(String(html||'')),doc=dom.window.document,out=[],seen=new Set();
  for(const anchor of doc.querySelectorAll('a[href]')){
    const url=absolute(anchor.getAttribute('href'),source.rosterUrl);if(!url)continue;
    const parsed=new URL(url);
    if(parsed.hostname!==source.host)continue;
    if(!/^\/athletes\/[a-z0-9-]+\/?$/i.test(parsed.pathname))continue;
    const canonical=parsed.origin+parsed.pathname.replace(/\/$/,'');
    if(seen.has(canonical))continue;
    const anchorText=stripQuotedNickname(clean(anchor.textContent));
    if(!anchorText)continue;
    seen.add(canonical);out.push({url:canonical,fighter_name:anchorText,normalized_name:normalizeFighterName(anchorText)});
  }
  dom.window.close();return out;
}

function oneAboutBody(doc){
  const body=clean(doc.body?.textContent);
  const heading=[...doc.querySelectorAll('h2,h3')].find(node=>/^About\b/i.test(clean(node.textContent)));
  if(!heading)return body;
  const marker=clean(heading.textContent),start=body.indexOf(marker);
  if(start<0)return body;
  const tail=body.slice(start+marker.length);
  const end=tail.search(/\bONE Championship Records\b/i);
  return clean(end>=0?tail.slice(0,end):tail);
}

export function parseOneProfile(html,url){
  const dom=new JSDOM(String(html||'')),doc=dom.window.document;
  const h1=clean(doc.querySelector('h1')?.textContent);
  const title=clean(doc.querySelector('meta[property="og:title"]')?.getAttribute('content')||doc.title);
  const displayName=h1||clean(title.split(' - ONE Championship')[0].split(' | ONE Championship')[0]);
  const fighterName=stripQuotedNickname(displayName);
  const about=oneAboutBody(doc);
  const match=about.match(/\b(?:currently\s+)?fighting out of\s+([^.!?]+)/i);
  let raw=clean(match?.[1]),fightCamp=null;
  if(raw){
    if(/\b(?:southpaw|orthodox)\s+stance\b/i.test(raw)||/^the\s+\w+\s+stance\b/i.test(raw))raw='';
    const withMatch=raw.match(/^(.+?),\s+with\s+(.+)$/i);
    if(withMatch){
      raw=clean(withMatch[1]);
      fightCamp=clean(withMatch[2].replace(/,\s*(?:he|she|they|who|the fighter)\b[\s\S]*$/i,''));
    }
  }
  if(raw){
    const parts=raw.split(',').map(value=>clean(value)).filter(Boolean);
    for(let count=1;count<=parts.length;count++){
      const candidate=parts.slice(0,count).join(', ');
      const parsed=parseProfessionalLocation(candidate);
      if(parsed.city||parsed.region||parsed.country){raw=candidate;break;}
    }
  }
  const location=parseProfessionalLocation(raw);
  const usable=Boolean(location.city||location.region||location.country);
  dom.window.close();
  return {
    source_url:url,
    fighter_name:fighterName||null,
    normalized_name:normalizeFighterName(fighterName),
    fighting_out_of:usable?location.raw_value:null,
    location:usable?location:{raw_value:null,city:null,region:null,country:null},
    fight_camp:fightCamp||null
  };
}


export function parseGladiatorRoster(html,source=GLADIATOR_LOCATION_SOURCE){
  const dom=new JSDOM(String(html||'')),doc=dom.window.document,out=[],seen=new Set();
  for(const anchor of doc.querySelectorAll('h3 a[href]')){
    const url=absolute(anchor.getAttribute('href'),source.rosterUrl);if(!url)continue;
    const parsed=new URL(url);
    if(parsed.hostname!==source.host)continue;
    if(!/^\/[a-z0-9-]+\/?$/i.test(parsed.pathname))continue;
    if(/^\/(?:roster|contact|fighter-management|consulting|marketing|partners|about|home)\/?$/i.test(parsed.pathname))continue;
    const fighterName=stripQuotedNickname(clean(anchor.textContent));
    if(!fighterName)continue;
    const canonical=parsed.origin+parsed.pathname.replace(/\/$/,'');
    if(seen.has(canonical))continue;
    seen.add(canonical);
    out.push({url:canonical,fighter_name:fighterName,normalized_name:normalizeFighterName(fighterName)});
  }
  dom.window.close();return out;
}

export function parseGladiatorProfile(html,url){
  const dom=new JSDOM(String(html||'')),doc=dom.window.document;
  const h1=clean(doc.querySelector('h1')?.textContent);
  const title=clean(doc.querySelector('meta[property="og:title"]')?.getAttribute('content')||doc.title);
  const fighterName=stripQuotedNickname(h1||title.split('|')[0]);
  const body=clean(doc.body?.textContent);
  const fightingOutOf=between(body,'FIGHTING OUT OF','FROM');
  const teamRaw=between(body,'TEAM','MMA RECORD');
  const location=parseProfessionalLocation(fightingOutOf);
  const usable=Boolean(location.city||location.region||location.country);
  const fightCamp=teamRaw&&!/^(?:n\/?a|na|none|unknown)$/i.test(teamRaw)?teamRaw:null;
  dom.window.close();
  return {
    source_url:url,
    fighter_name:fighterName||null,
    normalized_name:normalizeFighterName(fighterName),
    fighting_out_of:usable?location.raw_value:null,
    location:usable?location:{raw_value:null,city:null,region:null,country:null},
    fight_camp:fightCamp
  };
}
