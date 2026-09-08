import { JSDOM } from 'jsdom';

export const GLOBAL_EVENT_SOURCES = [
  { slug:'pfl', name:'Professional Fighters League', url:'https://pflmma.com/events', title:/^PFL\b/i },
  { slug:'one', name:'ONE Championship', url:'https://www.onefc.com/events/', liveUrl:'https://live.onefc.com/', title:/^(?:ONE\b|The Inner Circle\b)/i },
  { slug:'rizin', name:'RIZIN Fighting Federation', url:'https://www.rizin.tv/', title:/RIZIN/i, defaultCountry:'Japan' },
  { slug:'oktagon', name:'OKTAGON MMA', url:'https://oktagonmma.com/en/events/', title:/^OKTAGON\b/i },
  { slug:'ksw', name:'KSW', url:'https://www.kswmma.com/en/events', title:/^(?:XTB\s+)?KSW\s+\d+/i },
  { slug:'cage-warriors', name:'Cage Warriors', url:'https://cagewarriors.com/cage-warriors-events/', title:/^(?:CW\s*\d+|CW\s+unplugged|CW\s+Manchester|Cage Warriors)/i },
  { slug:'lfa', name:'Legacy Fighting Alliance', url:'https://www.lfa.com/events/', title:/^LFA\s+\d+/i },
  { slug:'cffc', name:'Cage Fury Fighting Championships', url:'https://cffc.tv/', title:/^CFFC\s+\d+/i, defaultCountry:'United States', exclude:/\bBJJ\b/i },
  { slug:'fury-fc', name:'Fury Fighting Championship', url:'https://www.furyfc.tv/events', title:/^FURY\s+(?:FC|AS|CHALLENGER SERIES)\s*\d+/i, defaultCountry:'United States' }
];

const MONTHS = new Map([
  ['jan',1],['january',1],['feb',2],['february',2],['mar',3],['march',3],['apr',4],['april',4],['may',5],['jun',6],['june',6],['jul',7],['july',7],['aug',8],['august',8],['sep',9],['sept',9],['september',9],['oct',10],['october',10],['nov',11],['november',11],['dec',12],['december',12]
]);
const US_STATES = new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '));
const COUNTRY_ALIASES = new Map([
  ['usa','United States'],['us','United States'],['u.s.','United States'],['united states','United States'],
  ['ksa','Saudi Arabia'],['saudi arabia','Saudi Arabia'],['uae','United Arab Emirates'],['united arab emirates','United Arab Emirates'],
  ['uk','United Kingdom'],['united kingdom','United Kingdom'],['england','United Kingdom'],['scotland','United Kingdom'],['wales','United Kingdom'],
  ['czechy','Czech Republic'],['czech republic','Czech Republic'],['czechia','Czech Republic'],
  ['france','France'],['italy','Italy'],['ireland','Ireland'],['germany','Germany'],['poland','Poland'],['japan','Japan'],['brazil','Brazil'],['canada','Canada'],['singapore','Singapore'],['thailand','Thailand'],['croatia','Croatia'],['australia','Australia'],['new zealand','New Zealand']
]);

const clean = value => String(value ?? '').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
const key = value => clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const pad = value => String(value).padStart(2,'0');
const isoDate = (year,month,day) => `${year}-${pad(month)}-${pad(day)}`;
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));

function inferYear(month,day,now) {
  let year = now.getUTCFullYear();
  const candidate = Date.UTC(year,month-1,day,12);
  if (candidate < now.getTime()-45*86400000) year += 1;
  return year;
}

