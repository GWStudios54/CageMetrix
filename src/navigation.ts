import {adminAccount} from './admin-session.ts';
import {BRAND_NAME,SITE_ORIGIN} from './brand.ts';

type Env={DB:D1Database;ASSETS:Fetcher;MODEL_VERSION:string};

export function primaryNavigation(admin=false){
  return `<a href="/scout">Scout AI</a><a href="/#rankings">Rankings</a><a href="/prospects">Prospects</a><a href="/talent">Talent</a><a href="/promotions">Promotions</a><a href="/events">Events</a>${admin?'<a href="/admin" class="admin-link">Admin</a>':''}`;
}

function publicBrandText(value:string){
  return value.replace(/CageMetrix™/g,BRAND_NAME).replace(/CageMetrix/g,BRAND_NAME).replace(/CAGEMETRIX/g,'MMA SCOUTS');
}
function publicBrandUrl(value:string){
  return value
    .replace(/^https?:\/\/(?:www\.)?cagemetrix\.com/i,SITE_ORIGIN)
    .replace(/^https?:\/\/www\.mmascouts\.com/i,SITE_ORIGIN);
}

export async function normalizeNavigation(response:Response,request:Request,env:Env){
  if(!response.headers.get('content-type')?.includes('text/html'))return response;
  const admin=!!await adminAccount(request,env.DB);
  const nav=`<nav class="global-nav" aria-label="Primary">${primaryNavigation(admin)}</nav>`;
  const transformed=new HTMLRewriter()
    .on('head',{element(el){el.append('<link rel="stylesheet" href="/brand.css?v=identity-1"><link rel="stylesheet" href="/navigation.css?v=identity-1">',{html:true});}})
    .on('title',{text(text){if(text.text)text.replace(publicBrandText(text.text));}})
    .on('meta[name="description"]',{element(el){const value=el.getAttribute('content');if(value)el.setAttribute('content',publicBrandText(value));}})
    .on('meta[property="og:title"]',{element(el){const value=el.getAttribute('content');if(value)el.setAttribute('content',publicBrandText(value));}})
    .on('meta[property="og:description"]',{element(el){const value=el.getAttribute('content');if(value)el.setAttribute('content',publicBrandText(value));}})
    .on('meta[property="og:url"]',{element(el){const value=el.getAttribute('content');if(value)el.setAttribute('content',publicBrandUrl(value));}})
    .on('meta[property="og:image"]',{element(el){const value=el.getAttribute('content');if(value)el.setAttribute('content',publicBrandUrl(value));}})
    .on('meta[name="twitter:title"]',{element(el){const value=el.getAttribute('content');if(value)el.setAttribute('content',publicBrandText(value));}})
    .on('meta[name="twitter:description"]',{element(el){const value=el.getAttribute('content');if(value)el.setAttribute('content',publicBrandText(value));}})
    .on('meta[name="twitter:image"]',{element(el){const value=el.getAttribute('content');if(value)el.setAttribute('content',publicBrandUrl(value));}})
    .on('link[rel="canonical"]',{element(el){const value=el.getAttribute('href');if(value)el.setAttribute('href',publicBrandUrl(value));}})
    .on('.brand',{element(el){el.setAttribute('aria-label',`${BRAND_NAME} home`);}})
    .on('.brand .brand-mark',{element(el){el.setAttribute('src','/logo.svg');el.setAttribute('alt','');el.setAttribute('width','42');el.setAttribute('height','42');}})
    .on('.brand span',{element(el){el.setInnerContent(BRAND_NAME);}})
    .on('footer span:first-child',{element(el){el.setInnerContent(BRAND_NAME);}})
    .on('.topbar nav',{element(el){el.remove();}})
    .on('.topbar',{element(el){el.append(nav,{html:true});}})
    .transform(response);
  if(!admin)return transformed;
  const out=new Response(transformed.body,transformed);
  out.headers.set('cache-control','private, no-store');
  out.headers.append('vary','Cookie');
  return out;
}
