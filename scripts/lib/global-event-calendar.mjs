import { usableUpcomingEvents as rawUsableUpcomingEvents } from './global-event-sources.mjs';

const clean=value=>String(value??'').replace(/\s+/g,' ').trim();
const key=value=>clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();

function detailScore(url){
  try{return new URL(url).pathname.split('/').filter(Boolean).length;}catch{return 0;}
}
function richness(event){
  return [event.venue,event.city,event.region,event.country,event.startsAt&&event.startsAt!==event.eventDate].filter(Boolean).length;
}
function mergePair(a,b){
  const aName=key(a.name),bName=key(b.name);
  const shorter=aName.length<=bName.length?a:b,longer=shorter===a?b:a;
  const base=(aName===bName || aName.startsWith(bName) || bName.startsWith(aName))?shorter:(richness(a)>=richness(b)?a:b);
  const other=base===a?b:a;
  return {
    ...base,
    venue:base.venue||other.venue||null,
    city:base.city||other.city||null,
    region:base.region||other.region||null,
    country:base.country||other.country||null,
    startsAt:(base.startsAt&&base.startsAt!==base.eventDate)?base.startsAt:((other.startsAt&&other.startsAt!==other.eventDate)?other.startsAt:(base.startsAt||other.startsAt||base.eventDate)),
    sourceUrl:detailScore(base.sourceUrl)>=detailScore(other.sourceUrl)?base.sourceUrl:other.sourceUrl
  };
}

export function collapseCalendarEvents(events){
  const kept=[];
  for(const event of events){
    const eventName=key(event.name);
    const index=kept.findIndex(current=>current.promotionSlug===event.promotionSlug && current.eventDate===event.eventDate && (key(current.name)===eventName || key(current.name).startsWith(eventName) || eventName.startsWith(key(current.name))));
    if(index<0)kept.push(event);
    else kept[index]=mergePair(kept[index],event);
  }
  return kept.sort((a,b)=>a.eventDate.localeCompare(b.eventDate)||a.name.localeCompare(b.name));
}

export function usableUpcomingEvents(events,now=new Date()){
  return collapseCalendarEvents(rawUsableUpcomingEvents(events,now));
}
