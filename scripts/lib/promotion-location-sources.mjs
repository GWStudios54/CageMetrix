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
  confidence:'A'
};

export function normalizeFighterName(value){
  return String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}

const US_STATES=new Set(['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC']);
const COUNTRIES=new Set(['Australia','Austria','Azerbaijan','Bahrain','Belgium','Brazil','Bulgaria','Cameroon','Canada','China','Croatia','Czech Republic','Egypt','England','Finland','France','Georgia','Germany','Greece','India','Indonesia','Ireland','Israel','Italy','Japan','Jordan','Kazakhstan','Kyrgyzstan','Lebanon','Mexico','Moldova','Mongolia','Montenegro','Morocco','Netherlands','New Zealand','Nigeria','Norway','Philippines','Poland','Portugal','Puerto Rico','Romania','Russia','Saudi Arabia','Scotland','Serbia','Singapore','Slovakia','South Africa','South Korea','Spain','Sweden','Switzerland','Syria','Tajikistan','Thailand','Tunisia','Turkey','Turkiye','Ukraine','United Arab Emirates','United Kingdom','United States','Uzbekistan','Venezuela','Wales']);

export function parseProfessionalLocation(value){
  const raw=String(value??'').replace(/\s+/g,' ').trim();
  if(!raw)return {raw_value:null,city:null,region:null,country:null};
  const parts=raw.split(',').map(x=>x.trim()).filter(Boolean);
  if(parts.length>=3)return {raw_value:raw,city:parts[0],region:parts.slice(1,-1).join(', '),country:parts[parts.length-1]};
  if(parts.length===2){
    if(US_STATES.has(parts[1].toUpperCase()))return {raw_value:raw,city:parts[0],region:parts[1].toUpperCase(),country:'United States'};
    return {raw_value:raw,city:parts[0],region:null,country:parts[1]};
  }
  if(COUNTRIES.has(raw))return {raw_value:raw,city:null,region:null,country:raw};
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
