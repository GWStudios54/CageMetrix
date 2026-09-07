type Env={DB:D1Database;ASSETS:Fetcher;MODEL_VERSION:string};
type Row=Record<string,any>;

const SESSION_COOKIE='cm_session';
const SESSION_DAYS=90;
const OWNER_HANDLE='cagemetrix_owner54';

async function hash(value:string){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
function sameOrigin(request:Request){const origin=request.headers.get('origin');return !origin||origin===new URL(request.url).origin;}
function json(data:unknown,status=200,cookies:string[]=[]){
  const headers=new Headers({'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
  for(const cookie of cookies)headers.append('set-cookie',cookie);
  return new Response(JSON.stringify(data),{status,headers});
}
function sessionCookie(token:string){return `${SESSION_COOKIE}=${token}; Max-Age=${SESSION_DAYS*86400}; Path=/; HttpOnly; Secure; SameSite=Lax`;}
function randomToken(bytes=32){
  const data=new Uint8Array(bytes);crypto.getRandomValues(data);
  let bin='';for(const b of data)bin+=String.fromCharCode(b);
  return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
async function issueSession(db:D1Database,accountId:number){
  const token=`cms_${randomToken(32)}`;
  const tokenHash=await hash(token);
  const expiresAt=new Date(Date.now()+SESSION_DAYS*86400000).toISOString();
  await db.prepare('INSERT INTO community_sessions(token_hash,account_id,expires_at) VALUES(?,?,?)').bind(tokenHash,accountId,expiresAt).run();
  return token;
}

export async function ownerAdminLogin(request:Request,env:Env){
  if(!sameOrigin(request))return json({error:'Cross-origin sign-in is not allowed.'},403);
  let input:any;
  try{input=await request.json()}catch{return json({error:'Invalid JSON.'},400)}
  const handle=String(input?.handle||'').trim().toLowerCase();
  const recovery=String(input?.recovery_key||'').trim();
  if(handle!==OWNER_HANDLE)return json({error:'admin_route_mismatch'},400);
  if(!recovery)return json({error:'Enter your recovery key.'},400);
  const account=await env.DB.prepare(`SELECT id,handle,display_name,bio,recovery_hash,fan_voter_id,role,created_at
    FROM community_accounts WHERE handle=? COLLATE NOCASE LIMIT 1`).bind(OWNER_HANDLE).first<Row>();
  if(!account||account.role!=='admin'||await hash(recovery)!==String(account.recovery_hash))return json({error:'Handle or recovery key is incorrect.'},401);
  const token=await issueSession(env.DB,Number(account.id));
  return json({account:{
    id:Number(account.id),handle:String(account.handle),display_name:String(account.display_name),bio:String(account.bio||''),
    role:'admin',created_at:account.created_at,profile_url:`/u/${encodeURIComponent(String(account.handle))}`,
    stats:{picks:0,graded:0,correct:0,accuracy:null,points:0,upset_calls:0,beat_model:{wins:0,ties:0,losses:0}},
    season:{year:String(new Date().getUTCFullYear()),picks:0,graded:0,correct:0,accuracy:null,points:0,upset_calls:0,beat_model:{wins:0,ties:0,losses:0}}
  }},200,[sessionCookie(token)]);
}
