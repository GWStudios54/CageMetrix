type Env={DB:D1Database;ASSETS:Fetcher;MODEL_VERSION:string};
type Row=Record<string,any>;

const SITE='https://cagemetrix.com';
const PUBLIC_MODEL='CageMetrix Win Probability';
const SESSION_COOKIE='cm_session';
const FAN_COOKIE='cm_fan_id';
const SESSION_DAYS=90;
const HANDLE_RE=/^[a-zA-Z0-9_]{3,24}$/;
const FAN_RE=/^[0-9a-f-]{36}$/i;
const publicModelOrder=`CASE mv.version WHEN '0.2.1' THEN 0 WHEN '0.2.0' THEN 1 WHEN '0.1.0' THEN 2 ELSE 3 END`;

const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const cookieValue=(request:Request,name:string)=>{
  const raw=request.headers.get('cookie')||'';
  return raw.split(';').map(v=>v.trim()).find(v=>v.startsWith(`${name}=`))?.slice(name.length+1)||null;
};
export function normalizeHandle(value:unknown){
  const handle=String(value??'').trim();
  return HANDLE_RE.test(handle)?handle.toLowerCase():null;
}
export function validateConfidence(value:unknown){
  const n=Number(value);
  return Number.isInteger(n)&&n>=50&&n<=100?n:null;
}
export function pickPoints(correct:boolean|null,confidence:number){
  if(correct===null)return 0;
  const c=Math.max(50,Math.min(100,Math.round(confidence)));
  return correct?100+(c-50):-(c-50);
}
function displayName(value:unknown,handle:string){
  const s=String(value??'').trim().replace(/\s+/g,' ');
  return s&&s.length<=40?s:handle;
}
function bioText(value:unknown){
  const s=String(value??'').trim();
  return s.length<=280?s:null;
}
function randomToken(bytes=32){
  const data=new Uint8Array(bytes);crypto.getRandomValues(data);
  let bin='';for(const b of data)bin+=String.fromCharCode(b);
  return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
async function hash(value:string){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
function sameOrigin(request:Request){const origin=request.headers.get('origin');return !origin||origin===new URL(request.url).origin;}
async function readBody(request:Request,max=8192){
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw new Error('content_type');
  const text=await request.text();if(new TextEncoder().encode(text).length>max)throw new Error('too_large');
  try{return JSON.parse(text)}catch{throw new Error('invalid_json')}
}
function json(data:unknown,status=200,cookies:string[]=[]){
  const headers=new Headers({'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
  for(const c of cookies)headers.append('set-cookie',c);
  return new Response(JSON.stringify(data),{status,headers});
}
function bodyError(error:any){
  const code=String(error?.message||error);
  if(code==='content_type')return json({error:'Send application/json.'},415);
  if(code==='too_large')return json({error:'Request is too large.'},413);
  return json({error:'Invalid JSON.'},400);
}
function sessionCookie(token:string){return `${SESSION_COOKIE}=${token}; Max-Age=${SESSION_DAYS*86400}; Path=/; HttpOnly; Secure; SameSite=Lax`;}
function fanCookie(id:string){return `${FAN_COOKIE}=${id}; Max-Age=31536000; Path=/; HttpOnly; Secure; SameSite=Lax`;}
function clearSessionCookie(){return `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;}

async function currentAccount(request:Request,db:D1Database){
  const raw=cookieValue(request,SESSION_COOKIE);if(!raw||raw.length<30)return null;
  const tokenHash=await hash(raw);
  return db.prepare(`SELECT a.id,a.handle,a.display_name,a.bio,a.fan_voter_id,a.created_at
    FROM community_sessions s JOIN community_accounts a ON a.id=s.account_id
    WHERE s.token_hash=? AND s.expires_at>CURRENT_TIMESTAMP LIMIT 1`).bind(tokenHash).first<Row>();
}
async function issueSession(db:D1Database,accountId:number){
  const token=`cms_${randomToken(32)}`,tokenHash=await hash(token),expires=new Date(Date.now()+SESSION_DAYS*86400000).toISOString();
  await db.prepare('INSERT INTO community_sessions(token_hash,account_id,expires_at) VALUES(?,?,?)').bind(tokenHash,accountId,expires).run();
  return token;
}
async function mergeLegacyFan(db:D1Database,account:Row,legacy:string|null){
  if(!legacy||!FAN_RE.test(legacy)||legacy===account.fan_voter_id)return;
  await db.prepare(`INSERT OR IGNORE INTO community_event_picks(account_id,bout_id,picked_fighter_id,confidence,created_at,updated_at)
    SELECT ?,bout_id,picked_fighter_id,50,created_at,updated_at FROM fan_predictions WHERE voter_id=?`).bind(account.id,legacy).run();
  try{await db.prepare('UPDATE OR IGNORE fan_predictions SET voter_id=? WHERE voter_id=?').bind(account.fan_voter_id,legacy).run();await db.prepare('DELETE FROM fan_predictions WHERE voter_id=?').bind(legacy).run();}catch{}
  try{await db.prepare('UPDATE OR IGNORE fan_scorecards SET voter_id=? WHERE voter_id=?').bind(account.fan_voter_id,legacy).run();await db.prepare('DELETE FROM fan_scorecards WHERE voter_id=?').bind(legacy).run();}catch{}
}
async function inheritFanPicks(db:D1Database,account:Row){
  await db.prepare(`INSERT OR IGNORE INTO community_event_picks(account_id,bout_id,picked_fighter_id,confidence,created_at,updated_at)
    SELECT ?,bout_id,picked_fighter_id,50,created_at,updated_at FROM fan_predictions WHERE voter_id=?`).bind(account.id,account.fan_voter_id).run();
}

async function statsForAccount(db:D1Database,accountId:number,year?:string){
  const yearClause=year?`AND strftime('%Y',e.event_date)=?`:'';
  const bindings:any[]=[accountId];if(year)bindings.push(year);
  const row=await db.prepare(`WITH latest AS (
      SELECT p.*,mv.version,ROW_NUMBER() OVER(PARTITION BY p.bout_id ORDER BY ${publicModelOrder},p.id DESC) rn
      FROM predictions p JOIN model_versions mv ON mv.id=p.model_version_id WHERE mv.name=?
    ), graded AS (
      SELECT ep.confidence,ep.picked_fighter_id,b.event_id,b.status,b.winner_id,b.fighter_a_id,b.fighter_b_id,e.event_date,
        CASE WHEN b.status='completed' AND b.winner_id IN (b.fighter_a_id,b.fighter_b_id) THEN CASE WHEN ep.picked_fighter_id=b.winner_id THEN 1 ELSE 0 END END user_correct,
        CASE WHEN b.status='completed' AND b.winner_id IN (b.fighter_a_id,b.fighter_b_id) AND lp.picked_fighter_id IS NOT NULL THEN CASE WHEN lp.picked_fighter_id=b.winner_id THEN 1 ELSE 0 END END model_correct,
        CASE WHEN ep.picked_fighter_id=b.fighter_a_id THEN lp.fighter_a_probability WHEN ep.picked_fighter_id=b.fighter_b_id THEN lp.fighter_b_probability END picked_probability
      FROM community_event_picks ep JOIN bouts b ON b.id=ep.bout_id JOIN events e ON e.id=b.event_id
      LEFT JOIN latest lp ON lp.bout_id=b.id AND lp.rn=1
      WHERE ep.account_id=? ${yearClause}
    ), event_scores AS (
      SELECT event_id,SUM(user_correct) user_correct,SUM(model_correct) model_correct,COUNT(user_correct) graded
      FROM graded WHERE user_correct IS NOT NULL AND model_correct IS NOT NULL GROUP BY event_id
    )
    SELECT
      (SELECT COUNT(*) FROM graded) picks,
      (SELECT COUNT(user_correct) FROM graded) graded,
      (SELECT COALESCE(SUM(user_correct),0) FROM graded) correct,
      (SELECT COALESCE(SUM(CASE WHEN user_correct=1 AND picked_probability<0.5 THEN 1 ELSE 0 END),0) FROM graded) upset_calls,
      (SELECT COALESCE(SUM(CASE WHEN user_correct=1 THEN 100+(confidence-50) WHEN user_correct=0 THEN -(confidence-50) ELSE 0 END),0) FROM graded) points,
      (SELECT COALESCE(SUM(CASE WHEN user_correct>model_correct THEN 1 ELSE 0 END),0) FROM event_scores WHERE graded>0) beat_model_wins,
      (SELECT COALESCE(SUM(CASE WHEN user_correct=model_correct THEN 1 ELSE 0 END),0) FROM event_scores WHERE graded>0) beat_model_ties,
      (SELECT COALESCE(SUM(CASE WHEN user_correct<model_correct THEN 1 ELSE 0 END),0) FROM event_scores WHERE graded>0) beat_model_losses`).bind(PUBLIC_MODEL,...bindings).first<Row>();
  const graded=Number(row?.graded||0),correct=Number(row?.correct||0);
  return {picks:Number(row?.picks||0),graded,correct,accuracy:graded?correct/graded:null,points:Number(row?.points||0),upset_calls:Number(row?.upset_calls||0),beat_model:{wins:Number(row?.beat_model_wins||0),ties:Number(row?.beat_model_ties||0),losses:Number(row?.beat_model_losses||0)}};
}
async function accountPayload(db:D1Database,account:Row){
  const year=String(new Date().getUTCFullYear());
  return {id:Number(account.id),handle:String(account.handle),display_name:String(account.display_name),bio:String(account.bio||''),created_at:account.created_at,profile_url:`/u/${encodeURIComponent(String(account.handle))}`,stats:await statsForAccount(db,Number(account.id)),season:{year,...await statsForAccount(db,Number(account.id),year)}};
}

export async function registerCommunity(request:Request,env:Env){
  if(!sameOrigin(request))return json({error:'Cross-origin account creation is not allowed.'},403);
  let input:any;try{input=await readBody(request,4096)}catch(error){return bodyError(error)}
  const handle=normalizeHandle(input?.handle);if(!handle)return json({error:'Use 3–24 letters, numbers, or underscores for your handle.'},400);
  const name=displayName(input?.display_name,handle),bio=bioText(input?.bio);if(bio===null)return json({error:'Bio must be 280 characters or fewer.'},400);
  const recovery=`CMR-${randomToken(24)}`,recoveryHash=await hash(recovery);
  const existingFan=cookieValue(request,FAN_COOKIE),fanId=existingFan&&FAN_RE.test(existingFan)?existingFan:crypto.randomUUID();
  try{
    const result=await env.DB.prepare('INSERT INTO community_accounts(handle,display_name,bio,recovery_hash,fan_voter_id) VALUES(?,?,?,?,?)').bind(handle,name,bio||'',recoveryHash,fanId).run();
    const account=await env.DB.prepare('SELECT * FROM community_accounts WHERE id=?').bind(Number(result.meta.last_row_id)).first<Row>();
    if(!account)return json({error:'Account could not be created.'},500);
    await inheritFanPicks(env.DB,account);
    const token=await issueSession(env.DB,Number(account.id));
    return json({account:await accountPayload(env.DB,account),recovery_key:recovery,recovery_message:'Save this recovery key somewhere safe. CageMetrix does not know it and cannot display it again.'},201,[sessionCookie(token),fanCookie(fanId)]);
  }catch(error:any){
    if(/unique/i.test(String(error?.message||error)))return json({error:'That handle is already claimed.'},409);
    throw error;
  }
}
export async function loginCommunity(request:Request,env:Env){
  if(!sameOrigin(request))return json({error:'Cross-origin sign-in is not allowed.'},403);
  let input:any;try{input=await readBody(request,4096)}catch(error){return bodyError(error)}
  const handle=normalizeHandle(input?.handle),recovery=String(input?.recovery_key||'').trim();
  if(!handle||!recovery)return json({error:'Enter your handle and recovery key.'},400);
  const account=await env.DB.prepare('SELECT * FROM community_accounts WHERE handle=? COLLATE NOCASE LIMIT 1').bind(handle).first<Row>();
  if(!account||await hash(recovery)!==String(account.recovery_hash))return json({error:'Handle or recovery key is incorrect.'},401);
  await mergeLegacyFan(env.DB,account,cookieValue(request,FAN_COOKIE));await inheritFanPicks(env.DB,account);
  const token=await issueSession(env.DB,Number(account.id));
  return json({account:await accountPayload(env.DB,account)},200,[sessionCookie(token),fanCookie(String(account.fan_voter_id))]);
}
export async function logoutCommunity(request:Request,env:Env){
  const raw=cookieValue(request,SESSION_COOKIE);if(raw){try{await env.DB.prepare('DELETE FROM community_sessions WHERE token_hash=?').bind(await hash(raw)).run();}catch{}}
  return json({ok:true},200,[clearSessionCookie()]);
}
export async function getCommunityMe(request:Request,env:Env){
  const account=await currentAccount(request,env.DB);return json({account:account?await accountPayload(env.DB,account):null});
}
export async function updateCommunityMe(request:Request,env:Env){
  if(!sameOrigin(request))return json({error:'Cross-origin profile updates are not allowed.'},403);
  const account=await currentAccount(request,env.DB);if(!account)return json({error:'Sign in to edit your profile.'},401);
  let input:any;try{input=await readBody(request,4096)}catch(error){return bodyError(error)}
  const name=displayName(input?.display_name,account.handle),bio=bioText(input?.bio);if(bio===null)return json({error:'Bio must be 280 characters or fewer.'},400);
  await env.DB.prepare('UPDATE community_accounts SET display_name=?,bio=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(name,bio||'',account.id).run();
  const fresh=await env.DB.prepare('SELECT * FROM community_accounts WHERE id=?').bind(account.id).first<Row>();
  return json({account:fresh?await accountPayload(env.DB,fresh):null});
}

async function eventRow(db:D1Database,slug:string){
  if(!/^[a-z0-9-]{1,180}$/.test(slug))return null;
  return db.prepare('SELECT id,slug,name,event_date,starts_at,status,promotion FROM events WHERE slug=? LIMIT 1').bind(slug).first<Row>();
}
async function eventBouts(db:D1Database,eventId:number){
  return db.prepare(`WITH latest AS (
      SELECT p.*,mv.version model_version,ROW_NUMBER() OVER(PARTITION BY p.bout_id ORDER BY ${publicModelOrder},p.id DESC) rn
      FROM predictions p JOIN model_versions mv ON mv.id=p.model_version_id WHERE mv.name=?
    ), consensus AS (
      SELECT ep.bout_id,COUNT(*) total,
        SUM(CASE WHEN ep.picked_fighter_id=b.fighter_a_id THEN 1 ELSE 0 END) a_picks,
        SUM(CASE WHEN ep.picked_fighter_id=b.fighter_b_id THEN 1 ELSE 0 END) b_picks,
        AVG(ep.confidence) avg_confidence
      FROM community_event_picks ep JOIN bouts b ON b.id=ep.bout_id GROUP BY ep.bout_id
    )
    SELECT b.id,b.bout_order,b.weight_class,b.status,b.winner_id,b.fighter_a_id,b.fighter_b_id,
      a.name fighter_a_name,a.slug fighter_a_slug,z.name fighter_b_name,z.slug fighter_b_slug,
      lp.fighter_a_probability,lp.fighter_b_probability,lp.picked_fighter_id model_pick,lp.model_version,
      COALESCE(c.total,0) community_total,COALESCE(c.a_picks,0) community_a_picks,COALESCE(c.b_picks,0) community_b_picks,c.avg_confidence
    FROM bouts b JOIN fighters a ON a.id=b.fighter_a_id JOIN fighters z ON z.id=b.fighter_b_id
    LEFT JOIN latest lp ON lp.bout_id=b.id AND lp.rn=1 LEFT JOIN consensus c ON c.bout_id=b.id
    WHERE b.event_id=? ORDER BY b.bout_order,b.id`).bind(PUBLIC_MODEL,eventId).all<Row>();
}
export async function communityEvent(request:Request,env:Env,slug:string){
  const event=await eventRow(env.DB,slug);if(!event)return json({error:'event_not_found'},404);
  const account=await currentAccount(request,env.DB),rows=await eventBouts(env.DB,Number(event.id));
  let mine=new Map<number,Row>();
  if(account){const r=await env.DB.prepare('SELECT bout_id,picked_fighter_id,confidence,updated_at FROM community_event_picks WHERE account_id=? AND bout_id IN (SELECT id FROM bouts WHERE event_id=?)').bind(account.id,event.id).all<Row>();mine=new Map((r.results||[]).map(x=>[Number(x.bout_id),x]));}
  const lockAt=Date.parse(String(event.starts_at||'')),locked=event.status!=='scheduled'||!Number.isFinite(lockAt)||Date.now()>=lockAt;
  let userCorrect=0,modelCorrect=0,graded=0,userMade=0,totalCommunity=0;
  const bouts=(rows.results||[]).map((b:Row)=>{
    const my=mine.get(Number(b.id)),myPick=my?Number(my.picked_fighter_id):null;if(my)userMade++;totalCommunity+=Number(b.community_total||0);
    const decided=b.status==='completed'&&[Number(b.fighter_a_id),Number(b.fighter_b_id)].includes(Number(b.winner_id));
    const userGrade=my&&decided?(myPick===Number(b.winner_id)?'correct':'incorrect'):my?'pending':null;
    const modelGrade=decided&&b.model_pick?(Number(b.model_pick)===Number(b.winner_id)?'correct':'incorrect'):decided?'void':'pending';
    if(my&&decided&&b.model_pick){graded++;if(userGrade==='correct')userCorrect++;if(modelGrade==='correct')modelCorrect++;}
    const total=Number(b.community_total||0),a=Number(b.community_a_picks||0),bp=Number(b.community_b_picks||0);
    return {id:Number(b.id),weight_class:b.weight_class,status:b.status,winner_id:b.winner_id===null?null:Number(b.winner_id),
      fighter_a:{id:Number(b.fighter_a_id),name:b.fighter_a_name,slug:b.fighter_a_slug,model_probability:b.fighter_a_probability===null?null:Number(b.fighter_a_probability)},
      fighter_b:{id:Number(b.fighter_b_id),name:b.fighter_b_name,slug:b.fighter_b_slug,model_probability:b.fighter_b_probability===null?null:Number(b.fighter_b_probability)},
      model:{pick:Number(b.model_pick)||null,version:b.model_version||null,grade:modelGrade},community:{total,a_pct:total?a/total:null,b_pct:total?bp/total:null,avg_confidence:b.avg_confidence===null?null:Number(b.avg_confidence)},
      mine:my?{picked_fighter_id:myPick,confidence:Number(my.confidence),grade:userGrade}:null};
  });
  const result=graded?(userCorrect>modelCorrect?'user':userCorrect<modelCorrect?'model':'tie'):null;
  return json({event:{id:Number(event.id),slug:event.slug,name:event.name,event_date:event.event_date,starts_at:event.starts_at,status:event.status,locked},account:account?await accountPayload(env.DB,account):null,bouts,card:{made:userMade,total:bouts.length,community_picks:totalCommunity,graded,user_correct:userCorrect,model_correct:modelCorrect,result}});
}
export async function saveCommunityPick(request:Request,env:Env,slug:string,boutId:string){
  if(!sameOrigin(request))return json({error:'Cross-origin picks are not allowed.'},403);
  const account=await currentAccount(request,env.DB);if(!account)return json({error:'Claim or sign in to a profile before making a card.'},401);
  if(!/^[1-9]\d*$/.test(boutId))return json({error:'fight_not_found'},404);
  const row=await env.DB.prepare(`SELECT b.id,b.fighter_a_id,b.fighter_b_id,b.status,e.slug,e.starts_at,e.status event_status
    FROM bouts b JOIN events e ON e.id=b.event_id WHERE b.id=? AND e.slug=? LIMIT 1`).bind(Number(boutId),slug).first<Row>();
  if(!row)return json({error:'fight_not_found'},404);
  const lock=Date.parse(String(row.starts_at||''));if(row.event_status!=='scheduled'||!Number.isFinite(lock)||Date.now()>=lock)return json({error:'Picks are locked for this card.'},409);
  let input:any;try{input=await readBody(request,2048)}catch(error){return bodyError(error)}
  const side=String(input?.pick||'').toLowerCase(),confidence=validateConfidence(input?.confidence??50);if(!['a','b'].includes(side)||confidence===null)return json({error:'Choose fighter a or b and a confidence from 50 to 100.'},400);
  const picked=side==='a'?Number(row.fighter_a_id):Number(row.fighter_b_id);
  await env.DB.prepare(`INSERT INTO community_event_picks(account_id,bout_id,picked_fighter_id,confidence) VALUES(?,?,?,?)
    ON CONFLICT(account_id,bout_id) DO UPDATE SET picked_fighter_id=excluded.picked_fighter_id,confidence=excluded.confidence,updated_at=CURRENT_TIMESTAMP`).bind(account.id,row.id,picked,confidence).run();
  await env.DB.prepare(`INSERT INTO fan_predictions(bout_id,voter_id,picked_fighter_id) VALUES(?,?,?)
    ON CONFLICT(bout_id,voter_id) DO UPDATE SET picked_fighter_id=excluded.picked_fighter_id,updated_at=CURRENT_TIMESTAMP`).bind(row.id,account.fan_voter_id,picked).run();
  return communityEvent(request,env,slug);
}

function validScope(scope:string){return scope==='event'||scope==='fight';}
async function scopeExists(db:D1Database,scope:string,id:number){
  const table=scope==='event'?'events':'bouts';return !!await db.prepare(`SELECT 1 ok FROM ${table} WHERE id=? LIMIT 1`).bind(id).first<Row>();
}
export async function discussion(request:Request,env:Env){
  const url=new URL(request.url),scope=String(url.searchParams.get('scope')||''),id=Number(url.searchParams.get('id')||0);if(!validScope(scope)||!Number.isInteger(id)||id<1)return json({error:'Invalid discussion scope.'},400);
  const account=await currentAccount(request,env.DB);if(!await scopeExists(env.DB,scope,id))return json({error:'Discussion target not found.'},404);
  const rows=await env.DB.prepare(`SELECT p.id,p.parent_id,p.body,p.created_at,a.handle,a.display_name,a.id account_id,
      (SELECT COUNT(*) FROM community_reactions r WHERE r.post_id=p.id) reactions,
      CASE WHEN ? IS NULL THEN 0 ELSE EXISTS(SELECT 1 FROM community_reactions r WHERE r.post_id=p.id AND r.account_id=?) END my_reacted,
      ep.picked_fighter_id,ep.confidence,b.status fight_status,b.winner_id,b.fighter_a_id,b.fighter_b_id,fa.name fighter_a_name,fb.name fighter_b_name
    FROM community_posts p JOIN community_accounts a ON a.id=p.account_id
    LEFT JOIN community_event_picks ep ON ?='fight' AND ep.account_id=a.id AND ep.bout_id=?
    LEFT JOIN bouts b ON ?='fight' AND b.id=? LEFT JOIN fighters fa ON fa.id=b.fighter_a_id LEFT JOIN fighters fb ON fb.id=b.fighter_b_id
    WHERE p.scope_type=? AND p.scope_id=? AND p.deleted_at IS NULL
      AND (? IS NULL OR NOT EXISTS(SELECT 1 FROM community_blocks bl WHERE bl.blocker_id=? AND bl.blocked_id=p.account_id))
    ORDER BY p.created_at ASC,p.id ASC LIMIT 200`).bind(account?.id||null,account?.id||null,scope,id,scope,id,scope,id,account?.id||null,account?.id||null).all<Row>();
  const posts=(rows.results||[]).map((p:Row)=>{
    let receipt=null;if(scope==='fight'&&p.picked_fighter_id){const pick=Number(p.picked_fighter_id),winner=Number(p.winner_id);receipt={fighter_id:pick,fighter_name:pick===Number(p.fighter_a_id)?p.fighter_a_name:p.fighter_b_name,confidence:Number(p.confidence),grade:p.fight_status==='completed'&&winner?(pick===winner?'correct':'incorrect'):'pending'};}
    return {id:Number(p.id),parent_id:p.parent_id===null?null:Number(p.parent_id),body:p.body,created_at:p.created_at,author:{handle:p.handle,display_name:p.display_name,profile_url:`/u/${encodeURIComponent(String(p.handle))}`},reactions:Number(p.reactions||0),my_reacted:Boolean(p.my_reacted),receipt};
  });
  return json({scope,id,account:account?{handle:account.handle,display_name:account.display_name}:null,posts});
}
export async function createDiscussionPost(request:Request,env:Env){
  if(!sameOrigin(request))return json({error:'Cross-origin posting is not allowed.'},403);
  const account=await currentAccount(request,env.DB);if(!account)return json({error:'Sign in to post.'},401);
  let input:any;try{input=await readBody(request,8192)}catch(error){return bodyError(error)}
  const scope=String(input?.scope_type||''),scopeId=Number(input?.scope_id||0),parent=input?.parent_id===null||input?.parent_id===undefined?null:Number(input.parent_id),text=String(input?.body||'').trim();
  if(!validScope(scope)||!Number.isInteger(scopeId)||scopeId<1||!await scopeExists(env.DB,scope,scopeId))return json({error:'Discussion target not found.'},404);
  if(text.length<1||text.length>2000)return json({error:'Posts must be 1–2,000 characters.'},400);
  const recent=await env.DB.prepare("SELECT created_at FROM community_posts WHERE account_id=? ORDER BY id DESC LIMIT 1").bind(account.id).first<Row>();
  if(recent&&Date.now()-Date.parse(String(recent.created_at))<10_000)return json({error:'Give it a few seconds before posting again.'},429);
  if(parent!==null){const row=await env.DB.prepare('SELECT id FROM community_posts WHERE id=? AND scope_type=? AND scope_id=? AND deleted_at IS NULL').bind(parent,scope,scopeId).first<Row>();if(!row)return json({error:'Reply target not found.'},400);}
  const result=await env.DB.prepare('INSERT INTO community_posts(account_id,scope_type,scope_id,parent_id,body) VALUES(?,?,?,?,?)').bind(account.id,scope,scopeId,parent,text).run();
  return json({ok:true,id:Number(result.meta.last_row_id)},201);
}
export async function reactCommunityPost(request:Request,env:Env,postId:string){
  if(!sameOrigin(request))return json({error:'Cross-origin reactions are not allowed.'},403);
  const account=await currentAccount(request,env.DB);if(!account)return json({error:'Sign in to react.'},401);if(!/^[1-9]\d*$/.test(postId))return json({error:'post_not_found'},404);
  const post=await env.DB.prepare('SELECT id FROM community_posts WHERE id=? AND deleted_at IS NULL').bind(Number(postId)).first<Row>();if(!post)return json({error:'post_not_found'},404);
  let input:any;try{input=await readBody(request,1024)}catch(error){return bodyError(error)}
  const on=input?.on!==false;if(on)await env.DB.prepare('INSERT OR IGNORE INTO community_reactions(post_id,account_id) VALUES(?,?)').bind(Number(postId),account.id).run();else await env.DB.prepare('DELETE FROM community_reactions WHERE post_id=? AND account_id=?').bind(Number(postId),account.id).run();
  return json({ok:true,on});
}
export async function reportCommunityPost(request:Request,env:Env,postId:string){
  if(!sameOrigin(request))return json({error:'Cross-origin reports are not allowed.'},403);
  const account=await currentAccount(request,env.DB);if(!account)return json({error:'Sign in to report.'},401);if(!/^[1-9]\d*$/.test(postId))return json({error:'post_not_found'},404);
  let input:any;try{input=await readBody(request,2048)}catch(error){return bodyError(error)}
  const reason=String(input?.reason||'other').trim().slice(0,120)||'other';await env.DB.prepare('INSERT OR IGNORE INTO community_reports(post_id,reporter_id,reason) VALUES(?,?,?)').bind(Number(postId),account.id,reason).run();return json({ok:true});
}
export async function blockCommunityUser(request:Request,env:Env,handle:string){
  if(!sameOrigin(request))return json({error:'Cross-origin blocks are not allowed.'},403);
  const account=await currentAccount(request,env.DB);if(!account)return json({error:'Sign in to block users.'},401);const targetHandle=normalizeHandle(handle);if(!targetHandle)return json({error:'user_not_found'},404);
  const target=await env.DB.prepare('SELECT id FROM community_accounts WHERE handle=? COLLATE NOCASE LIMIT 1').bind(targetHandle).first<Row>();if(!target)return json({error:'user_not_found'},404);if(Number(target.id)===Number(account.id))return json({error:'You cannot block yourself.'},400);
  let input:any;try{input=await readBody(request,1024)}catch(error){return bodyError(error)}
  const on=input?.blocked!==false;if(on)await env.DB.prepare('INSERT OR IGNORE INTO community_blocks(blocker_id,blocked_id) VALUES(?,?)').bind(account.id,target.id).run();else await env.DB.prepare('DELETE FROM community_blocks WHERE blocker_id=? AND blocked_id=?').bind(account.id,target.id).run();return json({ok:true,blocked:on});
}

export async function communityLeaderboard(request:Request,env:Env){
  const url=new URL(request.url),year=String(url.searchParams.get('season')||new Date().getUTCFullYear());if(!/^20\d{2}$/.test(year))return json({error:'Invalid season.'},400);
  const rows=await env.DB.prepare(`WITH latest AS (
      SELECT p.*,mv.version,ROW_NUMBER() OVER(PARTITION BY p.bout_id ORDER BY ${publicModelOrder},p.id DESC) rn
      FROM predictions p JOIN model_versions mv ON mv.id=p.model_version_id WHERE mv.name=?
    ), graded AS (
      SELECT ep.account_id,ep.confidence,b.winner_id,ep.picked_fighter_id,b.status
      FROM community_event_picks ep JOIN bouts b ON b.id=ep.bout_id JOIN events e ON e.id=b.event_id
      LEFT JOIN latest lp ON lp.bout_id=b.id AND lp.rn=1
      WHERE strftime('%Y',e.event_date)=? AND b.status='completed' AND b.winner_id IN (b.fighter_a_id,b.fighter_b_id)
    ), scores AS (
      SELECT account_id,COUNT(*) graded,SUM(CASE WHEN picked_fighter_id=winner_id THEN 1 ELSE 0 END) correct,
        SUM(CASE WHEN picked_fighter_id=winner_id THEN 100+(confidence-50) ELSE -(confidence-50) END) points
      FROM graded GROUP BY account_id
    )
    SELECT a.handle,a.display_name,s.graded,s.correct,s.points,1.0*s.correct/s.graded accuracy
    FROM scores s JOIN community_accounts a ON a.id=s.account_id WHERE s.graded>0
    ORDER BY s.points DESC,accuracy DESC,s.graded DESC,a.handle LIMIT 50`).bind(PUBLIC_MODEL,year).all<Row>();
  return json({season:year,rows:(rows.results||[]).map((r:Row,i:number)=>({rank:i+1,handle:r.handle,display_name:r.display_name,graded:Number(r.graded),correct:Number(r.correct),accuracy:Number(r.accuracy),points:Number(r.points),profile_url:`/u/${encodeURIComponent(String(r.handle))}`}))});
}

async function recentPicks(db:D1Database,accountId:number){
  const rows=await db.prepare(`SELECT ep.confidence,ep.picked_fighter_id,b.id bout_id,b.status,b.winner_id,e.name event_name,e.event_date,e.slug event_slug,
      a.id fighter_a_id,a.name fighter_a_name,z.id fighter_b_id,z.name fighter_b_name
    FROM community_event_picks ep JOIN bouts b ON b.id=ep.bout_id JOIN events e ON e.id=b.event_id
    JOIN fighters a ON a.id=b.fighter_a_id JOIN fighters z ON z.id=b.fighter_b_id WHERE ep.account_id=? ORDER BY e.event_date DESC,b.bout_order,b.id DESC LIMIT 12`).bind(accountId).all<Row>();
  return (rows.results||[]).map((r:Row)=>{const picked=Number(r.picked_fighter_id),winner=Number(r.winner_id),decided=r.status==='completed'&&winner>0;return {bout_id:Number(r.bout_id),event_name:r.event_name,event_date:r.event_date,event_url:`/events/${encodeURIComponent(String(r.event_slug))}`,fight_url:`/fights/${r.bout_id}`,pick:picked===Number(r.fighter_a_id)?r.fighter_a_name:r.fighter_b_name,confidence:Number(r.confidence),grade:decided?(picked===winner?'correct':'incorrect'):'pending'};});
}
export async function communityProfilePage(_request:Request,env:Env,handleRaw:string){
  const handle=normalizeHandle(handleRaw);if(!handle)return new Response('Not found',{status:404});
  const account=await env.DB.prepare('SELECT * FROM community_accounts WHERE handle=? COLLATE NOCASE LIMIT 1').bind(handle).first<Row>();if(!account)return new Response('<!doctype html><html><head><meta name="robots" content="noindex"><title>Profile not found — CageMetrix</title></head><body><h1>Profile not found</h1></body></html>',{status:404,headers:{'content-type':'text/html; charset=utf-8'}});
  const [stats,recent]=await Promise.all([statsForAccount(env.DB,Number(account.id)),recentPicks(env.DB,Number(account.id))]);
  const accuracy=stats.accuracy===null?'—':`${(stats.accuracy*100).toFixed(1)}%`,canonical=`${SITE}/u/${encodeURIComponent(String(account.handle))}`;
  const recentHtml=recent.map((r:any)=>`<a class="cm-profile-pick" href="${esc(r.fight_url)}"><span>${r.grade==='correct'?'✓':r.grade==='incorrect'?'✕':'•'} ${esc(r.pick)} · ${r.confidence}%</span><small>${esc(r.event_name)} · ${esc(String(r.event_date||'').slice(0,10))}</small></a>`).join('')||'<p class="muted">No picks yet.</p>';
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(account.display_name)} (@${esc(account.handle)}) — CageMetrix</title><meta name="description" content="${esc(account.display_name)}'s CageMetrix pick record: ${stats.graded} graded picks, ${accuracy} accuracy, ${stats.beat_model.wins}-${stats.beat_model.losses} against the model."><meta name="robots" content="index,follow"><link rel="canonical" href="${canonical}"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/community.css"><link rel="icon" href="/logo.svg" type="image/svg+xml"></head><body><header class="topbar"><a class="brand" href="/"><img class="brand-mark" src="/logo.svg" width="44" height="44" alt=""><span>CageMetrix™</span></a><nav><a href="/predictions.html">Predictions</a><a href="/community">Community</a></nav></header><main class="cm-profile-page"><p class="eyebrow">CAGEMETRIX PROFILE</p><h1>${esc(account.display_name)}</h1><p class="cm-handle">@${esc(account.handle)}</p>${account.bio?`<p class="cm-profile-bio">${esc(account.bio)}</p>`:''}<div class="cm-profile-stats"><div><strong>${stats.graded}</strong><span>graded picks</span></div><div><strong>${accuracy}</strong><span>accuracy</span></div><div><strong>${stats.points}</strong><span>season-style points</span></div><div><strong>${stats.beat_model.wins}-${stats.beat_model.losses}</strong><span>beat model record</span></div><div><strong>${stats.upset_calls}</strong><span>upset calls</span></div></div><section><div class="section-heading"><div><p class="eyebrow">RECEIPTS</p><h2>Recent picks</h2></div></div><div class="cm-profile-picks">${recentHtml}</div></section></main><footer><span>CageMetrix™</span><span>Picks have receipts.</span></footer></body></html>`;
  return new Response(html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'public, max-age=30','x-content-type-options':'nosniff'}});
}

export async function communityHomePage(_request:Request,env:Env){
  const event=await env.DB.prepare(`SELECT slug,name,event_date FROM events WHERE status='scheduled' AND starts_at>=CURRENT_TIMESTAMP AND slug IS NOT NULL ORDER BY starts_at LIMIT 1`).first<Row>();
  const year=String(new Date().getUTCFullYear());
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Beat CageMetrix — Pick’em & MMA Community | CageMetrix</title><meta name="description" content="Make UFC picks, build a public record, beat the CageMetrix model, and discuss every fight with receipts attached to your takes."><meta name="robots" content="index,follow"><link rel="canonical" href="${SITE}/community"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/community.css"><link rel="icon" href="/logo.svg" type="image/svg+xml"></head><body><header class="topbar"><a class="brand" href="/"><img class="brand-mark" src="/logo.svg" width="44" height="44" alt=""><span>CageMetrix™</span></a><nav><a href="/predictions.html">Predictions</a><a href="/#rankings">Rankings</a></nav></header><main class="cm-community-home" data-cm-community-home data-season="${year}"><section class="cm-community-hero"><p class="eyebrow">BEAT CAGEMETRIX</p><h1>Your picks. The model’s picks. Receipts forever.</h1><p class="lede">Build a public fight-picking record, compare every card against the CageMetrix model, and argue about matchups with your actual picks attached to your name.</p>${event?.slug?`<a class="button primary" href="/events/${esc(event.slug)}">Make picks for ${esc(event.name)} →</a>`:'<a class="button primary" href="/predictions.html">See upcoming predictions →</a>'}</section><section class="cm-account-panel" data-cm-account-panel><p>Loading your profile…</p></section><section><div class="section-heading"><div><p class="eyebrow">${year} SEASON</p><h2>Pick’em leaderboard</h2></div><p>Confidence rewards conviction. Wrong high-confidence picks cost more.</p></div><div class="cm-leaderboard" data-cm-leaderboard></div></section></main><footer><span>CageMetrix™</span><span>Talk shit. Keep receipts.</span></footer><script src="/community.js" defer></script></body></html>`;
  return new Response(html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'public, max-age=30'}});
}

