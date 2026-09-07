import {adminAccount} from './admin-session.ts';

type Env={DB:D1Database;ASSETS:Fetcher;MODEL_VERSION:string};

export function primaryNavigation(admin=false){
  return `<a href="/scout">Scout AI</a><a href="/predictions.html">Predictions</a><a href="/#rankings">Rankings</a><a href="/forum">Forum</a><a href="/watchlist">Watchlist</a><a href="/community">Community</a>${admin?'<a href="/admin" class="admin-link">Admin</a>':''}`;
}

export async function normalizeNavigation(response:Response,request:Request,env:Env){
  if(!response.headers.get('content-type')?.includes('text/html'))return response;
  const admin=!!await adminAccount(request,env.DB);
  const nav=`<nav class="global-nav" aria-label="Primary">${primaryNavigation(admin)}</nav>`;
  const transformed=new HTMLRewriter()
    .on('head',{element(el){el.append('<link rel="stylesheet" href="/navigation.css?v=global-nav-1">',{html:true});}})
    .on('.topbar nav',{element(el){el.remove();}})
    .on('.topbar',{element(el){el.append(nav,{html:true});}})
    .transform(response);
  if(!admin)return transformed;
  const out=new Response(transformed.body,transformed);
  out.headers.set('cache-control','private, no-store');
  out.headers.append('vary','Cookie');
  return out;
}
