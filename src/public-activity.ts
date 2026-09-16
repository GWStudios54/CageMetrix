import {BRAND_NAME,SITE_ORIGIN} from './brand.ts';
import {KIND,activityRow,activityRows} from './recruiting-activity.ts';

type Env={DB:D1Database;ASSETS:Fetcher;MODEL_VERSION:string};
const canonical=(path:string)=>`${SITE_ORIGIN}${path}`;
const escape=(value:unknown)=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]!));

const KIND_LABEL:Record<string,string>={
  all:'Everything',availability:'Free agency, release & expiration',contract:'Contract events',
  representation:'Representation changes',camp:'Camp/team changes',coach:'Coach changes',antidoping:'Anti-doping status',injury:'Injury & availability'
};

function shell(title:string,description:string,path:string,body:string){
  const url=canonical(path);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><meta name="description" content="${escape(description)}"><link rel="canonical" href="${escape(url)}"><meta name="robots" content="index,follow"><meta property="og:type" content="website"><meta property="og:site_name" content="${BRAND_NAME}"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:url" content="${escape(url)}"><meta property="og:image" content="${SITE_ORIGIN}/og.png"><meta name="twitter:card" content="summary_large_image"><link rel="icon" href="/logo.svg" type="image/svg+xml"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/scout-directory.css"><link rel="stylesheet" href="/talent.css"><link rel="stylesheet" href="/recruiting.css?v=1"></head><body><header class="topbar"><a class="brand" href="/" aria-label="${BRAND_NAME} home"><img class="brand-mark" src="/logo.svg" alt="" width="44" height="44"><span>${BRAND_NAME}</span></a></header><main class="scout-directory-main">${body}</main><footer><span>${BRAND_NAME}</span><span>The MMA research engine.</span></footer></body></html>`;
}

// Same published, human-reviewed facts already shown per-fighter on /scout/fighters/:slug via
// enhanceFighterContractContext/enhanceFighterCampContext/enhanceFighterAntidopingContext -- this is
// just the reverse view (chronological across every fighter) for someone who doesn't already know a
// name to look up. No discovery candidates, no admin-only fields, no watch button.
export async function publicActivityPage(request:Request,env:Env){
  const url=new URL(request.url);
  const kind=KIND.has(String(url.searchParams.get('kind')||'all'))?String(url.searchParams.get('kind')||'all'):'all';
  const rows=await activityRows(env,kind,75);
  const rowsHtml=rows.map(row=>activityRow(row,false)).join('');
  const body=`<section class="directory-hero"><span class="eyebrow">FIGHT WIRE</span><h1>Who just moved.</h1><p>A chronological feed of publicly reported contract, representation, training-camp and anti-doping changes across every fighter MMA Scouts tracks. New free agents, releases, signings, camp moves and anti-doping status -- sourced and dated, not rumor.</p></section>
  <section class="intel-filter-panel"><form method="get" action="/wire"><label>Show<select name="kind">${[...KIND].map(v=>`<option value="${escape(v)}"${kind===v?' selected':''}>${escape(KIND_LABEL[v]||v)}</option>`).join('')}</select></label><button class="button primary" type="submit">Filter feed</button></form></section>
  <section class="directory-roster"><div class="directory-section-head"><span class="eyebrow">RECENT ACTIVITY</span><h2>${rows.length} event${rows.length===1?'':'s'}</h2></div><p class="queue-note">Most recent first · publicly reported evidence only.</p><div class="activity-feed">${rowsHtml||'<p class="directory-empty">No publicly reported activity matches this filter yet.</p>'}</div></section>`;
  return new Response(shell('Fight Wire: Contract, Camp & Anti-Doping Activity | MMA Scouts','A chronological feed of publicly reported MMA contract, representation, training-camp and anti-doping changes, sourced and dated.','/wire',body),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'public, max-age=60, s-maxage=300'}});
}
