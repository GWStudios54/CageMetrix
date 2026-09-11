import {JSDOM} from 'jsdom';

export const FIGHTER_CONTACT_SOURCES=[
  {
    slug:'3mgt-athlete-contacts',
    publisher:'3MGT Sports and Media Management',
    url:'https://3mgt.de/',
    host:'3mgt.de',
    sourceType:'manager_or_agency_direct',
    confidence:'A',
    contactKind:'management_email',
    startHeading:'Our Athletes',
    endHeading:'Case Studie',
    athleteHeadingSelector:'h5',
    emailDomain:'3mgt.de',
    excludedEmails:['3mgt@3mgt.de']
  }
];

function clean(value){return String(value??'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();}
export function normalizeFighterContactName(value){
  return String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}
export function normalizeProfessionalEmail(value){
  return clean(value).replace(/^mailto:/i,'').split('?')[0].trim().toLowerCase();
}
function emailsIn(value,domain){
  const seen=new Set(),out=[];
  for(const match of String(value??'').matchAll(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)){
    const email=normalizeProfessionalEmail(match[0]);
    if(!email.endsWith('@'+domain.toLowerCase())||seen.has(email))continue;
    seen.add(email);out.push(email);
  }
  return out;
}
function plausibleName(value){
  const text=clean(value),words=text.split(/\s+/).filter(Boolean);
  if(text.length<4||text.length>80||words.length<2||words.length>6)return null;
  if(/\b(?:athletes?|management|contact|case|study|partners?|fighter|champion|email|office)\b/i.test(text))return null;
  if(!words.every(word=>/^[\p{L}][\p{L}.'’\-]*$/u.test(word)||/^"[\p{L} .'-]+"$/u.test(word)))return null;
  return text;
}
function nearestCardEmail(heading,source){
  const excluded=new Set((source.excludedEmails||[]).map(normalizeProfessionalEmail));
  const accept=text=>{
    const rows=emailsIn(text,source.emailDomain).filter(email=>!excluded.has(email));
    return rows.length===1?rows[0]:null;
  };
  let parent=heading.parentElement;
  for(let depth=0;parent&&depth<4;depth++,parent=parent.parentElement){
    const sameLevel=parent.querySelectorAll?.(source.athleteHeadingSelector)?.length||0;
    if(sameLevel<=1){
      const email=accept(parent.textContent);if(email)return email;
    }
  }
  let cursor=heading.nextElementSibling;
  for(let step=0;cursor&&step<5;step++,cursor=cursor.nextElementSibling){
    if(cursor.matches?.('h1,h2,h3,h4,h5,h6'))break;
    const email=accept(cursor.textContent);if(email)return email;
  }
  return null;
}

export function parse3MgtAthleteContacts(html,source=FIGHTER_CONTACT_SOURCES[0]){
  const dom=new JSDOM(String(html||'')),doc=dom.window.document;
  const headings=[...doc.querySelectorAll('h1,h2,h3,h4,h5,h6')],out=[];
  let active=false;
  for(const node of headings){
    const text=clean(node.textContent);
    if(text===source.startHeading){active=true;continue;}
    if(active&&text===source.endHeading)break;
    if(!active||!node.matches(source.athleteHeadingSelector))continue;
    const fighterName=plausibleName(text);if(!fighterName)continue;
    out.push({
      fighter_name:fighterName,
      normalized_name:normalizeFighterContactName(fighterName),
      email:nearestCardEmail(node,source)
    });
  }
  dom.window.close();return out;
}
