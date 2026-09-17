import {currentAccount} from './community.ts';

type Env={DB:D1Database;ASSETS:Fetcher};
type Row=Record<string,any>;
const headers={'content-type':'application/json; charset=utf-8','cache-control':'private, no-store'};
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
const error=(message:string,status=400)=>reply({error:message},status);
const BOTS=['The Cutmen','Late Replacement','Southpaw Society','Cage Cartel','Corner Crew','The Clinch','Mat Rats'];
const ROUNDS=4;

export function draftPosition(pick:number,seats:number){
  const round=Math.floor(pick/seats),index=pick%seats;
  return round%2===0?index:seats-1-index;
}
export function normalizeTier(value:unknown){return value==='premier'||value==='challengers'?value:null;}

async function pool(db:D1Database,tier:string,limit=150):Promise<Row[]>{
  if(tier==='premier'){
    const result=await db.prepare(`SELECT 'ufc:'||f.id fighter_key,f.name fighter_name,
      f.current_weight_class division,COALESCE(MAX(e.event_date),'') last_fight
      FROM fighters f JOIN bouts b ON b.fighter_a_id=f.id OR b.fighter_b_id=f.id
      JOIN events e ON e.id=b.event_id
      WHERE f.active=1 AND e.promotion='UFC' AND b.status='completed'
      GROUP BY f.id HAVING MAX(e.event_date)>=date('now','-3 years')
      ORDER BY last_fight DESC,f.id LIMIT ?`).bind(limit).all<Row>();
    return result.results||[];
  }
  const result=await db.prepare(`SELECT 'regional:'||p.source_key||':'||p.source_fighter_id fighter_key,
    p.fighter_name,p.current_weight_class division,p.last_fight_date last_fight
    FROM scout_active_global_profiles p JOIN scout_promotions sp ON sp.slug=p.current_promotion_slug
    WHERE sp.active=1 AND sp.scope LIKE 'regional%' AND p.career_bouts>=2
      AND p.last_fight_date>=date('now','-3 years')
      AND NOT EXISTS (SELECT 1 FROM scout_active_global_profiles q WHERE q.source_key=p.source_key
        AND q.source_fighter_id=p.source_fighter_id AND q.snapshot_id<>p.snapshot_id)
    ORDER BY p.last_fight_date DESC,p.source_fighter_id LIMIT ?`).bind(limit).all<Row>();
  return result.results||[];
}

export function scorePremier(result:Row){
  if(result.status!=='completed')return 0;
  const win=Number(result.won)===1;
  const method=String(result.result_method||'').toLowerCase();
  const finish=win&&(/ko|tko|submission|tap|choke/.test(method));
  return Math.round(((win?10:0)+(finish?8:0)+Number(result.knockdowns||0)*3+
    Number(result.sig_strikes||0)*0.1+Number(result.takedowns||0)*2+
    Number(result.control_seconds||0)/60)*10)/10;
}
export function scoreChallenger(result:Row){
  const win=result.result==='W';if(!win)return 0;
  const method=String(result.method||'').toLowerCase();
  const finish=/ko|tko|submission|tap|choke/.test(method);
  const round=Number(result.round_num);
  return 10+(finish?8:3)+(finish&&round>0?(round===1?5:round===2?3:1):0);
}
async function standings(db:D1Database,state:any){
  const league=state.league as Row,ids=state.picks.map((p:Row)=>p.fighter_key);
  const points=new Map<string,number>();
  if(ids.length){
    if(league.tier==='premier'){
      const rows=await db.prepare(`SELECT 'ufc:'||f.id fighter_key,b.id,b.status,b.result_method,
        CASE WHEN b.winner_id=f.id THEN 1 ELSE 0 END won,
        COALESCE(SUM(rs.knockdowns),0) knockdowns,COALESCE(SUM(rs.sig_strikes_landed),0) sig_strikes,
        COALESCE(SUM(rs.takedowns_landed),0) takedowns,COALESCE(SUM(rs.control_seconds),0) control_seconds
        FROM fantasy_picks fp JOIN fighters f ON fp.fighter_key='ufc:'||f.id
        JOIN bouts b ON (b.fighter_a_id=f.id OR b.fighter_b_id=f.id) AND b.status='completed'
        JOIN events e ON e.id=b.event_id AND e.promotion='UFC' AND e.event_date>=date(?) AND e.event_date<=date('now')
        LEFT JOIN round_stats rs ON rs.bout_id=b.id AND rs.fighter_id=f.id
        WHERE fp.league_id=? GROUP BY f.id,b.id`).bind(league.created_at,league.id).all<Row>();
      for(const row of rows.results||[])points.set(row.fighter_key,(points.get(row.fighter_key)||0)+scorePremier(row));
    }else{
      const rows=await db.prepare(`SELECT 'regional:'||g.source_key||':'||g.source_fighter_id fighter_key,
        g.source_fight_id,g.result,g.method,g.round_num
        FROM fantasy_picks fp JOIN scout_active_global_fights g
          ON fp.fighter_key='regional:'||g.source_key||':'||g.source_fighter_id
        JOIN scout_promotions sp ON sp.slug=g.promotion_slug AND sp.active=1 AND sp.scope LIKE 'regional%'
        WHERE fp.league_id=? AND g.event_date>=date(?) AND g.event_date<=date('now')`).bind(league.id,league.created_at).all<Row>();
      for(const row of rows.results||[])points.set(row.fighter_key,(points.get(row.fighter_key)||0)+scoreChallenger(row));
    }
  }
  return state.managers.map((m:Row)=>({manager_id:m.id,name:m.bot_name||'You',points:Math.round(state.picks.filter((p:Row)=>p.manager_id===m.id).reduce((n:number,p:Row)=>n+(points.get(p.fighter_key)||0),0)*10)/10})).sort((a:Row,b:Row)=>b.points-a.points);
}

