type Env={DB:D1Database;ASSETS:Fetcher;MODEL_VERSION:string};
type Row=Record<string,any>;
const SITE='https://cagemetrix.com';
const xml=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
const dateOnly=(v:unknown)=>/^\d{4}-\d{2}-\d{2}/.test(String(v||''))?String(v).slice(0,10):null;

type SitemapEntry=[loc:string,lastmod:string|null,changefreq:string,priority:string];

export async function publicSitemap(env:Env){
  const [fighters,events,fights]=await Promise.all([
    env.DB.prepare(`SELECT slug,COALESCE(last_fight_date,updated_at) lastmod FROM fighters WHERE slug IS NOT NULL AND (active=1 OR ufc_bouts>0) ORDER BY id`).all<Row>(),
    env.DB.prepare(`SELECT DISTINCT e.slug,e.event_date FROM events e WHERE e.slug IS NOT NULL AND EXISTS(SELECT 1 FROM bouts b JOIN predictions p ON p.bout_id=b.id WHERE b.event_id=e.id) ORDER BY e.event_date DESC`).all<Row>(),
    env.DB.prepare(`SELECT DISTINCT b.id,e.event_date FROM bouts b JOIN events e ON e.id=b.event_id WHERE EXISTS(SELECT 1 FROM predictions p WHERE p.bout_id=b.id) ORDER BY e.event_date DESC,b.id`).all<Row>()
  ]);
  const urls:SitemapEntry[]=[
    [`${SITE}/`,null,'daily','1.0'],
    [`${SITE}/predictions.html`,null,'hourly','0.9'],
    [`${SITE}/validation.html`,null,'weekly','0.6'],
    [`${SITE}/community`,null,'daily','0.8'],
    [`${SITE}/forum`,null,'hourly','0.8']
  ];
  for(const row of events.results||[])urls.push([`${SITE}/events/${encodeURIComponent(String(row.slug))}`,dateOnly(row.event_date),'daily','0.9']);
  for(const row of fights.results||[])urls.push([`${SITE}/fights/${row.id}`,dateOnly(row.event_date),'daily','0.8']);
  for(const row of fighters.results||[])urls.push([`${SITE}/fighters/${encodeURIComponent(String(row.slug))}`,dateOnly(row.lastmod),'weekly','0.7']);
  const body=`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([loc,lastmod,freq,priority])=>`  <url><loc>${xml(loc)}</loc>${lastmod?`<lastmod>${lastmod}</lastmod>`:''}<changefreq>${freq}</changefreq><priority>${priority}</priority></url>`).join('\n')}\n</urlset>\n`;
  return new Response(body,{headers:{'content-type':'application/xml; charset=utf-8','cache-control':'public, max-age=900, s-maxage=3600','x-content-type-options':'nosniff'}});
}
