import { JSDOM } from 'jsdom';
import { dateFromText, parseLocation } from './global-event-sources.mjs';

const clean=value=>String(value??'').replace(/\s+/g,' ').trim();
const pad=value=>String(value).padStart(2,'0');

function absoluteUrl(anchor,fallback){
  const href=anchor?.getAttribute?.('href');
  if(!href)return fallback;
  try{return new URL(href,fallback).href.split('#')[0];}catch{return fallback;}
}

function fixedJapaneseDate(text,year){
  const match=clean(text).match(/(\d{1,2})月\s*(\d{1,2})日/);
  if(!match)return null;
  const month=Number(match[1]),day=Number(match[2]);
  const out=`${year}-${pad(month)}-${pad(day)}`;
  return Number.isNaN(Date.parse(`${out}T12:00:00Z`))?null:out;
}

function parsePfl(html,source,now){
  const doc=new JSDOM(html).window.document;
  const root=doc.querySelector('#nav-upcoming')||doc;
  const events=[];
  for(const card of root.querySelectorAll('.event-card-info')){
    const name=clean(card.querySelector('h3')?.textContent);
    const rawDate=clean(card.querySelector('h6')?.textContent);
    const location=clean(card.querySelector('p.mb-4')?.textContent);
    const eventDate=dateFromText(rawDate,now);
    if(!name||!/^PFL\b/i.test(name)||!eventDate||!location)continue;
    let loc=parseLocation(location);
    if(/morocco/i.test(name)){loc={venue:location,city:'Casablanca',region:null,country:'Morocco'};}
    else if(/chicago/i.test(name)){loc={venue:location,city:'Chicago',region:'Illinois',country:'United States'};}
    const hub=card.closest('.event-hub')||card.parentElement;
    const detail=[...(hub?.querySelectorAll('a[href]')||[])].find(anchor=>/pflmma\.com\/event\//i.test(anchor.href));
    events.push({promotionSlug:source.slug,promotionName:source.name,name,eventDate,startsAt:eventDate,...loc,sourceUrl:absoluteUrl(detail,source.url)});
  }
  return events;
}

function parseRizin(html,source,now){
  const doc=new JSDOM(html).window.document;
  const hero=doc.querySelector('.event-scoreboard__hero');
  if(!hero)return [];
  const name=clean(hero.querySelector('.event-scoreboard__summary h2')?.textContent||hero.querySelector('h2')?.textContent);
  const timeText=clean(hero.querySelector('.event-scoreboard__facts time')?.textContent||hero.querySelector('time')?.textContent);
  const eventDate=dateFromText(timeText,now);
  let venue='';
  for(const row of hero.querySelectorAll('.event-scoreboard__facts > div')){
    const label=clean(row.querySelector('dt')?.textContent);
    if(/^VENUE$/i.test(label)){venue=clean(row.querySelector('dd')?.textContent);break;}
  }
  if(!name||!eventDate||!venue)return [];
  const city=/OSAKA/i.test(venue)?'Osaka':null;
  return [{promotionSlug:source.slug,promotionName:source.name,name,eventDate,startsAt:eventDate,venue,city,region:null,country:'Japan',sourceUrl:source.url}];
}

function tuffEventYear(article,href,now){
  const text=clean(article.textContent);
  const explicit=text.match(/\b(20\d{2})\b/)?.[1]||String(href||'').match(/\/(20\d{2})\//)?.[1];
  const monthDay=text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?/i)?.[0];
  if(explicit&&monthDay)return dateFromText(`${monthDay}, ${explicit}`,now);
  return dateFromText(text,now);
}

function tuffVenue(text){
  const patterns=[
    /brings[^.]{0,120}?\bto\s+(?:the\s+)?([^.,]{3,100})(?:\.|,|$)/i,
    /returns?\s+to\s+(?:the\s+)?(.{3,120}?)\s+on\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i,
    /at\s+(?:the\s+)?(.{3,120}?)\s+on\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i
  ];
  for(const pattern of patterns){const match=clean(text).match(pattern);if(match)return clean(match[1]);}
  return null;
}

function parseTuff(html,source,now){
  const doc=new JSDOM(html).window.document;
  const events=[];
  for(const article of doc.querySelectorAll('article.elementor-post, article')){
    const heading=article.querySelector('h2, h3');
    const name=clean(heading?.textContent);
    if(!/^Tuff-N-Uff\s+\d+$/i.test(name))continue;
    const detail=heading?.querySelector('a[href]')||article.querySelector('a[href]');
    const sourceUrl=absoluteUrl(detail,source.url);
    const eventDate=tuffEventYear(article,sourceUrl,now);
    const venue=tuffVenue(article.textContent);
    if(!eventDate||!venue)continue;
    events.push({promotionSlug:source.slug,promotionName:source.name,name,eventDate,startsAt:eventDate,venue,city:/las vegas/i.test(venue)?'Las Vegas':null,region:/las vegas/i.test(venue)?'Nevada':null,country:'United States',sourceUrl});
  }
  return events;
}

function cageWarriorsPlace(name,venue){
  if(/dublin/i.test(name)||/RDS/i.test(venue))return {city:'Dublin',region:null,country:'Ireland'};
  if(/rome/i.test(name)||/palapellicone/i.test(venue))return {city:'Rome',region:null,country:'Italy'};
  if(/manchester|unplugged/i.test(name)||/BEC Arena/i.test(venue))return {city:'Manchester',region:'England',country:'United Kingdom'};
  return {city:null,region:null,country:null};
}

function parseCageWarriors(html,source,now){
  const doc=new JSDOM(html).window.document;
  const events=[];
  for(const heading of doc.querySelectorAll('h3')){
    const name=clean(heading.textContent);
    if(!/^(?:CW\s*\d+|CW\s+unplugged|CW\s+Manchester)/i.test(name))continue;
    const column=heading.closest('.et_pb_column_1_2')||heading.parentElement?.parentElement?.parentElement;
    if(!column)continue;
    const info=[...column.querySelectorAll('.et_pb_text_inner')].map(node=>clean(node.textContent)).find(text=>dateFromText(text,now));
    const eventDate=dateFromText(info,now);if(!eventDate)continue;
    let venue=clean(String(info||'').split('').at(-1));
    if(venue===info){
      venue=clean(String(info||'').replace(/^.*?20\d{2}/,'').replace(/^[^\p{L}\d]+/u,''));
    }
    if(!venue)continue;
    const detail=[...column.querySelectorAll('a[href]')].find(anchor=>/MORE INFO/i.test(clean(anchor.textContent)))||column.querySelector('a[href]');
    events.push({promotionSlug:source.slug,promotionName:source.name,name,eventDate,startsAt:eventDate,venue,...cageWarriorsPlace(name,venue),sourceUrl:absoluteUrl(detail,source.url)});
  }
  return events;
}

function parseDeepDetail(html,source,now){
  if(source.detailUrlPattern)return null;
  const doc=new JSDOM(html).window.document;
  const name=clean(doc.querySelector('h1')?.textContent);
  if(!/^DEEP\b/i.test(name))return [];
  const paragraphs=[...doc.querySelectorAll('p')].map(node=>clean(node.textContent)).filter(Boolean);
  const intro=paragraphs.find(text=>dateFromText(text,now)&&text.includes(name))||'';
  const dateLine=paragraphs.find(text=>/^●?\s*日時[:：]/.test(text))||intro;
  const venueLine=paragraphs.find(text=>/^●?\s*会場[:：]/.test(text));
  const eventDate=dateFromText(dateLine,now);
  let venue=clean(String(venueLine||'').replace(/^●?\s*会場[:：]\s*/, '').replace(/[（(].*$/,'').trim());
  if(!venue&&intro){
    venue=clean(intro.match(/に(.{2,140}?)で開催する/)?.[1]);
  }
  if(!eventDate||!venue)return [];
  return [{promotionSlug:source.slug,promotionName:source.name,name,eventDate,startsAt:eventDate,venue,city:null,region:null,country:'Japan',sourceUrl:source.url}];
}

function parsePancraseDetail(html,source,now){
  if(source.detailUrlPattern)return null;
  const doc=new JSDOM(html).window.document;
  const name=clean(doc.querySelector('h1')?.textContent);
  if(!/^PANCRASE\s+\d+/i.test(name))return [];
  const body=clean(doc.body?.textContent);
  const dateMatch=body.match(/日\s*時[:：]\s*([^会]{2,80})/);
  const eventDate=dateFromText(dateMatch?.[1]||body,now);
  let venue='';
  for(const anchor of doc.querySelectorAll('a[href]')){
    const previous=clean(anchor.previousSibling?.textContent);
    if(/会\s*場[:：]/.test(previous)){venue=clean(anchor.textContent);break;}
  }
  if(!venue){venue=clean(body.match(/会\s*場[:：]\s*(.{2,80}?)(?:交\s*通|住\s*所|主\s*催|$)/)?.[1]);}
  if(!eventDate||!venue)return [];
  return [{promotionSlug:source.slug,promotionName:source.name,name,eventDate,startsAt:eventDate,venue,city:null,region:null,country:'Japan',sourceUrl:source.url}];
}

function parseGrachan(html,source){
  const doc=new JSDOM(html).window.document;
  const year=Number(String(source.url).match(/plans(20\d{2})/)?.[1]);
  if(!year)return [];
  const events=[];
  for(const row of doc.querySelectorAll('tr')){
    const cells=[...row.querySelectorAll('th,td')].map(node=>clean(node.textContent));
    const name=cells.find(value=>/^GRACHAN\s*\d+$/i.test(value));
    if(!name)continue;
    const dateCell=cells.find(value=>/\d{1,2}月\s*\d{1,2}日/.test(value));
    const eventDate=fixedJapaneseDate(dateCell,year);
    const location=cells.find(value=>value!==name&&value!==dateCell&&value)||'';
    if(!eventDate||!location)continue;
    const loc=parseLocation(location,'Japan');
    events.push({promotionSlug:source.slug,promotionName:source.name,name,eventDate,startsAt:eventDate,...loc,sourceUrl:source.url});
  }
  return events;
}

export function parseExtendedPromotion(source,html,now=new Date()){
  switch(source?.slug){
    case 'pfl': return parsePfl(html,source,now);
    case 'rizin': return parseRizin(html,source,now);
    case 'tuff-n-uff': return parseTuff(html,source,now);
    case 'cage-warriors': return parseCageWarriors(html,source,now);
    case 'deep': return parseDeepDetail(html,source,now);
    case 'pancrase': return parsePancraseDetail(html,source,now);
    case 'grachan': return parseGrachan(html,source);
    default: return null;
  }
}