async function leagueState(db:D1Database,id:string,accountId:number){
  const league=await db.prepare(`SELECT l.* FROM fantasy_leagues l JOIN fantasy_managers m ON m.league_id=l.id
    WHERE l.id=? AND m.account_id=?`).bind(id,accountId).first<Row>();
  if(!league)return null;
  const managers=(await db.prepare(`SELECT id,account_id,bot_name,draft_position FROM fantasy_managers WHERE league_id=? ORDER BY draft_position`).bind(id).all<Row>()).results||[];
  const picks=(await db.prepare(`SELECT manager_id,pick_number,fighter_key,fighter_name FROM fantasy_picks WHERE league_id=? ORDER BY pick_number`).bind(id).all<Row>()).results||[];
  return {league,managers,picks,turn:picks.length<Number(league.seats)*ROUNDS?draftPosition(picks.length,Number(league.seats)):null};
}

async function makePick(db:D1Database,id:string,manager:Row,fighter:Row,pickNumber:number,seats:number){
  // The count and owner are checked within the insert. Unique indexes arbitrate competing requests.
  const result=await db.prepare(`INSERT OR IGNORE INTO fantasy_picks(league_id,manager_id,pick_number,fighter_key,fighter_name)
    SELECT l.id,m.id,?,?,? FROM fantasy_leagues l JOIN fantasy_managers m ON m.league_id=l.id
    WHERE l.id=? AND l.status='drafting' AND m.id=? AND m.draft_position=?
      AND (SELECT COUNT(*) FROM fantasy_picks WHERE league_id=l.id)=?
      AND NOT EXISTS(SELECT 1 FROM fantasy_picks WHERE league_id=l.id AND fighter_key=?)`).bind(
    pickNumber,fighter.fighter_key,fighter.fighter_name,id,manager.id,draftPosition(pickNumber,seats),pickNumber,fighter.fighter_key).run();
  return Number(result.meta.changes||0)===1;
}

async function advanceBots(db:D1Database,id:string,accountId:number){
  for(let attempt=0;attempt<ROUNDS*8;attempt++){
    const state=await leagueState(db,id,accountId);if(!state||state.turn===null){
      if(state)await db.prepare("UPDATE fantasy_leagues SET status='active' WHERE id=? AND status='drafting'").bind(id).run();
      return;
    }
    const manager=state.managers[state.turn];if(manager.account_id!==null)return;
    const taken=new Set(state.picks.map((p:Row)=>p.fighter_key));
    const candidates=await pool(db,state.league.tier);
    // Bot behavior is deterministic, transparent and draws only from eligible source rows.
    const available=candidates.filter(f=>!taken.has(f.fighter_key));
    const choice=available[manager.draft_position%Math.max(available.length,1)];
    if(!choice)return;
    if(!await makePick(db,id,manager,choice,state.picks.length,Number(state.league.seats)))continue;
  }
}

