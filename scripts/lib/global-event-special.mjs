import { JSDOM } from 'jsdom';
import { dateFromText, parseLocation } from './global-event-sources.mjs';

const clean=value=>String(value??'').replace(/\s+/g,' ').trim();
function textWithBreaks(element){
  if(!element)return '';
  const clone=element.cloneNode(true);
  for(const br of clone.querySelectorAll?.('br')||[])br.replaceWith(' ');
  return clean(clone.textContent);
}

function countryHint(location,slug){
  const text=clean(location).toLowerCase();
  if(slug==='one'){
    if(/bangkok|lumpinee/.test(text))return 'Thailand';
    if(/yokohama|tokyo|japan/.test(text))return 'Japan';
    if(/singapore/.test(text))return 'Singapore';
  }
  if(slug==='ksw'){
    if(/liberec|czech/.test(text))return 'Czech Republic';
    if(/szczecin|rzesz|radom|gdynia|kalisz|poland/.test(text))return 'Poland';
  }
  return null;
}

function withCountry(location,slug){
  const hint=countryHint(location,slug);
  return parseLocation(location,hint);
}

function parseOne(html){
  const doc=new JSDOM(html).window.document;
  const template=doc.querySelector('template#events-upcoming');
  const root=template?.content||template||doc;
  const events=[];
  for(const card of root.querySelectorAll('li.menu-item-card')){
    const anchor=card.querySelector('a[href]');
    const name=clean(card.querySelector('.title')?.textContent);
    const location=clean(card.querySelector('.location')?.textContent);
    const timestamp=Number(card.querySelector('.datetime[data-timestamp]')?.getAttribute('data-timestamp'));
    if(!name||!location||!Number.isFinite(timestamp)||timestamp<=0)continue;
    const startsAt=new Date(timestamp*1000).toISOString();
    const eventDate=startsAt.slice(0,10);
    events.push({
      promotionSlug:'one',promotionName:'ONE Championship',name,eventDate,startsAt,
      ...withCountry(location,'one'),sourceUrl:anchor?.href||'https://www.onefc.com/events/'
    });
  }
  return events;
}

function parseKsw(html,source){
  const doc=new JSDOM(html).window.document;
  const events=[];
  for(const anchor of doc.querySelectorAll('a[href*="/event/"]')){
    const alt=clean(anchor.querySelector('img[alt]')?.getAttribute('alt'));
    const pieces=[...anchor.querySelectorAll('*')].map(element=>textWithBreaks(element)).filter(Boolean);
    const name=(alt.match(/^(?:XTB\s+)?KSW\s+\d+/i)||pieces.map(value=>value.match(/(?:XTB\s+)?KSW\s+\d+/i)).find(Boolean))?.[0];
    if(!name)continue;
    const dateText=pieces.find(value=>/^\d{2}-\d{2}-20\d{2}$/.test(value));
    const match=dateText?.match(/^(\d{2})-(\d{2})-(20\d{2})$/);
    if(!match)continue;
    const eventDate=`${match[3]}-${match[2]}-${match[1]}`;
    const venueNodes=[...anchor.querySelectorAll('.col-sm-12.ps-5.text-uppercase')].filter(node=>!node.querySelector('h2'));
    const rows=[...anchor.children].filter(element=>element.classList?.contains('row'));
    const venue=textWithBreaks(venueNodes.at(-1))||textWithBreaks(rows.at(-1));
    if(!venue||/\bvs\b/i.test(venue))continue;
    events.push({
      promotionSlug:source.slug,promotionName:source.name,name:clean(name),eventDate,startsAt:eventDate,
      ...withCountry(venue,'ksw'),sourceUrl:anchor.href||source.url
    });
  }
  return events;
}

function parseOktagon(html,source,now){
  const doc=new JSDOM(html).window.document;
  const events=[];
  for(const card of doc.querySelectorAll('.okt-future-events-card')){
    const name=clean(card.querySelector('.okt-card-title')?.textContent);
    if(!name||!source.title.test(name))continue;
    const subtitles=[...card.querySelectorAll('.okt-card-subTitle')].map(node=>clean(node.textContent)).filter(Boolean);
    const eventDate=dateFromText(subtitles[0]||clean(card.textContent),now);
    const venue=subtitles.find(value=>value!==subtitles[0]&&dateFromText(value,now)===null)||null;
    if(!eventDate||!venue)continue;
    const detail=[...card.querySelectorAll('a[href]')].map(a=>a.href).find(url=>/\/events\/oktagon-\d+\/?$/i.test(url));
    events.push({
      promotionSlug:source.slug,promotionName:source.name,name,eventDate,startsAt:eventDate,
      ...parseLocation(venue),sourceUrl:detail||source.url
    });
  }
  return events;
}

