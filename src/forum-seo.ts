const SITE='https://cagemetrix.com';

export function normalizeForumSeo(response:Response,pathname:string,indexable:boolean){
  if(!response.ok||!response.headers.get('content-type')?.includes('text/html'))return response;
  const canonical=`${SITE}${pathname}`;
  return new HTMLRewriter()
    .on('link[rel="canonical"]',{element(el){el.setAttribute('href',canonical);}})
    .on('meta[name="robots"]',{element(el){el.setAttribute('content',indexable?'index,follow,max-image-preview:large':'noindex,follow');}})
    .transform(response);
}
