import {canonicalRedirect,enhanceFightSearchSnippet} from './search-ctr.ts';

type Env={DB:D1Database;ASSETS:Fetcher;MODEL_VERSION:string};
type Row=Record<string,any>;
const SESSION_COOKIE='cm_session';

const cookieValue=(request:Request,name:string)=>{const raw=request.headers.get('cookie')||'';return raw.split(';').map(v=>v.trim()).find(v=>v.startsWith(`${name}=`))?.slice(name.length+1)||null;};
async function hash(value:string){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');}
async function isAdmin(request:Request,db:D1Database){
  const raw=cookieValue(request,SESSION_COOKIE);if(!raw||raw.length<30)return false;
  const row=await db.prepare(`SELECT a.id FROM community_sessions s JOIN community_accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>CURRENT_TIMESTAMP AND a.role='admin' LIMIT 1`).bind(await hash(raw)).first<Row>();
  return !!row;
}

export function primaryNavigation(admin=false){
  return `<a href="/predictions.html">Predictions</a><a href="/#rankings">Rankings</a><a href="/forum">Forum</a><a href="/watchlist">Watchlist</a><a href="/community">Community</a>${admin?'<a href="/admin" class="admin-link">Admin</a>':''}`;
}

export async function normalizeNavigation(response:Response,request:Request,env:Env){
  const redirect=canonicalRedirect(request);if(redirect)return redirect;
  if(!response.headers.get('content-type')?.includes('text/html'))return response;
  const fight=request.method==='GET'?new URL(request.url).pathname.match(/^\/fights\/([1-9]\d*)\/?$/):null;
  if(fight)response=await enhanceFightSearchSnippet(response,env,fight[1]);
  const admin=await isAdmin(request,env.DB),nav=`<nav class="global-nav" aria-label="Primary">${primaryNavigation(admin)}</nav>`;
  const transformed=new HTMLRewriter()
    .on('head',{element(el){el.append('<link rel="stylesheet" href="/navigation.css?v=global-nav-1">',{html:true});}})
    .on('.topbar nav',{element(el){el.remove();}})
    .on('.topbar',{element(el){el.append(nav,{html:true});}})
    .transform(response);
  if(!admin)return transformed;
  const out=new Response(transformed.body,transformed);out.headers.set('cache-control','private, no-store');out.headers.append('vary','Cookie');return out;
}
