type Row=Record<string,any>;

export const SESSION_COOKIE='cm_session';

export function cookieValue(request:Request,name:string){
  const raw=request.headers.get('cookie')||'';
  return raw.split(';').map(v=>v.trim()).find(v=>v.startsWith(`${name}=`))?.slice(name.length+1)||null;
}

export async function sha256Hex(value:string){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}

export function sameOrigin(request:Request){
  const origin=request.headers.get('origin');
  return !origin||origin===new URL(request.url).origin;
}

export function jsonResponse(data:unknown,status=200,cookies:string[]=[]){
  const headers=new Headers({'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
  for(const cookie of cookies)headers.append('set-cookie',cookie);
  return new Response(JSON.stringify(data),{status,headers});
}

export async function adminAccount(request:Request,db:D1Database){
  const raw=cookieValue(request,SESSION_COOKIE);if(!raw||raw.length<30)return null;
  return db.prepare(`SELECT a.id,a.handle,a.display_name,a.role
    FROM community_sessions s JOIN community_accounts a ON a.id=s.account_id
    WHERE s.token_hash=? AND s.expires_at>CURRENT_TIMESTAMP AND a.role='admin' LIMIT 1`).bind(await sha256Hex(raw)).first<Row>();
}
