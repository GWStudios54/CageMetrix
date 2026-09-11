import {JSDOM} from 'jsdom';

export const AVAILABILITY_SOURCES=[
  {
    slug:'ak-fighter-management-opportunities',
    publisher:'AK Fighter Management',
    url:'https://akfightermanagement.com/',
    host:'akfightermanagement.com',
    sourceType:'manager_or_agency_direct',
    confidence:'A',
    availabilityKind:'fight_booking'
  }
];

export function normalizeAvailabilityName(value){
  return String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}

const STOP=new Set([
  'looking for opportunities','signed fighters','fight bookings','matchmaking','promotion liaison','career development',
  'application received','request received','apply to be talent','request to book a fighter','get in touch'
]);
const BAD=/\b(?:available|fighter|fighters|opportunities|roster|management|application|request|career|booking|matchmaking|promotion|contact|talent|sponsor|media|signed)\b/i;

function clean(value){return String(value??'').replace(/\s+/g,' ').trim();}

function plausibleName(value){
  const text=clean(value),norm=normalizeAvailabilityName(text);
  if(!text||text.length<4||text.length>72||STOP.has(norm)||BAD.test(text))return null;
  const words=text.split(/\s+/).filter(Boolean);
  if(words.length<2||words.length>6)return null;
  if(!words.every(word=>/^[\p{L}][\p{L}.'’\-]*$/u.test(word)))return null;
  return text;
}

export function parseAkFightAvailability(html){
  const dom=new JSDOM(String(html||'')),doc=dom.window.document,out=[];
  let active=false;
  for(const heading of doc.querySelectorAll('h2,h3,h4')){
    const value=clean(heading.textContent),norm=normalizeAvailabilityName(value);
    if(norm==='looking for opportunities'){active=true;continue;}
    if(!active)continue;
    if(['apply to be talent','request to book a fighter','get in touch','application received','request received'].includes(norm))break;
    const name=plausibleName(value);
    if(name)out.push(name);
  }
  dom.window.close();
  const seen=new Set();
  return out.filter(name=>{const key=normalizeAvailabilityName(name);if(seen.has(key))return false;seen.add(key);return true;});
}