export function dateFromText(value, now=new Date()) {
  const text=clean(value);
  let match=text.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if(match){const out=isoDate(Number(match[1]),Number(match[2]),Number(match[3]));if(validDate(out))return out;}
  match=text.match(/\b(\d{1,2})[.](\d{1,2})[.](20\d{2})\b/);
  if(match){const out=isoDate(Number(match[3]),Number(match[2]),Number(match[1]));if(validDate(out))return out;}
  match=text.match(/\b(January|February|March|April|May|June|July|August|September|Sept|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,)?\s*(20\d{2})?\b/i);
  if(match){const month=MONTHS.get(match[1].toLowerCase()),day=Number(match[2]),year=match[3]?Number(match[3]):inferYear(month,day,now);const out=isoDate(year,month,day);if(validDate(out))return out;}
  match=text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|Sept|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*(20\d{2})?\b/i);
  if(match){const month=MONTHS.get(match[2].toLowerCase()),day=Number(match[1]),year=match[3]?Number(match[3]):inferYear(month,day,now);const out=isoDate(year,month,day);if(validDate(out))return out;}
  return null;
}

function sourceUrlFor(element,baseUrl) {
  const anchor=element.closest?.('a[href]') || element.querySelector?.('a[href]') || element.parentElement?.querySelector?.('a[href]');
  if(!anchor)return baseUrl;
  try { return new URL(anchor.getAttribute('href'),baseUrl).href.split('#')[0]; } catch { return baseUrl; }
}

function semanticLines(doc) {
  const selectors='h1,h2,h3,h4,h5,h6,p,time,address,li,article';
  const lines=[];
  for(const element of doc.querySelectorAll(selectors)) {
    const text=clean(element.textContent);
    if(!text || text.length>450)continue;
    if(lines.at(-1)!==text)lines.push(text);
  }
  return lines;
}

function nearestBlockText(element) {
  let current=element;
  for(let depth=0;current && depth<6;depth++,current=current.parentElement) {
    const text=clean(current.textContent);
    if(text.length>=20 && text.length<=2200 && dateFromText(text))return text;
  }
  return clean(element.parentElement?.textContent || element.textContent);
}

function countryName(raw) {
  const normalized=key(raw);
  return COUNTRY_ALIASES.get(normalized) || clean(raw) || null;
}

export function parseLocation(value, defaultCountry=null) {
  let text=clean(value).replace(/\s+[–—-]\s+/g,', ');
  text=text.replace(/^(?:venue|location)\s*:?\s*/i,'');
  if(!text)return {venue:null,city:null,region:null,country:defaultCountry};
  const parts=text.split(',').map(clean).filter(Boolean);
  let city=null,region=null,country=defaultCountry;
  if(parts.length>=2) {
    const last=parts.at(-1);
    if(US_STATES.has(last.toUpperCase())) {city=parts.at(-2);region=last.toUpperCase();country='United States';}
    else if(COUNTRY_ALIASES.has(key(last))) {country=countryName(last);city=parts.length>=2?parts.at(-2):null;}
    else {city=parts.at(-1);}
  }
  return {venue:text,city,region,country};
}

function probableVenue(line) {
  const text=clean(line);
  if(!text || dateFromText(text) || /\b(vs\.?|versus|buy|ticket|watch|more info|fightcard|results|schedule|prelims|main card|presented by|stream|live\/ppv)\b/i.test(text))return false;
  if(text.length<3 || text.length>150)return false;
  return /\b(arena|stadium|center|centre|casino|hotel|hall|pavilion|coliseum|dome|garden|park|bank|venues?|gymnasium|gin[aá]sio|pal[a-z]+|halle|forum|resort|base|rds|bec)\b/i.test(text) || /^[\p{L}.' -]+,\s*(?:[A-Z]{2}|[\p{L} .' -]+)$/u.test(text);
}

