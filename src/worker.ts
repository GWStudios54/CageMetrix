import base from './index.ts';
import {fanRecord,getFanSummary,saveFanPrediction,saveFanScorecard} from './fans.ts';
import {contributor,forgetContributor,rememberContributor,updateContributorProfile} from './contributors.ts';
import {getContributorNotes,saveContributorNote} from './contributor-notes.ts';
import {predictorForecasts} from './forecasts.ts';

interface Env {
  DB:D1Database;
  ASSETS:Fetcher;
  MODEL_VERSION:string;
}

const TOKEN_RE=/^cm_[A-Za-z0-9_-]{43}$/;
function contributorCookie(request:Request){
  const raw=request.headers.get('cookie')||'';
  const token=raw.split(';').map(v=>v.trim()).find(v=>v.startsWith('cm_contributor_key='))?.slice('cm_contributor_key='.length)||null;
  return token&&TOKEN_RE.test(token)?token:null;
}
function withContributorCookie(request:Request){
  if(request.headers.get('authorization')?.match(/^Bearer cm_[A-Za-z0-9_-]{43}$/))return request;
  const token=contributorCookie(request);if(!token)return request;
  const headers=new Headers(request.headers);headers.set('authorization',`Bearer ${token}`);
  return new Request(request,{headers});
}
function withModelCacheKey(request:Request,modelVersion:string){
  if(request.method!=='GET'||!new URL(request.url).pathname.startsWith('/api/'))return request;
  const url=new URL(request.url);url.searchParams.set('_model_version',modelVersion);
  return new Request(url,request);
}
async function forecastsWithFans(request:Request,env:Env){
  const response=await predictorForecasts(env);if(!response.ok)return response;
  const payload:any=await response.json();
  const rows=await env.DB.prepare(`SELECT fp.bout_id,COUNT(*) total,
    SUM(CASE WHEN fp.picked_fighter_id=b.fighter_a_id THEN 1 ELSE 0 END) a_votes,
    SUM(CASE WHEN fp.picked_fighter_id=b.fighter_b_id THEN 1 ELSE 0 END) b_votes
    FROM fan_predictions fp JOIN bouts b ON b.id=fp.bout_id GROUP BY fp.bout_id`).all<Record<string,any>>();
  const fans=new Map((rows.results||[]).map(row=>[Number(row.bout_id),row]));
  payload.data=(payload.data||[]).map((row:any)=>{
    const f:any=fans.get(Number(row.bout_id));
    const total=Number(f?.total||0),a=Number(f?.a_votes||0),b=Number(f?.b_votes||0);
    return {...row,fan_total:total,fan_a_pct:total?a/total:null,fan_b_pct:total?b/total:null,fan_consensus_pick:a===b?null:a>b?'a':'b'};
  });
  const headers=new Headers(response.headers);headers.set('content-type','application/json; charset=utf-8');headers.set('cache-control','public, max-age=15');
  return new Response(JSON.stringify(payload),{status:response.status,headers});
}

export default {
  async scheduled(controller:ScheduledController,env:Env,context:ExecutionContext){
    return base.scheduled(controller,env,context);
  },
  async fetch(request:Request,env:Env,context:ExecutionContext):Promise<Response>{
    const url=new URL(request.url);
    if(request.method==='GET'&&url.pathname==='/api/fans/record')return fanRecord(request,env);
    const notes=url.pathname.match(/^\/api\/fights\/([1-9]\d*)\/notes$/);
    if(notes){
      if(request.method==='GET')return getContributorNotes(request,env,notes[1]);
      if(request.method==='PUT')return saveContributorNote(request,env,notes[1]);
      return new Response(JSON.stringify({error:'method_not_allowed'}),{status:405,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
    }
    const match=url.pathname.match(/^\/api\/fights\/([1-9]\d*)\/(fans|fan-prediction|fan-scorecard)$/);
    if(match){
      if(match[2]==='fans'&&request.method==='GET')return getFanSummary(request,env,match[1]);
      if(match[2]==='fan-prediction'&&request.method==='PUT')return saveFanPrediction(request,env,match[1]);
      if(match[2]==='fan-scorecard'&&request.method==='PUT')return saveFanScorecard(request,env,match[1]);
      return new Response(JSON.stringify({error:'method_not_allowed'},null,2),{status:405,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
    }
    if(url.pathname==='/api/contributors/me'){
      if(request.method==='GET'){
        const who=await contributor(request,env.DB);
        return who?new Response(JSON.stringify(who),{headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}}):new Response(JSON.stringify({error:'Invalid or revoked publishing key.'}),{status:401,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
      }
      if(request.method==='PATCH')return updateContributorProfile(request,env.DB);
      return new Response(JSON.stringify({error:'method_not_allowed'}),{status:405,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
    }
    if(url.pathname==='/api/contributors/device'){
      if(request.method==='POST')return rememberContributor(request,env.DB);
      if(request.method==='DELETE')return forgetContributor();
      return new Response(JSON.stringify({error:'method_not_allowed'}),{status:405,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
    }
    if(request.method==='GET'&&url.pathname==='/api/forecasts')return forecastsWithFans(request,env);
    const authenticated=withContributorCookie(request);
    return base.fetch(withModelCacheKey(authenticated,env.MODEL_VERSION),env,context);
  }
} satisfies ExportedHandler<Env>;
