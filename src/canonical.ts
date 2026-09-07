import {CANONICAL_HOST,LEGACY_HOSTS,WWW_CANONICAL_HOST} from './brand.ts';

export function canonicalRedirect(request:Request){
  const url=new URL(request.url),host=url.hostname.toLowerCase();
  const legacy=LEGACY_HOSTS.has(host);
  const nonCanonicalNewHost=host===WWW_CANONICAL_HOST;
  const insecureCanonical=host===CANONICAL_HOST&&url.protocol==='http:';
  if(!legacy&&!nonCanonicalNewHost&&!insecureCanonical)return null;
  url.protocol='https:';
  url.hostname=CANONICAL_HOST;
  url.port='';
  return new Response(null,{status:308,headers:{
    location:url.toString(),
    'cache-control':'public, max-age=31536000, immutable'
  }});
}