function venueNear(lines,index,title,date,defaultCountry) {
  for(let radius=1;radius<=12;radius++) {
    for(const pos of [index+radius,index-radius]) {
      if(pos<0||pos>=lines.length)continue;
      const line=lines[pos];
      if(line===title || dateFromText(line)!==null) {
        const stripped=clean(line.replace(/\b20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}(?:\s+\d{1,2}:\d{2}:\d{2})?\b/,'').replace(/\b\d{1,2}[.]\d{1,2}[.]20\d{2}\b/,'').replace(/\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s*/i,'').replace(/\b(?:January|February|March|April|May|June|July|August|September|Sept|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}(?:st|nd|rd|th)?(?:,)?\s*20\d{2}?\b/i,''));
        if(probableVenue(stripped))return parseLocation(stripped,defaultCountry);
        continue;
      }
      if(probableVenue(line))return parseLocation(line,defaultCountry);
    }
  }
  return {venue:null,city:null,region:null,country:defaultCountry};
}

function jsonLdNodes(value,out=[]) {
  if(Array.isArray(value)){for(const item of value)jsonLdNodes(item,out);return out;}
  if(!value || typeof value!=='object')return out;
  out.push(value);
  if(value['@graph'])jsonLdNodes(value['@graph'],out);
  return out;
}

function jsonLdEvents(doc,source,now) {
  const events=[];
  for(const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const parsed=JSON.parse(script.textContent||'null');
      for(const node of jsonLdNodes(parsed)) {
        const types=Array.isArray(node['@type'])?node['@type']:[node['@type']];
        if(!types.some(type=>/Event$/i.test(String(type||''))))continue;
        const name=clean(node.name);
        if(!name || !source.title.test(name) || source.exclude?.test(name))continue;
        const eventDate=dateFromText(node.startDate,now);
        if(!eventDate)continue;
        let venue=null,city=null,region=null,country=source.defaultCountry||null;
        const loc=Array.isArray(node.location)?node.location[0]:node.location;
        if(loc && typeof loc==='object') {
          venue=clean(loc.name) || null;
          if(typeof loc.address==='string')({city,region,country}=parseLocation(loc.address,country));
          else if(loc.address && typeof loc.address==='object') {
            city=clean(loc.address.addressLocality)||null;region=clean(loc.address.addressRegion)||null;country=countryName(loc.address.addressCountry)||country;
          }
        }
        events.push({promotionSlug:source.slug,promotionName:source.name,name,eventDate,startsAt:clean(node.startDate)||eventDate,venue,city,region,country,sourceUrl:clean(node.url)||source.url});
      }
    } catch { /* malformed third-party schema is not fatal */ }
  }
  return events;
}

function headingEvents(doc,source,now) {
  const lines=semanticLines(doc),events=[];
  const headings=[...doc.querySelectorAll('h1,h2,h3,h4,h5,h6,a')];
  for(const element of headings) {
    const name=clean(element.textContent);
    if(!name || name.length>110 || !source.title.test(name) || source.exclude?.test(name))continue;
    const block=nearestBlockText(element);
    const eventDate=dateFromText(block,now);
    if(!eventDate)continue;
    let index=lines.findIndex(line=>line===name);
    if(index<0)index=lines.findIndex(line=>line.includes(name));
    const loc=venueNear(lines,index,name,eventDate,source.defaultCountry||null);
    events.push({promotionSlug:source.slug,promotionName:source.name,name,eventDate,startsAt:eventDate,...loc,sourceUrl:sourceUrlFor(element,source.url)});
  }
  return events;
}

function bodyFallback(doc,source,now) {
  const lines=semanticLines(doc),events=[];
  for(let i=0;i<lines.length;i++) {
    const name=lines[i];
    if(name.length>110 || !source.title.test(name) || source.exclude?.test(name))continue;
    const context=lines.slice(Math.max(0,i-4),Math.min(lines.length,i+14)).join(' ');
    const eventDate=dateFromText(context,now);if(!eventDate)continue;
    const loc=venueNear(lines,i,name,eventDate,source.defaultCountry||null);
    events.push({promotionSlug:source.slug,promotionName:source.name,name,eventDate,startsAt:eventDate,...loc,sourceUrl:source.url});
  }
  return events;
}

