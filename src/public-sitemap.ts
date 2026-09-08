import {SITE_ORIGIN} from './brand.ts';

type Env={DB:D1Database;ASSETS:Fetcher;MODEL_VERSION:string};
type Row=Record<string,any>;
const SITE=SITE_ORIGIN;
const GLOBAL_MODEL='global-1.0.0';
const xml=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
const dateOnly=(v:unknown)=>/^\d{4}-\d{2}-\d{2}/.test(String(v||''))?String(v).slice(0,10):null;

type SitemapEntry=[loc:string,lastmod:string|null,changefreq:string,priority:string];

export async function publicSitemap(env:Env){
  const [fighters,events,fights,promotions,regionalFighters]=await Promise.all([
    env.DB.prepare(`SELECT slug,COALESCE(last_fight_date,updated_at) lastmod FROM fighters WHERE slug IS NOT NULL AND (active=1 OR ufc_bouts>0) ORDER BY id`).all<Row>(),
    env.DB.prepare(`SELECT DISTINCT e.slug,e.event_date FROM events e WHERE e.slug IS NOT NULL AND (e.promotion_slug IS NOT NULL OR EXISTS(SELECT 1 FROM bouts b JOIN predictions p ON p.bout_id=b.id WHERE b.event_id=e.id)) ORDER BY e.event_date DESC`).all<Row>(),
    env.DB.prepare(`SELECT DISTINCT b.id,e.event_date FROM bouts b JOIN events e ON e.id=b.event_id WHERE EXISTS(SELECT 1 FROM predictions p WHERE p.bout_id=b.id) ORDER BY e.event_date DESC,b.id`).all<Row>(),
    env.DB.prepare(`SELECT slug,verified_at FROM scout_promotions WHERE active=1 ORDER BY slug`).all<Row>(),
    env.DB.prepare(`SELECT p.profile_slug,p.last_fight_date FROM scout_active_global_profiles p JOIN scout_active_global_ratings r ON r.source_key=p.source_key AND r.snapshot_id=p.snapshot_id AND r.source_fighter_id=p.source_fighter_id AND r.model_version=? WHERE p.current_promotion_slug IS NOT NULL AND p.data_completeness>=60 AND r.evidence_strength>=40 AND p.last_fight_date>=date('now','-730 day') ORDER BY p.last_fight_date DESC`).bind(GLOBAL_MODEL).all<Row>()
  ]);
  const urls:SitemapEntry[]=[
    [`${SITE}/`,null,'daily','1.0'],
    [`${SITE}/scout`,null,'daily','0.95'],
    [`${SITE}/events`,null,'hourly','0.95'],
    [`${SITE}/promotions`,null,'daily','0.9'],
    [`${SITE}/predictions.html`,null,'hourly','0.9'],
    [`${SITE}/validation.html`,null,'weekly','0.6'],
    [`${SITE}/community`,null,'daily','0.5'],
    [`${SITE}/forum`,null,'hourly','0.5']
  ];
  for(const row of promotions.results||[])urls.push([`${SITE}/promotions/${encodeURIComponent(String(row.slug))}`,dateOnly(row.verified_at),'daily','0.82']);
  for(const row of regionalFighters.results||[])urls.push([`${SITE}/scout/fighters/${encodeURIComponent(String(row.profile_slug))}`,dateOnly(row.last_fight_date),'weekly','0.75']);
  for(const row of events.results||[])urls.push([`${SITE}/events/${encodeURIComponent(String(row.slug))}`,dateOnly(row.event_date),'daily','0.9']);
  for(const row of fights.results||[])urls.push([`${SITE}/fights/${row.id}`,dateOnly(row.event_date),'daily','0.8']);
  for(const row of fighters.results||[])urls.push([`${SITE}/fighters/${encodeURIComponent(String(row.slug))}`,dateOnly(row.lastmod),'weekly','0.7']);
  const body=`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([loc,lastmod,freq,priority])=>`  <url><loc>${xml(loc)}</loc>${lastmod?`<lastmod>${lastmod}</lastmod>`:''}<changefreq>${freq}</changefreq><priority>${priority}</url>`).join('\n')}\n</urlset>\n`;
  return new Response(body,{headers:{'content-type':'application/xml; charset=utf-8','cache-control':'public, max-age=900, s-maxage=3600','x-content-type-options':'nosniff'}});
}
