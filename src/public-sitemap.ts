import {sitemap as baseSitemap} from './seo.ts';

type Env={DB:D1Database;ASSETS:Fetcher;MODEL_VERSION:string};
const SITE='https://cagemetrix.com';
const extras=[
  `<url><loc>${SITE}/community</loc><changefreq>daily</changefreq><priority>0.8</priority></url>`,
  `<url><loc>${SITE}/forum</loc><changefreq>hourly</changefreq><priority>0.8</priority></url>`
];

export async function publicSitemap(env:Env){
  const response=await baseSitemap(env),text=await response.text();
  const missing=extras.filter(entry=>!text.includes(entry.match(/<loc>(.*?)<\/loc>/)?.[1]||''));
  const body=missing.length?text.replace('</urlset>',`${missing.map(v=>`  ${v}`).join('\n')}\n</urlset>`):text;
  const headers=new Headers(response.headers);headers.set('content-type','application/xml; charset=utf-8');headers.set('cache-control','public, max-age=900, s-maxage=3600');
  return new Response(body,{status:response.status,headers});
}
