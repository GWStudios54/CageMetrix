import {JSDOM} from 'jsdom';

export const MANAGEMENT_CONTACT_SOURCES=[
  {
    agencySlug:'first-round-management',
    publisher:'First Round Management',
    url:'https://1str.com/clients/mixed-martial-arts/',
    host:'1str.com',
    expectedEmail:'info@firstroundmanagement.com',
    contactKind:'general_email',
    label:'General agency contact',
    confidence:'A'
  },
  {
    agencySlug:'fair-play-mma',
    publisher:'Fair Play MMA',
    url:'https://fairplaymma.com/',
    host:'fairplaymma.com',
    expectedEmail:'info@fairplaymma.com',
    contactKind:'general_email',
    label:'Management enquiries',
    confidence:'A'
  },
  {
    agencySlug:'ak-fighter-management',
    publisher:'AK Fighter Management',
    url:'https://akfightermanagement.com/',
    host:'akfightermanagement.com',
    expectedEmail:'info@akfightermanagement.com',
    contactKind:'booking_email',
    label:'Fight booking / promotion enquiries',
    confidence:'A'
  },
  {
    agencySlug:'knock-out-representation',
    publisher:'Knock Out Representation',
    url:'https://www.koreps.com/contact-us/',
    host:'www.koreps.com',
    expectedEmail:'info@koreps.com',
    contactKind:'general_email',
    label:'Representation / partnership enquiries',
    confidence:'A'
  },
  {
    agencySlug:'gladiator-management-agency',
    publisher:'Gladiator Management Agency',
    url:'https://www.gladiatormgmtagency.com/contact',
    host:'www.gladiatormgmtagency.com',
    contactFormUrl:'https://www.gladiatormgmtagency.com/contact',
    contactKind:'contact_form',
    label:'Management contact form',
    confidence:'A'
  }
];

function clean(value){return String(value??'').replace(/\s+/g,' ').trim();}
export function normalizePublicEmail(value){return clean(value).replace(/^mailto:/i,'').split('?')[0].trim().toLowerCase();}

export function extractPublicEmails(html){
  const dom=new JSDOM(String(html||'')),doc=dom.window.document,seen=new Set(),out=[];
  const push=value=>{
    const email=normalizePublicEmail(value);
    if(!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)||seen.has(email))return;
    seen.add(email);out.push(email);
  };
  for(const anchor of doc.querySelectorAll('a[href^="mailto:" i]'))push(anchor.getAttribute('href'));
  const text=clean(doc.body?.textContent);
  for(const match of text.matchAll(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi))push(match[0]);
  dom.window.close();return out;
}

export function contactRowsFromOfficialPage(html,source){
  const rows=[],emails=extractPublicEmails(html);
  const dom=new JSDOM(String(html||'')),doc=dom.window.document;
  if(source.expectedEmail){
    const expected=normalizePublicEmail(source.expectedEmail);
    if(emails.includes(expected))rows.push({
      agency_slug:source.agencySlug,
      publisher:source.publisher,
      contact_kind:source.contactKind,
      contact_value:expected,
      label:source.label,
      source_url:source.url,
      source_type:'official_contact',
      confidence:source.confidence
    });
  }
  if(source.contactFormUrl){
    const url=new URL(source.contactFormUrl);
    const hasForm=Boolean(doc.querySelector('form'))&&Boolean(doc.querySelector('form input,form textarea,form select,form button'));
    if(url.protocol==='https:'&&url.hostname===source.host&&hasForm)rows.push({
      agency_slug:source.agencySlug,
      publisher:source.publisher,
      contact_kind:source.contactKind,
      contact_value:url.href,
      label:source.label,
      source_url:source.url,
      source_type:'official_contact',
      confidence:source.confidence
    });
  }
  dom.window.close();
  return rows;
}
