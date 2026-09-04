import {RESULT_POLL_SECONDS,PAGE_POLL_SECONDS} from './live-results.ts';

type Env={DB:D1Database};
type Row=Record<string,any>;
const PREDICTOR_VERSION='0.2.1';

function parse(value:unknown,fallback:any=null){if(typeof value!=='string'||!value)return fallback;try{return JSON.parse(value)||fallback;}catch{return fallback;}}
function json(data:unknown,cacheSeconds=15){return new Response(JSON.stringify(data),{headers:{'content-type':'application/json; charset=utf-8','cache-control':`public, max-age=${cacheSeconds}`}});}
async function dataStatus(env:Env){
  const row=await env.DB.prepare("SELECT value FROM bootstrap_state WHERE key='data:latest'").first<Row>();
  const value=parse(row?.value);if(!value)return null;
  const ageDays=Math.max(0,Math.floor((Date.now()-Date.parse(`${value.source_max_date}T00:00:00Z`))/86400000));
  return {...value,age_days:ageDays,stale:ageDays>21};
}

export async function predictorForecasts(env:Env):Promise<Response>{
  const result=await env.DB.prepare(`
    SELECT p.id,p.bout_id,p.created_at,p.locked_at,p.fighter_a_probability,p.fighter_b_probability,
      p.picked_fighter_id,p.sample_strength,p.notes,p.input_snapshot_key,
      e.name AS event_name,e.event_date,e.starts_at,e.slug AS event_slug,e.source_url,
      b.status,b.weight_class,b.bout_order,b.winner_id,b.result_method,b.updated_at AS result_updated_at,
      s.last_attempted_at AS results_checked_at,s.last_success_at AS results_success_at,s.error AS results_error,
      a.id AS fighter_a_id,a.name AS fighter_a_name,a.slug AS fighter_a_slug,
      z.id AS fighter_b_id,z.name AS fighter_b_name,z.slug AS fighter_b_slug,
      mv.version AS model_version,
      CASE WHEN b.status='completed' AND b.winner_id IS NOT NULL
        AND p.picked_fighter_id IS NOT NULL AND p.locked_at < e.starts_at
        THEN CASE WHEN p.picked_fighter_id=b.winner_id THEN 'correct' ELSE 'incorrect' END
        WHEN b.status='cancelled' THEN 'cancelled'
        WHEN b.status='completed' THEN 'void' ELSE 'pending' END AS grade
    FROM predictions p JOIN bouts b ON b.id=p.bout_id
    JOIN events e ON e.id=b.event_id JOIN model_versions mv ON mv.id=p.model_version_id
    JOIN fighters a ON a.id=b.fighter_a_id JOIN fighters z ON z.id=b.fighter_b_id
    LEFT JOIN event_result_sync s ON s.event_id=e.id
    WHERE mv.name='CageMetrix Win Probability' AND mv.version=?
    ORDER BY e.event_date DESC,b.bout_order,p.id
  `).bind(PREDICTOR_VERSION).all<Row>();
  const rows:Row[]=(result.results||[]).map((row:Row)=>({...row,
    fight_url:`/fights/${row.bout_id}`,
    event_live:Date.now()>=Date.parse(row.starts_at)-30*60_000&&Date.now()<=Date.parse(row.starts_at)+12*3_600_000
  }));
  const pollerRow=await env.DB.prepare("SELECT value FROM bootstrap_state WHERE key='results:poller'").first<Row>();
  const graded:Row[]=rows.filter((r:Row)=>r.grade==='correct'||r.grade==='incorrect');
  const correct=graded.filter((r:Row)=>r.grade==='correct').length;
  const brier=graded.length?graded.reduce((sum:number,r:Row)=>sum+(Number(r.fighter_a_probability)-Number(r.winner_id===r.fighter_a_id))**2,0)/graded.length:null;
  return json({data:rows,summary:{
    correct,incorrect:graded.length-correct,graded:graded.length,
    accuracy:graded.length?correct/graded.length:null,brier,
    pending:rows.filter((r:Row)=>r.grade==='pending').length,
    void:rows.filter((r:Row)=>r.grade==='void'||r.grade==='cancelled').length,
    first_prediction_at:rows.map((r:Row)=>r.locked_at).sort()[0]||null,
    policy:'Only predictions saved before the event starts are graded. Draws, no-contests, cancellations and 50/50 no-picks are excluded. Historical backtests are separate.'
  },meta:{model_version:PREDICTOR_VERSION,data:await dataStatus(env),live_results:{
    poll_seconds:RESULT_POLL_SECONDS,page_refresh_seconds:PAGE_POLL_SECONDS,
    scheduler:parse(pollerRow?.value),source:'UFC official live results feed'
  }}});
}