function mergeEvents(events) {
  const map=new Map();
  const richness=e=>[e.venue,e.city,e.region,e.country,e.startsAt&&e.startsAt!==e.eventDate,e.sourceUrl].filter(Boolean).length;
  for(const event of events) {
    if(!event?.name || !event?.eventDate)continue;
    const id=`${event.promotionSlug}:${key(event.name)}:${event.eventDate}`;
    const current=map.get(id);
    if(!current || richness(event)>richness(current))map.set(id,event);
  }
  return [...map.values()].sort((a,b)=>a.eventDate.localeCompare(b.eventDate)||a.name.localeCompare(b.name));
}

function oneLiveEvents(html,now) {
  const doc=new JSDOM(html).window.document,lines=semanticLines(doc),events=[];
  for(let i=0;i<lines.length;i++) {
    const name=lines[i];
    if(!/^(?:ONE\b|The Inner Circle\b)/i.test(name) || name.length>110)continue;
    const context=lines.slice(i,Math.min(lines.length,i+5)).join(' ');
    const eventDate=dateFromText(context,now);if(!eventDate)continue;
    const timeMatch=context.match(/\b(\d{1,2}):(\d{2})\s*(AM|PM)\s*UTC\b/i);
    let startsAt=eventDate;
    if(timeMatch){let hour=Number(timeMatch[1])%12;if(timeMatch[3].toUpperCase()==='PM')hour+=12;startsAt=`${eventDate}T${pad(hour)}:${timeMatch[2]}:00Z`;}
    events.push({name,eventDate,startsAt});
  }
  return mergeEvents(events.map(e=>({promotionSlug:'one',promotionName:'ONE Championship',...e})));
}

export function parseOneEvents(eventsHtml,liveHtml,now=new Date()) {
  const source=GLOBAL_EVENT_SOURCES.find(s=>s.slug==='one');
  const listingDoc=new JSDOM(eventsHtml).window.document;
  const listings=mergeEvents([...jsonLdEvents(listingDoc,source,now),...headingEvents(listingDoc,source,now),...bodyFallback(listingDoc,source,now)]);
  const listingLines=semanticLines(listingDoc);
  const venueRecords=[];
  for(let i=0;i<listingLines.length;i++) {
    const name=listingLines[i];if(!source.title.test(name)||name.length>120)continue;
    const loc=venueNear(listingLines,i,name,null,null);
    venueRecords.push({name,...loc});
  }
  const live=oneLiveEvents(liveHtml,now);
  for(const event of live) {
    const eventKey=key(event.name);
    const match=venueRecords.find(v=>key(v.name).includes(eventKey)||eventKey.includes(key(v.name))) || listings.find(v=>key(v.name).includes(eventKey)||eventKey.includes(key(v.name)));
    if(match){event.name=match.name||event.name;event.venue=match.venue||event.venue||null;event.city=match.city||event.city||null;event.region=match.region||event.region||null;event.country=match.country||event.country||null;event.sourceUrl=match.sourceUrl||source.url;}
    else event.sourceUrl=source.liveUrl;
  }
  return mergeEvents([...listings,...live]);
}

export function parsePromotionEvents(source,html,now=new Date()) {
  if(source.slug==='one')throw new Error('Use parseOneEvents for ONE Championship');
  const doc=new JSDOM(html).window.document;
  return mergeEvents([...jsonLdEvents(doc,source,now),...headingEvents(doc,source,now),...bodyFallback(doc,source,now)]);
}

export function eventSlug(event) {
  const stem=key(event.name).replace(/\s+/g,'-').slice(0,110) || 'event';
  return `${event.promotionSlug}-${stem}-${event.eventDate}`.replace(/-+/g,'-').replace(/^-|-$/g,'').slice(0,180);
}

export function usableUpcomingEvents(events,now=new Date()) {
  const min=new Date(now.getTime()-3*86400000).toISOString().slice(0,10);
  const max=new Date(now.getTime()+540*86400000).toISOString().slice(0,10);
  return mergeEvents(events).filter(event=>event.eventDate>=min && event.eventDate<=max && event.venue);
}
