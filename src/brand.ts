export const BRAND_NAME='MMA Scouts';
export const SITE_ORIGIN='https://mmascouts.com';
export const CANONICAL_HOST='mmascouts.com';
export const WWW_CANONICAL_HOST='www.mmascouts.com';

export function canonicalUrl(pathname='/',search=''){
  const url=new URL(pathname,SITE_ORIGIN);
  if(search)url.search=search;
  return url.toString();
}
