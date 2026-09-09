import {SITE_ORIGIN} from './brand.ts';

type Env={DB:D1Database;ASSETS:Fetcher;MODEL_VERSION:string};
type Row=Record<string,any>;
const SITE=SITE_ORIGIN;
const xml=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
const dateOnly=(v:unknown)=>/^\d{4}-\d{2}-\d{2}/.test(String(v||''))?String(v).slice(0,10):null;

type SitemapEntry=[loc:string,lastmod:string|null,changefreq:string,priority:string];

export async function publicSitemap(env:Env){
  const [fighters,events,promotions,scoutFighters,agencies]=await Promise.all([
    env.DB.prepare(`SELECT f.slug,COALESCE(f.last_fight_date,f.updated_at) lastmod FROM fighters f WHERE f.slug IS NOT NULL AND (f.active=1 OR f.ufc_bouts>0) AND NOT EXISTS(SELECT 1 FROM mma_identity_links l JOIN fighter_publication_controls c ON c.source_key=l.source_key AND c.source_fighter_id=l.source_fighter_id AND c.public_status='removed' WHERE CAST(l.cagemetrix_fighter_id AS INTEGER)=f.id AND l.confidence>=0.90) ORDER BY f.id`).all<Row>(),
    env.DB.prepare(`SELECT DISTINCT e.slug,e.event_date FROM events e WHERE e.slug IS NOT NULL AND (e.promotion_slug IS NOT NULL OR e.promotion='UFC' OR EXISTS(SELECT 1 FROM bouts b WHERE b.event_id=e.id)) ORDER BY e.event_date DESC`).all<Row>(),
    env.DB.prepare(`SELECT slug,verified_at FROM scout_promotions WHERE active=1 ORDER BY slug`).all<Row>(),
    env.DB.prepare(`SELECT p.profile_slug,p.last_fight_date,p.updated_at FROM scout_public_global_profiles p WHERE p.profile_slug IS NOT NULL AND p.profile_slug<>'' AND p.career_bouts>=1 AND p.data_completeness>=35 ORDER BY COALESCE(p.last_fight_date,'') DESC,p.profile_slug`).all<Row>(),
    env.DB.prepare(`SELECT slug,COALESCE(verified_at,updated_at) lastmod FROM management_agencies WHERE active=1 ORDER BY slug`).all<Row>()
  ]);
  const urls:SitemapEntry[]=[
    [`${SITE}/`,null,'daily','1.0'],
    [`${SITE}/scout`,null,'daily','0.95'],
    [`${SITE}/prospects`,null,'daily','0.96'],
    [`${SITE}/talent`,null,'daily','0.95'],
    [`${SITE}/events`,null,'hourly','0.95'],
    [`${SITE}/promotions`,null,'daily','0.9'],
    [`${SITE}/management`,null,'daily','0.9'],
    [`${SITE}/data-policy`,null,'monthly','0.55'],
    [`${SITE}/privacy`,null,'monthly','0.5']
  ];
  for(const row of agencies.results||[])urls.push([`${SITE}/management/${encodeURIComponent(String(row.slug))}`,dateOnly(row.lastmod),'weekly','0.84']);
  for(const row of promotions.results||[])urls.push([`${SITE}/promotions/${encodeURIComponent(String(row.slug))}`,dateOnly(row.verified_at),'daily','0.85']);
  for(const row of scoutFighters.results||[])urls.push([`${SITE}/scout/fighters/${encodeURIComponent(String(row.profile_slug))}`,dateOnly(row.last_fight_date||row.updated_at),'weekly','0.82']);
  for(const row of events.results||[])urls.push([`${SITE}/events/${encodeURIComponent(String(row.slug))}`,dateOnly(row.event_date),'daily','0.88']);
  for(const row of fighters.results||[])urls.push([`${SITE}/fighters/${encodeURIComponent(String(row.slug))}`,dateOnly(row.lastmod),'weekly','0.75']);
  const body=`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([loc,lastmod,freq,priority])=>`  <url><loc>${xml(loc)}</loc>${lastmod?`<lastmod>${lastmod}</lastmod>`:''}<changefreq>${freq}</changefreq><priority>${priority}</url>`).join('\n')}\n</urlset>\n`;
  return new Response(body,{headers:{'content-type':'application/xml; charset=utf-8','cache-control':'public, max-age=900, s-maxage=3600','x-content-type-options':'nosniff'}});
}
