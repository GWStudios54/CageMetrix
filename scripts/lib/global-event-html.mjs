import { JSDOM } from 'jsdom';

const CALENDAR_ROOTS=new Map([
  ['pfl','#nav-upcoming']
]);

export function scopePromotionHtml(source,html){
  const selector=CALENDAR_ROOTS.get(source?.slug);
  if(!selector)return html;
  const doc=new JSDOM(html).window.document;
  return doc.querySelector(selector)?.outerHTML||html;
}