function assetsAlreadyPresent(response:Response){return response.headers.get('content-type')?.includes('text/html');}
export async function enhanceEventCommunity(response:Response,_env:Env,slug:string){
  if(!response.ok||!assetsAlreadyPresent(response))return response;
  const block=`<section class="cm-community-shell" data-cm-event="${esc(slug)}"><div class="cm-community-head"><div><p class="eyebrow">BEAT CAGEMETRIX</p><h2>Make your card</h2><p>Your picks vs the model vs the crowd. Picks lock at the published card start.</p></div><a class="button secondary" href="/community">Season leaderboard →</a></div><div class="cm-event-score" data-cm-event-score>Loading pick’em…</div><div class="cm-pick-list" data-cm-pick-list></div><div class="cm-thread" data-cm-thread data-scope="event"><div class="cm-thread-head"><h2>Event discussion</h2><p>Talk about the card. Your fight picks stay attached to your profile.</p></div><div data-cm-posts></div><div data-cm-compose></div></div></section>`;
  return new HTMLRewriter().on('head',{element(el){el.append('<link rel="stylesheet" href="/community.css"><script src="/community.js" defer></script>',{html:true});}}).on('.topbar nav',{element(el){el.append('<a href="/community">Community</a><button class="cm-nav-account" type="button" data-cm-account-button>Profile</button>',{html:true});}}).on('footer',{element(el){el.before(block,{html:true});}}).transform(response);
}
export async function enhanceFightCommunity(response:Response,_env:Env,id:string){
  if(!response.ok||!assetsAlreadyPresent(response))return response;
  const block=`<section class="cm-community-shell cm-fight-thread" data-cm-fight="${esc(id)}"><div class="cm-thread" data-cm-thread data-scope="fight" data-scope-id="${esc(id)}"><div class="cm-thread-head"><div><p class="eyebrow">FIGHT DISCUSSION</p><h2>Put your take on the record</h2></div><p>If you picked this fight, your pick and confidence appear beside your posts. After the result, the receipt turns ✓ or ✕.</p></div><div data-cm-posts>Loading discussion…</div><div data-cm-compose></div></div></section>`;
  return new HTMLRewriter().on('head',{element(el){el.append('<link rel="stylesheet" href="/community.css"><script src="/community.js" defer></script>',{html:true});}}).on('.topbar nav',{element(el){el.append('<a href="/community">Community</a><button class="cm-nav-account" type="button" data-cm-account-button>Profile</button>',{html:true});}}).on('footer',{element(el){el.before(block,{html:true});}}).transform(response);
}