export async function fantasyApi(request:Request,env:Env):Promise<Response>{
  const url=new URL(request.url);
  const account=await currentAccount(request,env.DB);
  if(!account)return error('Sign in to your MMA Scouts account to create or join a league.',401);
  if(request.method==='GET'&&url.pathname==='/api/fantasy/leagues'){
    const rows=await env.DB.prepare(`SELECT l.id,l.name,l.tier,l.status,l.seats,l.created_at FROM fantasy_leagues l
      JOIN fantasy_managers m ON m.league_id=l.id WHERE m.account_id=? ORDER BY l.created_at DESC LIMIT 30`).bind(account.id).all<Row>();
    return reply({leagues:rows.results||[]});
  }
  if(request.method==='POST'&&url.pathname==='/api/fantasy/leagues'){
    if(request.headers.get('origin')!==url.origin)return error('Origin mismatch.',403);
    if(!request.headers.get('content-type')?.startsWith('application/json'))return error('JSON required.',415);
    const raw=await request.text();if(raw.length>1024)return error('Request too large.',413);
    let body:Row;try{body=JSON.parse(raw)}catch{return error('Invalid JSON.');}
    const name=String(body.name||'').trim(),tier=normalizeTier(body.tier),seats=Number(body.seats);
    if(name.length<3||name.length>60||!tier||!Number.isInteger(seats)||seats<2||seats>8)return error('Choose a name, tier and 2–8 managers.');
    const candidates=await pool(env.DB,tier,seats*ROUNDS);
    if(candidates.length<seats*ROUNDS)return error('This tier does not yet have enough verified fighters for that league size.',409);
    const id=crypto.randomUUID();
    const statements=[env.DB.prepare('INSERT INTO fantasy_leagues(id,owner_account_id,name,tier,seats) VALUES(?,?,?,?,?)').bind(id,account.id,name,tier,seats),
      env.DB.prepare('INSERT INTO fantasy_managers(league_id,account_id,draft_position) VALUES(?,?,0)').bind(id,account.id)];
    for(let i=1;i<seats;i++)statements.push(env.DB.prepare('INSERT INTO fantasy_managers(league_id,bot_name,draft_position) VALUES(?,?,?)').bind(id,BOTS[i-1],i));
    await env.DB.batch(statements);
    await advanceBots(env.DB,id,Number(account.id));
    return reply({id,url:`/fantasy/${id}`},201);
  }
  const match=url.pathname.match(/^\/api\/fantasy\/leagues\/([0-9a-f-]{36})(?:\/(pool|picks))?$/);
  if(!match)return error('Not found.',404);
  const [,id,action]=match;
  const state=await leagueState(env.DB,id,Number(account.id));if(!state)return error('League not found.',404);
  if(request.method==='GET'&&!action)return reply({...state,standings:await standings(env.DB,state)});
  if(request.method==='GET'&&action==='pool'){
    const taken=new Set(state.picks.map((p:Row)=>p.fighter_key));
    return reply({fighters:(await pool(env.DB,state.league.tier)).filter(f=>!taken.has(f.fighter_key))});
  }
  if(request.method==='POST'&&action==='picks'){
    if(request.headers.get('origin')!==url.origin)return error('Origin mismatch.',403);
    if(!request.headers.get('content-type')?.startsWith('application/json'))return error('JSON required.',415);
    const raw=await request.text();if(raw.length>256)return error('Request too large.',413);
    let body:Row;try{body=JSON.parse(raw)}catch{return error('Invalid JSON.');}
    if(state.turn===null||state.managers[state.turn].account_id!==account.id)return error('It is not your turn.',409);
    const fighter=(await pool(env.DB,state.league.tier)).find(f=>f.fighter_key===body.fighter_key);
    if(!fighter)return error('Fighter is not in the current eligible pool.',400);
    if(!await makePick(env.DB,id,state.managers[state.turn],fighter,state.picks.length,Number(state.league.seats)))return error('That pick is no longer available. Refresh the draft.',409);
    await advanceBots(env.DB,id,Number(account.id));
    return reply(await leagueState(env.DB,id,Number(account.id)));
  }
  return error('Method not allowed.',405);
}
