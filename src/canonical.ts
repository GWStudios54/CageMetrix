import {CANONICAL_HOST,WWW_CANONICAL_HOST} from './brand.ts';

export function canonicalRedirect(request:Request){
  const url=new URL(request.url),host=url.hostname.toLowerCase();
  const nonCanonicalNewHost=host===WWW_CANONICAL_HOST;
  const insecureCanonical=host===CANONICAL_HOST&&url.protocol==='http:';
  const duplicateHome=host===CANONICAL_HOST&&url.pathname==='/index.html';
  if(!nonCanonicalNewHost&&!insecureCanonical&&!duplicateHome)return null;
  url.protocol='https:';
  url.hostname=CANONICAL_HOST;
  url.port='';
  if(url.pathname==='/index.html')url.pathname='/';
  return new Response(null,{status:308,headers:{
    location:url.toString(),
    'cache-control':'public, max-age=31536000, immutable'
  }});
}
