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
  },
  {
    agencySlug:'dominance-mma',
    publisher:'Dominance MMA Management',
    url:'https://dominancemma.com/contact/',
    host:'dominancemma.com',
    contactFormUrl:'https://dominancemma.com/contact/',
    contactKind:'contact_form',
    label:'Agency contact form',
    confidence:'A'
  },
  {
    agencySlug:'ruby-sports-entertainment',
    publisher:'Ruby Sports & Entertainment',
    url:'https://www.rubyse.com/contact',
    host:'www.rubyse.com',
    contactFormUrl:'https://www.rubyse.com/contact',
    contactKind:'contact_form',
    label:'Management / sponsorship contact form',
    confidence:'A'
  },
  {
    agencySlug:'galaktik-sports',
    publisher:'Galaktik Sports',
    url:'https://galaktiksports.com/contact',
    host:'galaktiksports.com',
    expectedEmail:'javad@galaktiksports.com',
    contactKind:'general_email',
    label:'General agency contact',
    confidence:'A'
  },
  {
    agencySlug:'magnar-sports-entertainment',
    publisher:'Magnar Sports & Entertainment',
    url:'https://www.magnarse.com/contact/',
    host:'www.magnarse.com',
    expectedEmail:'info@magnarentertainment.com',
    contactKind:'general_email',
    label:'Athlete representation / business enquiries',
    confidence:'A'
  },
  {
    agencySlug:'goat-worldwide',
    publisher:'GOAT Worldwide',
    url:'https://goatworldwide.com/',
    host:'goatworldwide.com',
    contactFormUrl:'https://goatworldwide.com/',
    contactKind:'contact_form',
    label:'Agency contact form',
    confidence:'A'
  },
  {
    agencySlug:'tam-global',
    publisher:'TAM Global',
    url:'https://tamglobalmma.com/contact/',
    host:'tamglobalmma.com',
    contactFormUrl:'https://tamglobalmma.com/contact/',
    contactKind:'contact_form',
    label:'Agency contact form',
    confidence:'A'
  },
  {
    agencySlug:'hd-global-athlete-management',
    publisher:'HD Global Athlete Management',
    url:'https://hdglobalathlete.com/contact/',
    host:'hdglobalathlete.com',
    contactFormUrl:'https://hdglobalathlete.com/contact/',
    contactKind:'contact_form',
    label:'Agency contact form',
    confidence:'A'
  },
  {
    agencySlug:'3mgt-sports-media-management',
    publisher:'3MGT Sports and Media Management',
    url:'https://3mgt.de/',
    host:'3mgt.de',
    expectedEmail:'3mgt@3mgt.de',
    contactKind:'general_email',
    label:'General agency contact',
    confidence:'A'
  },
  {
    agencySlug:'burns-mma-agency',
    publisher:'Burns MMA Agency',
    url:'https://burns.agency/',
    host:'burns.agency',
    expectedEmail:'contact@burns.agency',
    contactKind:'general_email',
    label:'Athlete / manager / brand enquiries',
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
  const root=doc.body||doc.documentElement,walker=doc.createTreeWalker(root,dom.window.NodeFilter.SHOW_TEXT);
  while(walker.nextNode()){
    const text=String(walker.currentNode.nodeValue||'');
    for(const match of text.matchAll(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi))push(match[0]);
  }
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
