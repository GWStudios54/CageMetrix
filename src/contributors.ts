type Row=Record<string,any>;
const COOKIE='cm_contributor_key';
const TOKEN_RE=/^cm_[A-Za-z0-9_-]{43}$/;

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const bearer=(request:Request)=>request.headers.get('authorization')?.match(/^Bearer (cm_[A-Za-z0-9_-]{43})$/)?.[1]||null;
const cookie=(request:Request)=>{
  const raw=request.headers.get('cookie')||'';
  const value=raw.split(';').map(v=>v.trim()).find(v=>v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length+1)||null;
  return value&&TOKEN_RE.test(value)?value:null;
};
const hash=async(token:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');

async function byToken(token:string|null,db:D1Database){
  if(!token)return null;
  return db.prepare(`SELECT c.id,c.slug,c.display_name,c.bio FROM contributor_keys k JOIN contributors c ON c.id=k.contributor_id
    WHERE k.token_hash=? AND k.revoked_at IS NULL`).bind(await hash(token)).first<Row>();
}

export async function contributor(request:Request,db:D1Database){
  return byToken(bearer(request)||cookie(request),db);
}

export async function rememberContributor(request:Request,db:D1Database){
  const token=bearer(request),who=await byToken(token,db);
  if(!token||!who)return json({error:'Invalid or revoked publishing key.'},401);
  const response=json(who);
  response.headers.set('set-cookie',`${COOKIE}=${token}; Max-Age=31536000; Path=/; HttpOnly; Secure; SameSite=Strict`);
  return response;
}

export function forgetContributor(){
  const response=json({ok:true});
  response.headers.set('set-cookie',`${COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`);
  return response;
}

export async function updateContributorProfile(request:Request,db:D1Database){
  const origin=request.headers.get('origin');
  if(origin&&origin!==new URL(request.url).origin)return json({error:'Cross-origin contributor changes are not allowed.'},403);
  const who=await contributor(request,db);
  if(!who)return json({error:'Invalid or revoked publishing key.'},401);
  if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'Send application/json.'},415);
  const text=await request.text();
  if(new TextEncoder().encode(text).length>1024)return json({error:'Profile update is too large.'},413);
  let body:any;try{body=JSON.parse(text);}catch{return json({error:'Invalid JSON.'},400);}
  const display=typeof body?.display_name==='string'?body.display_name.trim():'';
  if(display.length<2||display.length>40||/[\r\n\u0000-\u001f]/.test(display))return json({error:'Public name must be 2–40 characters on one line.'},400);
  await db.prepare('UPDATE contributors SET display_name=? WHERE id=?').bind(display,who.id).run();
  return json({...who,display_name:display});
}
