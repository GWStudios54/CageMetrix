const CANONICAL_HOST='cagemetrix.com';

export function canonicalRedirect(request:Request){
  const url=new URL(request.url),host=url.hostname.toLowerCase();
  if(host!==`www.${CANONICAL_HOST}`&&!(host===CANONICAL_HOST&&url.protocol==='http:'))return null;
  url.protocol='https:';
  url.hostname=CANONICAL_HOST;
  url.port='';
  return new Response(null,{status:308,headers:{location:url.toString(),'cache-control':'public, max-age=31536000, immutable'}});
}
