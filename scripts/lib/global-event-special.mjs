import { JSDOM } from 'jsdom';
import { dateFromText, parseLocation } from './global-event-sources.mjs';

const clean=value=>String(value??'').replace(/\s+/g,' ').trim();
const pad=value=>String(value).padStart(2,'0');

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
    const text=clean(anchor.textContent);
    const name=(alt.match(/^(?:XTB\s+)?KSW\s+\d+/i)||text.match(/(?:XTB\s+)?KSW\s+\d+/i))?.[0];
    if(!name)continue;
    const match=text.match(/\b(\d{2})-(\d{2})-(20\d{2})\b/);
    if(!match)continue;
    const eventDate=`${match[3]}-${match[2]}-${match[1]}`;
    const venueNodes=[...anchor.querySelectorAll('.col-sm-12.ps-5.text-uppercase')]
      .filter(node=>!node.querySelector('h2'));
    const venue=clean(venueNodes.at(-1)?.textContent);
    if(!venue)continue;
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
    case 'ksw': return parseKsw(html,source);
    case 'oktagon': return parseOktagon(html,source,now);
    case 'shooto': return parseShooto(html,source,now);
    default: return null;
  }
}
