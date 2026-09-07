import {SESSION_COOKIE,jsonResponse,sameOrigin,sha256Hex} from './admin-session.ts';

type Env={DB:D1Database;ASSETS:Fetcher;MODEL_VERSION:string};
type Row=Record<string,any>;

const SESSION_DAYS=90;
const OWNER_HANDLE='cagemetrix_desk';

function sessionCookie(token:string){return `${SESSION_COOKIE}=${token}; Max-Age=${SESSION_DAYS*86400}; Path=/; HttpOnly; Secure; SameSite=Lax`;}
function randomToken(bytes=32){
  const data=new Uint8Array(bytes);crypto.getRandomValues(data);
  let bin='';for(const b of data)bin+=String.fromCharCode(b);
  return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
async function issueSession(db:D1Database,accountId:number){
  const token=`cms_${randomToken(32)}`;
  const expiresAt=new Date(Date.now()+SESSION_DAYS*86400000).toISOString();
  await db.prepare('INSERT INTO community_sessions(token_hash,account_id,expires_at) VALUES(?,?,?)').bind(await sha256Hex(token),accountId,expiresAt).run();
  return token;
}

export async function ownerAdminLogin(request:Request,env:Env){
  if(!sameOrigin(request))return jsonResponse({error:'Cross-origin sign-in is not allowed.'},403);
  let input:any;
  try{input=await request.json()}catch{return jsonResponse({error:'Invalid JSON.'},400)}
  const handle=String(input?.handle||'').trim().toLowerCase();
  const recovery=String(input?.recovery_key||'').trim();
  if(handle!==OWNER_HANDLE)return jsonResponse({error:'admin_route_mismatch'},400);
  if(!recovery)return jsonResponse({error:'Enter your recovery key.'},400);
  const account=await env.DB.prepare(`SELECT id,handle,display_name,bio,recovery_hash,fan_voter_id,role,created_at
    FROM community_accounts WHERE handle=? COLLATE NOCASE LIMIT 1`).bind(OWNER_HANDLE).first<Row>();
  if(!account||account.role!=='admin'||await sha256Hex(recovery)!==String(account.recovery_hash))return jsonResponse({error:'Handle or recovery key is incorrect.'},401);
  const token=await issueSession(env.DB,Number(account.id));
  return jsonResponse({account:{
    id:Number(account.id),handle:String(account.handle),display_name:String(account.display_name),bio:String(account.bio||''),
    role:'admin',created_at:account.created_at,profile_url:`/u/${encodeURIComponent(String(account.handle))}`,
    stats:{picks:0,graded:0,correct:0,accuracy:null,points:0,upset_calls:0,beat_model:{wins:0,ties:0,losses:0}},
    season:{year:String(new Date().getUTCFullYear()),picks:0,graded:0,correct:0,accuracy:null,points:0,upset_calls:0,beat_model:{wins:0,ties:0,losses:0}}
  }},200,[sessionCookie(token)]);
}