function cffcVenueFromTicket(href,location){
  const value=clean(href).toLowerCase();
  if(value.includes('hard-rock-live-casino-rockford'))return 'Hard Rock Live Casino Rockford';
  if(value.includes('hard-rock-hotel-casino-bristol'))return 'Hard Rock Hotel & Casino Bristol';
  return location;
}

function stripNamedDate(value){
  return clean(value.replace(/\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s*/gi,'')
    .replace(/\b(?:January|February|March|April|May|June|July|August|September|Sept|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}(?:st|nd|rd|th)?(?:,)?\s*(?:20\d{2})?/gi,''));
}

function parseCffc(html,source,now){
  const doc=new JSDOM(html).window.document;
  const events=[];
  for(const heading of doc.querySelectorAll('h3')){
    const name=clean(heading.textContent);
    if(!/^CFFC\s+\d+$/i.test(name))continue;
    const column=heading.closest('.sqs-col-6')||heading.parentElement?.parentElement||heading.parentElement;
    const details=textWithBreaks(column?.querySelector('h2'));
    const eventDate=dateFromText(details,now);if(!eventDate)continue;
    const location=stripNamedDate(details);
    if(!location)continue;
    const ticket=column?.querySelector('a[href*="/tickets/"]');
    const sourceUrl=ticket?.href||source.url;
    const loc=parseLocation(location,'United States');
    loc.venue=cffcVenueFromTicket(sourceUrl,location);
    events.push({promotionSlug:source.slug,promotionName:source.name,name,eventDate,startsAt:eventDate,...loc,sourceUrl});
  }
  return events;
}

function parseFnc(html,source,now){
  const doc=new JSDOM(html).window.document;
  const section=doc.querySelector('section.upcomingEvent');
  if(!section)return [];
  const name=clean(section.querySelector('.fight-details .title-wrap h2')?.textContent);
  const detailText=clean(section.querySelector('.fight-details .title-wrap p')?.textContent);
  const eventDate=dateFromText(detailText,now);
  if(!name||!eventDate)return [];
  const city=clean(name.split('|').at(-1))||null;
  const pageText=clean(doc.body?.textContent);
  const venueMatch=pageText.match(/\bcoming to\s+([^,.]{3,80})\s+on\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}/i);
  const venue=clean(venueMatch?.[1])||city;
  if(!venue)return [];
  const detail=section.querySelector('a[href*="/event/"]');
  return [{
    promotionSlug:source.slug,promotionName:source.name,name,eventDate,startsAt:eventDate,
    venue,city,region:null,country:'Croatia',sourceUrl:detail?.href||source.url
  }];
}

function shootoLocation(row,descriptor){
  const explicit=clean(row.querySelector('.result-list-place')?.textContent);
  if(explicit)return explicit;
  return clean(descriptor.replace(/\s*(?:主催|Organizer)\s*[:：].*$/i,'').replace(/^\s*[|｜:：-]+|[|｜:：-]+\s*$/g,''));
}

function parseShooto(html,source,now){
  const doc=new JSDOM(html).window.document;
  const events=[];
  for(const row of doc.querySelectorAll('#schedule .row.list-block')){
    const rawDate=clean(row.querySelector('.result-list-day')?.textContent);
    const eventDate=dateFromText(rawDate,now);if(!eventDate)continue;
    const anchor=row.querySelector('a[href*="id="]');
    const descriptor=clean(anchor?.textContent);
    if(!descriptor)continue;
    const venueText=shootoLocation(row,descriptor);
    if(!venueText)continue;
    const explicit=descriptor.match(/(?:PROFESSIONAL SHOOTO[^|｜]{0,100}|プロフェッショナル修斗[^|｜]{0,100})/i)?.[0];
    const loc=parseLocation(venueText,'Japan');
    const name=clean(explicit||`Shooto ${eventDate}${loc.city?` — ${loc.city}`:''}`);
    events.push({
      promotionSlug:source.slug,promotionName:source.name,name,eventDate,startsAt:eventDate,
      ...loc,sourceUrl:anchor?.href||source.url
    });
  }
  return events;
}

export function parseSpecialPromotion(source,html,now=new Date()){
  switch(source?.slug){
    case 'one': return parseOne(html);
    case 'cffc': return parseCffc(html,source,now);
    case 'ksw': return parseKsw(html,source);
    case 'oktagon': return parseOktagon(html,source,now);
    case 'fnc': return parseFnc(html,source,now);
    case 'shooto': return parseShooto(html,source,now);
    default: return null;
  }
}
