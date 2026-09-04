type Env = {DB:D1Database;ASSETS:Fetcher};
type Row = Record<string,any>;
export const fightJson=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const parse=(value:any,fallback:any=null)=>{try{return JSON.parse(value)||fallback;}catch{return fallback;}};
const idValid=(id:string)=>/^[1-9]\d{0,14}$/.test(id)&&Number.isSafeInteger(Number(id));
const escape=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const PUBLIC_RATING_FIELDS=['cmr','technical','resume','strikingOffense','strikingDefense','wrestlingOffense','wrestlingDefense','grappling','pace','finishing','strengthOfSchedule','recentForm','confidence','eloRaw','bouts','minutes'];

export function predictionGrade(p:Row,bout:Row) {
  if(bout.status==='cancelled')return 'cancelled';
  if(bout.status!=='completed')return 'pending';
  if(![bout.fighter_a_id,bout.fighter_b_id].includes(bout.winner_id)||!p.picked_fighter_id||!(Date.parse(p.locked_at)<Date.parse(bout.starts_at)))return 'void';
  return p.picked_fighter_id===bout.winner_id?'correct':'incorrect';
}
export function totalCard(rounds:Row[]) {
  const scored=rounds.filter(r=>r.score_a!==null&&r.score_b!==null);
  return {a:scored.reduce((sum,r)=>sum+r.score_a,0),b:scored.reduce((sum,r)=>sum+r.score_b,0),scored_rounds:scored.length};
}
function publicRating(rating:any){
  if(!rating||typeof rating!=='object')return null;
  const clean:Row={};
  for(const key of PUBLIC_RATING_FIELDS)if(rating[key]!==undefined)clean[key]=rating[key];
  return clean;
}
function publicDriver(driver:any){
  if(!driver||!['a','b'].includes(driver.side)||!driver.label)return null;
  return {label:String(driver.label),side:driver.side};
}
export function publicPredictionSnapshot(snapshot:any){
  if(!snapshot||typeof snapshot!=='object')return snapshot;
  if(!snapshot.available)return {available:false,reason:snapshot.reason||'The original pre-fight snapshot is unavailable.'};
  const a=snapshot.fighters?.a,b=snapshot.fighters?.b;
  if(!a||!b)return {available:false,reason:'The original pre-fight snapshot is unavailable.'};
  return {
    available:true,
    provenance:snapshot.provenance,
    source_max_date:snapshot.source_max_date,
    cmr_version:snapshot.cmr_version,
    model_used:snapshot.model_used,
    fighters:{
      a:{name:a.name,slug:a.slug,rating:publicRating(a.rating)},
      b:{name:b.name,slug:b.slug,rating:publicRating(b.rating)}
    },
    drivers:Array.isArray(snapshot.drivers)?snapshot.drivers.map(publicDriver).filter(Boolean):[]
  };
}
async function commentary(db:D1Database,id:number){
  const rows=await db.prepare(`SELECT fc.contributor_id,c.slug,c.display_name,c.bio,fc.rounds_json,fc.final_thoughts,fc.revision
    FROM fight_commentary fc JOIN contributors c ON c.id=fc.contributor_id WHERE fc.bout_id=? ORDER BY c.display_name COLLATE NOCASE,c.id`).bind(id).all<Row>();
  return rows.results.map(({rounds_json,...row})=>{const rounds=parse(rounds_json,[]);return {...row,rounds,totals:totalCard(rounds)};});
}
export async function getFight(id:string,env:Env,selected?:string|null):Promise<Row|null> {
  if(!idValid(id)||selected&&!idValid(selected))return null;
  const bout=await env.DB.prepare(`SELECT b.*,e.name event_name,e.event_date,e.starts_at,e.source_url,
    a.name fighter_a_name,a.slug fighter_a_slug,z.name fighter_b_name,z.slug fighter_b_slug,
    s.last_success_at results_success_at,s.last_attempted_at results_checked_at,s.error results_error
    FROM bouts b JOIN events e ON e.id=b.event_id JOIN fighters a ON a.id=b.fighter_a_id JOIN fighters z ON z.id=b.fighter_b_id
    LEFT JOIN event_result_sync s ON s.event_id=e.id WHERE b.id=?`).bind(Number(id)).first<Row>();
  if(!bout)return null;
  const rows=await env.DB.prepare(`SELECT p.*,mv.name model_name,mv.version model_version,COALESCE(p.input_snapshot_json,s.snapshot_json) snapshot_json
    FROM predictions p JOIN model_versions mv ON mv.id=p.model_version_id LEFT JOIN prediction_snapshots s ON s.prediction_id=p.id
    WHERE p.bout_id=? ORDER BY CASE
      WHEN mv.name='CageMetrix Win Probability' AND mv.version='0.2.1' THEN 0
      WHEN mv.name='CageMetrix Win Probability' AND mv.version='0.2.0' THEN 1
      WHEN mv.name='CageMetrix Win Probability' AND mv.version='0.1.0' THEN 1
      ELSE 2 END,p.id DESC`).bind(Number(id)).all<Row>();
  if(!rows.results.length)return null;
  const predictions:Row[]=rows.results.map(({snapshot_json,input_snapshot_json,top_factors_json,input_snapshot_key,...p})=>({...p,snapshot:publicPredictionSnapshot(parse(snapshot_json)),saved_drivers:parse(top_factors_json,[]).map(publicDriver).filter(Boolean),grade:predictionGrade(p,bout)}));
  const prediction=selected?predictions.find(p=>p.id===Number(selected)):predictions[0];
  if(!prediction)return null;
  const related:Row[]=[];
  const official=bout.source_key?.split(':')[1];
  if(/^\d+$/.test(official||'')){
    const siblings=await env.DB.prepare(`SELECT b.id,b.status,a.name fighter_a_name,z.name fighter_b_name FROM bouts b
      JOIN fighters a ON a.id=b.fighter_a_id JOIN fighters z ON z.id=b.fighter_b_id
      WHERE b.event_id=? AND b.id<>? AND b.source_key LIKE ? AND EXISTS(SELECT 1 FROM predictions p WHERE p.bout_id=b.id) ORDER BY b.id`).bind(bout.event_id,bout.id,`ufc:${official}:%`).all<Row>();
    related.push(...siblings.results);
  }
  const observation=await env.DB.prepare('SELECT source_url,observed_at FROM bout_result_observations WHERE bout_id=? ORDER BY id DESC LIMIT 1').bind(bout.id).first();
  const now=Date.now(),start=Date.parse(bout.starts_at);
  return {bout:{...bout,event_live:now>=start-1800000&&now<=start+43200000},prediction,
    predictions:predictions.map(({snapshot,saved_drivers,notes,...p})=>p),related,commentary:await commentary(env.DB,bout.id),
    official_observation:observation,page_refresh_seconds:30,canonical:`https://cagemetrix.com/fights/${bout.id}`};
}
export async function fightApi(request:Request,env:Env,id:string,download=false){
  if(download)return fightJson({error:'not_found'},404);
  const payload=await getFight(id,env,new URL(request.url).searchParams.get('prediction'));
  if(!payload)return fightJson({error:'fight_not_found'},404);
  return fightJson(payload);
}
export async function fightPage(request:Request,env:Env,id:string){
  const payload=await getFight(id,env,new URL(request.url).searchParams.get('prediction'));
  if(!payload)return new Response('<!doctype html><html lang="en"><meta name="robots" content="noindex"><title>Fight not found — CageMetrix</title><h1>Fight not found</h1><p><a href="/predictions.html">Back to predictions</a></p></html>',{status:404,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
  const {bout,prediction,canonical}=payload;
  const names=prediction.snapshot?.available?prediction.snapshot.fighters:null;
  const matchup=`${names?.a.name||bout.fighter_a_name} vs ${names?.b.name||bout.fighter_b_name}`;
  const title=`${matchup} — Prediction & Scorecards | CageMetrix`;
  const description=`${matchup}: locked ${(prediction.fighter_a_probability*100).toFixed(1)}% / ${(prediction.fighter_b_probability*100).toFixed(1)}% prediction, preserved pre-fight stats, official result and contributor round scorecards.`;
  const assetUrl=new URL('/fight.html',request.url);
  const asset=await env.ASSETS.fetch(new Request(assetUrl,{method:'GET'}));
  const transformed=new HTMLRewriter()
    .on('title',{element(el){el.setInnerContent(title);}})
    .on('#fight-title',{element(el){el.setInnerContent(matchup);}})
    .on('meta[name="description"]',{element(el){el.setAttribute('content',description);}})
    .on('head',{element(el){el.append(`<link rel="canonical" href="${canonical}"><meta property="og:type" content="article"><meta property="og:url" content="${canonical}"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta name="twitter:card" content="summary"><meta name="twitter:title" content="${escape(title)}"><meta name="twitter:description" content="${escape(description)}">`,{html:true});}})
    .on('#fight-data',{element(el){el.setInnerContent(JSON.stringify(payload).replace(/</g,'\\u003c'),{html:true});}}).transform(asset);
  const response=new Response(transformed.body,transformed);
  response.headers.set('cache-control','no-store');
  response.headers.set('x-content-type-options','nosniff');
  response.headers.set('referrer-policy','strict-origin-when-cross-origin');
  return response;
}

export async function contributor(request:Request,db:D1Database){
  const token=request.headers.get('authorization')?.match(/^Bearer (cm_[A-Za-z0-9_-]{43})$/)?.[1];
  if(!token)return null;
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');
  return db.prepare(`SELECT c.id,c.slug,c.display_name FROM contributor_keys k JOIN contributors c ON c.id=k.contributor_id
    WHERE k.token_hash=? AND k.revoked_at IS NULL`).bind(hash).first<Row>();
}
export function validateCard(body:any,bout:Row,now=Date.now()):string|null {
  if(!body||!Number.isInteger(body.revision)||body.revision<0||!Array.isArray(body.rounds)||body.rounds.length>5||typeof body.final_thoughts!=='string'||body.final_thoughts.length>6000)return 'Invalid card. Include a revision, rounds, and Final Thoughts.';
  const ids=new Set();
  const max=bout.status==='completed'&&Number.isInteger(bout.result_round)?Math.min(bout.scheduled_rounds,bout.result_round):bout.scheduled_rounds;
  for(const r of body.rounds){
    if(!r||!Number.isInteger(r.round)||r.round<1||r.round>Math.min(5,max)||ids.has(r.round)||typeof r.text!=='string'||r.text.length>4000)return 'Invalid, duplicate, or unplayed round.';
    ids.add(r.round);
    if(!((r.score_a===null&&r.score_b===null)||(Number.isInteger(r.score_a)&&Number.isInteger(r.score_b)&&Math.min(r.score_a,r.score_b)>=7&&Math.max(r.score_a,r.score_b)===10)))return 'Use 10-9, 10-8, 10-7 or 10-10; leave both scores empty for an unscored round.';
    if((r.text.trim()||r.score_a!==null)&&(bout.status==='cancelled'||!Number.isFinite(Date.parse(bout.starts_at))||now<Date.parse(bout.starts_at)))return 'Round commentary opens when the event starts. Cancelled matchups cannot receive round scores.';
  }
  return null;
}
export async function saveCommentary(request:Request,env:Env,id:string){
  const who=await contributor(request,env.DB);
  if(!who)return fightJson({error:'A valid contributor publishing key is required.'},401);
  const origin=request.headers.get('origin');
  if(origin&&origin!==new URL(request.url).origin)return fightJson({error:'Cross-origin publishing is not allowed.'},403);
  if(!request.headers.get('content-type')?.startsWith('application/json'))return fightJson({error:'Send application/json.'},415);
  // Bound streamed request bodies too; a missing Content-Length is not a bypass.
  const reader=request.body?.getReader();if(!reader)return fightJson({error:'Card required.'},400);
  const chunks:Uint8Array[]=[];let length=0;
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>32000){await reader.cancel();return fightJson({error:'Card is too large.'},413);}chunks.push(value);}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let body;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{return fightJson({error:'Invalid JSON.'},400);}
  if(!idValid(id))return fightJson({error:'fight_not_found'},404);
  const bout=await env.DB.prepare(`SELECT b.*,e.starts_at FROM bouts b JOIN events e ON e.id=b.event_id WHERE b.id=? AND EXISTS(SELECT 1 FROM predictions p WHERE p.bout_id=b.id)`).bind(Number(id)).first<Row>();
  if(!bout)return fightJson({error:'fight_not_found'},404);
  const error=validateCard(body,bout);if(error)return fightJson({error},400);
  const rounds=JSON.stringify(body.rounds.map((r:Row)=>({round:r.round,text:r.text.trim(),score_a:r.score_a,score_b:r.score_b})).sort((a:Row,b:Row)=>a.round-b.round));
  // The key chooses the contributor. Clients cannot publish as another name.
  // Optimistic revision checks prevent two editors overwriting each other.
  const result=body.revision===0
    ?await env.DB.prepare(`INSERT INTO fight_commentary(bout_id,contributor_id,rounds_json,final_thoughts,revision) VALUES(?,?,?,?,1) ON CONFLICT(bout_id,contributor_id) DO NOTHING RETURNING revision`).bind(bout.id,who.id,rounds,body.final_thoughts.trim()).first()
    :await env.DB.prepare(`UPDATE fight_commentary SET rounds_json=?,final_thoughts=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE bout_id=? AND contributor_id=? AND revision=? RETURNING revision`).bind(rounds,body.final_thoughts.trim(),bout.id,who.id,body.revision).first();
  if(!result)return fightJson({error:'This card changed in another editor. Reload your published card before saving.'},409);
  return fightJson({revision:result.revision,commentary:await commentary(env.DB,bout.id)});
}
