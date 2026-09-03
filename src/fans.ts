type Env={DB:D1Database};
type Row=Record<string,any>;

const PUBLIC_MODEL='CageMetrix Win Probability';
const PUBLIC_VERSION='0.1.0';
const COOKIE='cm_fan_id';
const SCORECARD_WINDOW_MS=48*60*60*1000;
const idValid=(id:string)=>/^[1-9]\d{0,14}$/.test(id)&&Number.isSafeInteger(Number(id));

function fanJson(data:unknown,status=200,setCookie?:string){
  const headers=new Headers({'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
  if(setCookie)headers.append('set-cookie',setCookie);
  return new Response(JSON.stringify(data),{status,headers});
}

export function fanIdentity(request:Request){
  const raw=request.headers.get('cookie')||'';
  const found=raw.split(';').map(v=>v.trim()).find(v=>v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length+1);
  if(found&&/^[0-9a-f-]{36}$/i.test(found))return {id:found,setCookie:undefined};
  const id=crypto.randomUUID();
  return {id,setCookie:`${COOKIE}=${id}; Max-Age=31536000; Path=/; HttpOnly; Secure; SameSite=Lax`};
}

async function trackedBout(db:D1Database,id:string){
  if(!idValid(id))return null;
  return db.prepare(`SELECT b.*,e.starts_at,e.name event_name,e.event_date,
    CASE WHEN s.last_changed_at IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM bouts terminal_check
      WHERE terminal_check.event_id=e.id AND terminal_check.status NOT IN ('completed','cancelled')
    ) THEN s.last_changed_at ELSE NULL END AS card_finished_at,
    a.name fighter_a_name,a.slug fighter_a_slug,z.name fighter_b_name,z.slug fighter_b_slug
    FROM bouts b JOIN events e ON e.id=b.event_id
    JOIN fighters a ON a.id=b.fighter_a_id JOIN fighters z ON z.id=b.fighter_b_id
    LEFT JOIN event_result_sync s ON s.event_id=e.id
    WHERE b.id=? AND EXISTS(
      SELECT 1 FROM predictions p JOIN model_versions mv ON mv.id=p.model_version_id
      WHERE p.bout_id=b.id AND mv.name=? AND mv.version=?
    )`).bind(Number(id),PUBLIC_MODEL,PUBLIC_VERSION).first<Row>();
}

function predictionGrade(bout:Row,pick:number|null){
  if(bout.status==='cancelled')return 'void';
  if(bout.status!=='completed')return 'pending';
  if(![bout.fighter_a_id,bout.fighter_b_id].includes(bout.winner_id)||!pick)return 'void';
  return pick===bout.winner_id?'correct':'incorrect';
}

export function scorableRounds(bout:Row){
  if(bout.status!=='completed')return 0;
  const scheduled=Math.max(0,Math.min(5,Number(bout.scheduled_rounds)||0));
  const resultRound=Math.max(0,Math.min(scheduled,Number(bout.result_round)||scheduled));
  if(/decision/i.test(String(bout.result_method||'')))return resultRound||scheduled;
  // A finish ends the current round before it is complete. Every earlier round
  // remains available for fan scoring (for example, a R3 KO leaves R1-R2 scorable).
  return Math.max(0,resultRound-1);
}

export function fanScorecardWindow(bout:Row,now=Date.now()){
  const rounds=scorableRounds(bout);
  if(bout.status!=='completed'||rounds<1)return {open:false,closed:false,closes_at:null as string|null};
  const finished=Date.parse(String(bout.card_finished_at||''));
  // A completed fight can be scored while the rest of the card is still live.
  // The 48-hour clock begins only after the last tracked bout is officially final.
  if(!Number.isFinite(finished))return {open:true,closed:false,closes_at:null as string|null};
  const closes=finished+SCORECARD_WINDOW_MS;
  return {open:now<closes,closed:now>=closes,closes_at:new Date(closes).toISOString()};
}

export function validateFanScorecard(body:any,bout:Row){
  const required=scorableRounds(bout);
  if(required<1)return 'There are no completed rounds available for a fan scorecard.';
  if(!body||!Array.isArray(body.rounds)||body.rounds.length!==required)return `Score all ${required} completed round${required===1?'':'s'} before submitting.`;
  const seen=new Set<number>();
  for(const row of body.rounds){
    if(!row||!Number.isInteger(row.round)||row.round<1||row.round>required||seen.has(row.round))return 'Invalid or duplicate round.';
    seen.add(row.round);
    const a=row.score_a,b=row.score_b;
    if(!Number.isInteger(a)||!Number.isInteger(b)||Math.max(a,b)!==10||Math.min(a,b)<7)return 'Use a valid ten-point-must score such as 10-9, 10-8, 10-7, or 10-10.';
  }
  for(let round=1;round<=required;round++)if(!seen.has(round))return `Round ${round} is missing.`;
  return null;
}

function consensusPick(aVotes:number,bVotes:number,bout:Row){
  if(aVotes===bVotes)return null;
  return aVotes>bVotes?Number(bout.fighter_a_id):Number(bout.fighter_b_id);
}

async function summary(db:D1Database,bout:Row,voterId:string){
  const [voteRow,myVote,model,overall,roundRows,myCard]=await Promise.all([
    db.prepare(`SELECT COUNT(*) total,
      SUM(CASE WHEN picked_fighter_id=? THEN 1 ELSE 0 END) a_votes,
      SUM(CASE WHEN picked_fighter_id=? THEN 1 ELSE 0 END) b_votes
      FROM fan_predictions WHERE bout_id=?`).bind(bout.fighter_a_id,bout.fighter_b_id,bout.id).first<Row>(),
    db.prepare('SELECT picked_fighter_id FROM fan_predictions WHERE bout_id=? AND voter_id=?').bind(bout.id,voterId).first<Row>(),
    db.prepare(`SELECT p.fighter_a_probability,p.fighter_b_probability,p.picked_fighter_id
      FROM predictions p JOIN model_versions mv ON mv.id=p.model_version_id
      WHERE p.bout_id=? AND mv.name=? AND mv.version=? ORDER BY p.id DESC LIMIT 1`).bind(bout.id,PUBLIC_MODEL,PUBLIC_VERSION).first<Row>(),
    db.prepare(`SELECT COUNT(*) total,AVG(total_a) avg_total_a,AVG(total_b) avg_total_b,
      SUM(CASE WHEN total_a>total_b THEN 1 ELSE 0 END) a_cards,
      SUM(CASE WHEN total_b>total_a THEN 1 ELSE 0 END) b_cards,
      SUM(CASE WHEN total_a=total_b THEN 1 ELSE 0 END) tied_cards
      FROM fan_scorecards WHERE bout_id=?`).bind(bout.id).first<Row>(),
    db.prepare(`SELECT CAST(json_extract(j.value,'$.round') AS INTEGER) round,COUNT(*) total,
      AVG(CAST(json_extract(j.value,'$.score_a') AS REAL)) avg_score_a,
      AVG(CAST(json_extract(j.value,'$.score_b') AS REAL)) avg_score_b,
      SUM(CASE WHEN json_extract(j.value,'$.score_a')>json_extract(j.value,'$.score_b') THEN 1 ELSE 0 END) a_cards,
      SUM(CASE WHEN json_extract(j.value,'$.score_b')>json_extract(j.value,'$.score_a') THEN 1 ELSE 0 END) b_cards,
      SUM(CASE WHEN json_extract(j.value,'$.score_a')=json_extract(j.value,'$.score_b') THEN 1 ELSE 0 END) tied_cards
      FROM fan_scorecards fs,json_each(fs.rounds_json) j WHERE fs.bout_id=? GROUP BY round ORDER BY round`).bind(bout.id).all<Row>(),
    db.prepare('SELECT rounds_json,total_a,total_b,scored_rounds FROM fan_scorecards WHERE bout_id=? AND voter_id=?').bind(bout.id,voterId).first<Row>()
  ]);
  const total=Number(voteRow?.total||0),aVotes=Number(voteRow?.a_votes||0),bVotes=Number(voteRow?.b_votes||0);
  const pick=consensusPick(aVotes,bVotes,bout);
  const now=Date.now(),lock=Date.parse(bout.starts_at);
  const predictionOpen=bout.status==='scheduled'&&Number.isFinite(lock)&&now<lock;
  const cardTotal=Number(overall?.total||0);
  const cardWindow=fanScorecardWindow(bout,now);
  const rounds=(roundRows.results||[]).map((r:Row)=>({
    round:Number(r.round),total:Number(r.total||0),
    average_a:r.avg_score_a===null?null:Number(r.avg_score_a),average_b:r.avg_score_b===null?null:Number(r.avg_score_b),
    a_pct:Number(r.total)?Number(r.a_cards||0)/Number(r.total):null,
    b_pct:Number(r.total)?Number(r.b_cards||0)/Number(r.total):null,
    tie_pct:Number(r.total)?Number(r.tied_cards||0)/Number(r.total):null
  }));
  let mine=null;
  if(myCard){try{mine={rounds:JSON.parse(String(myCard.rounds_json)),total_a:Number(myCard.total_a),total_b:Number(myCard.total_b),scored_rounds:Number(myCard.scored_rounds)};}catch{mine=null;}}
  const myPickId=myVote?.picked_fighter_id?Number(myVote.picked_fighter_id):null;
  return {
    bout:{id:Number(bout.id),status:bout.status,starts_at:bout.starts_at,event_name:bout.event_name,event_date:bout.event_date,card_finished_at:bout.card_finished_at||null,
      fighter_a_id:Number(bout.fighter_a_id),fighter_a_name:bout.fighter_a_name,fighter_a_slug:bout.fighter_a_slug,
      fighter_b_id:Number(bout.fighter_b_id),fighter_b_name:bout.fighter_b_name,fighter_b_slug:bout.fighter_b_slug,
      winner_id:bout.winner_id===null?null:Number(bout.winner_id),result_method:bout.result_method,result_round:bout.result_round,scheduled_rounds:bout.scheduled_rounds},
    model:{fighter_a_probability:Number(model?.fighter_a_probability||0),fighter_b_probability:Number(model?.fighter_b_probability||0),grade:predictionGrade(bout,model?.picked_fighter_id?Number(model.picked_fighter_id):null)},
    prediction:{open:predictionOpen,lock_at:bout.starts_at,lock_policy:'Fan picks lock at the published card start because exact individual bout start times are not reliably available.',
      total,a_votes:aVotes,b_votes:bVotes,a_pct:total?aVotes/total:null,b_pct:total?bVotes/total:null,
      consensus_pick:pick===bout.fighter_a_id?'a':pick===bout.fighter_b_id?'b':null,
      grade:total?predictionGrade(bout,pick):'no_votes',my_pick:myPickId===bout.fighter_a_id?'a':myPickId===bout.fighter_b_id?'b':null},
    scorecards:{...cardWindow,scorable_rounds:scorableRounds(bout),total:cardTotal,
      lock_policy:'Fan scorecards open after a fight is final and lock 48 hours after the full card finishes. Finishes leave all previously completed rounds scorable.',
      overall:{average_a:cardTotal?Number(overall?.avg_total_a):null,average_b:cardTotal?Number(overall?.avg_total_b):null,
        a_pct:cardTotal?Number(overall?.a_cards||0)/cardTotal:null,b_pct:cardTotal?Number(overall?.b_cards||0)/cardTotal:null,tie_pct:cardTotal?Number(overall?.tied_cards||0)/cardTotal:null},
      rounds,mine}
  };
}

function writeAllowed(request:Request){
  const origin=request.headers.get('origin');
  return !origin||origin===new URL(request.url).origin;
}

async function body(request:Request,max=4096){
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw new Error('content_type');
  const text=await request.text();
  if(new TextEncoder().encode(text).length>max)throw new Error('too_large');
  try{return JSON.parse(text);}catch{throw new Error('invalid_json');}
}

export async function getFanSummary(request:Request,env:Env,id:string){
  const identity=fanIdentity(request),bout=await trackedBout(env.DB,id);
  if(!bout)return fanJson({error:'fight_not_found'},404,identity.setCookie);
  return fanJson(await summary(env.DB,bout,identity.id),200,identity.setCookie);
}

export async function saveFanPrediction(request:Request,env:Env,id:string){
  const identity=fanIdentity(request);
  if(!writeAllowed(request))return fanJson({error:'Cross-origin fan voting is not allowed.'},403,identity.setCookie);
  const bout=await trackedBout(env.DB,id);if(!bout)return fanJson({error:'fight_not_found'},404,identity.setCookie);
  const lock=Date.parse(bout.starts_at);
  if(bout.status!=='scheduled'||!Number.isFinite(lock)||Date.now()>=lock)return fanJson({error:'Fan predictions are locked for this fight.'},409,identity.setCookie);
  let input:any;try{input=await body(request,1024);}catch(error:any){return fanJson({error:error.message==='content_type'?'Send application/json.':error.message==='too_large'?'Request is too large.':'Invalid JSON.'},error.message==='content_type'?415:error.message==='too_large'?413:400,identity.setCookie);}
  if(!input||!['a','b'].includes(input.pick))return fanJson({error:'Pick fighter a or b.'},400,identity.setCookie);
  const picked=input.pick==='a'?bout.fighter_a_id:bout.fighter_b_id;
  try{
    await env.DB.prepare(`INSERT INTO fan_predictions(bout_id,voter_id,picked_fighter_id) VALUES(?,?,?)
      ON CONFLICT(bout_id,voter_id) DO UPDATE SET picked_fighter_id=excluded.picked_fighter_id,updated_at=CURRENT_TIMESTAMP`).bind(bout.id,identity.id,picked).run();
  }catch(error:any){if(/locked/i.test(String(error?.message||error)))return fanJson({error:'Fan predictions are locked for this fight.'},409,identity.setCookie);throw error;}
  return fanJson(await summary(env.DB,bout,identity.id),200,identity.setCookie);
}

export async function saveFanScorecard(request:Request,env:Env,id:string){
  const identity=fanIdentity(request);
  if(!writeAllowed(request))return fanJson({error:'Cross-origin fan scorecards are not allowed.'},403,identity.setCookie);
  const bout=await trackedBout(env.DB,id);if(!bout)return fanJson({error:'fight_not_found'},404,identity.setCookie);
  if(bout.status!=='completed')return fanJson({error:'Fan scorecards open after the official fight result is confirmed.'},409,identity.setCookie);
  const window=fanScorecardWindow(bout);
  if(window.closed)return fanJson({error:'Fan scorecard submissions closed 48 hours after this card finished.'},409,identity.setCookie);
  let input:any;try{input=await body(request,4096);}catch(error:any){return fanJson({error:error.message==='content_type'?'Send application/json.':error.message==='too_large'?'Request is too large.':'Invalid JSON.'},error.message==='content_type'?415:error.message==='too_large'?413:400,identity.setCookie);}
  const validation=validateFanScorecard(input,bout);if(validation)return fanJson({error:validation},400,identity.setCookie);
  const rounds=input.rounds.map((r:Row)=>({round:r.round,score_a:r.score_a,score_b:r.score_b})).sort((a:Row,b:Row)=>a.round-b.round);
  const totalA=rounds.reduce((n:number,r:Row)=>n+r.score_a,0),totalB=rounds.reduce((n:number,r:Row)=>n+r.score_b,0);
  await env.DB.prepare(`INSERT INTO fan_scorecards(bout_id,voter_id,rounds_json,total_a,total_b,scored_rounds) VALUES(?,?,?,?,?,?)
    ON CONFLICT(bout_id,voter_id) DO UPDATE SET rounds_json=excluded.rounds_json,total_a=excluded.total_a,total_b=excluded.total_b,scored_rounds=excluded.scored_rounds,updated_at=CURRENT_TIMESTAMP`).bind(bout.id,identity.id,JSON.stringify(rounds),totalA,totalB,rounds.length).run();
  return fanJson(await summary(env.DB,bout,identity.id),200,identity.setCookie);
}

export async function fanRecord(request:Request,env:Env){
  const identity=fanIdentity(request);
  const rows=await env.DB.prepare(`WITH consensus AS (
    SELECT fp.bout_id,COUNT(*) total,
      SUM(CASE WHEN fp.picked_fighter_id=b.fighter_a_id THEN 1 ELSE 0 END) a_votes,
      SUM(CASE WHEN fp.picked_fighter_id=b.fighter_b_id THEN 1 ELSE 0 END) b_votes
    FROM fan_predictions fp JOIN bouts b ON b.id=fp.bout_id GROUP BY fp.bout_id
  )
  SELECT c.*,b.status,b.fighter_a_id,b.fighter_b_id,b.winner_id,
    p.fighter_a_probability model_a_probability,p.picked_fighter_id model_pick
  FROM consensus c JOIN bouts b ON b.id=c.bout_id
  JOIN predictions p ON p.bout_id=b.id
  JOIN model_versions mv ON mv.id=p.model_version_id
  WHERE mv.name=? AND mv.version=? ORDER BY b.id`).bind(PUBLIC_MODEL,PUBLIC_VERSION).all<Row>();
  let totalPicks=0,decisive=0,fanAccuracyN=0,fanCorrect=0,fanBrier=0,modelAccuracyN=0,modelCorrect=0,modelBrier=0;
  for(const row of rows.results){
    const total=Number(row.total||0),aVotes=Number(row.a_votes||0),bVotes=Number(row.b_votes||0);totalPicks+=total;
    if(row.status!=='completed'||![row.fighter_a_id,row.fighter_b_id].includes(row.winner_id)||!total)continue;
    decisive++;
    const outcome=row.winner_id===row.fighter_a_id?1:0,fanP=aVotes/total,modelP=Number(row.model_a_probability);
    fanBrier+=(fanP-outcome)**2;modelBrier+=(modelP-outcome)**2;
    if(aVotes!==bVotes){fanAccuracyN++;const fanPick=aVotes>bVotes?row.fighter_a_id:row.fighter_b_id;if(fanPick===row.winner_id)fanCorrect++;}
    if(row.model_pick){modelAccuracyN++;if(row.model_pick===row.winner_id)modelCorrect++;}
  }
  return fanJson({
    tracked_fights:rows.results.length,total_picks:totalPicks,decisive_fights:decisive,
    fan:{correct:fanCorrect,graded:fanAccuracyN,accuracy:fanAccuracyN?fanCorrect/fanAccuracyN:null,brier:decisive?fanBrier/decisive:null},
    model_same_fights:{correct:modelCorrect,graded:modelAccuracyN,accuracy:modelAccuracyN?modelCorrect/modelAccuracyN:null,brier:decisive?modelBrier/decisive:null},
    policy:'Fans make one anonymous browser pick per tracked fight. Picks may change only before the published card start, then stay locked. Fans-vs-model metrics use only decisive fights that received fan picks; 50/50 fan ties are excluded from fan accuracy but remain in Brier score.'
  },200,identity.setCookie);
}
