import base from './index.ts';
import {fanRecord,getFanSummary,saveFanPrediction,saveFanScorecard} from './fans.ts';

interface Env {
  DB:D1Database;
  ASSETS:Fetcher;
  MODEL_VERSION:string;
}

export default {
  async scheduled(controller:ScheduledController,env:Env,context:ExecutionContext){
    return base.scheduled(controller,env,context);
  },
  async fetch(request:Request,env:Env,context:ExecutionContext):Promise<Response>{
    const url=new URL(request.url);
    if(request.method==='GET'&&url.pathname==='/api/fans/record')return fanRecord(request,env);
    const match=url.pathname.match(/^\/api\/fights\/([1-9]\d*)\/(fans|fan-prediction|fan-scorecard)$/);
    if(match){
      if(match[2]==='fans'&&request.method==='GET')return getFanSummary(request,env,match[1]);
      if(match[2]==='fan-prediction'&&request.method==='PUT')return saveFanPrediction(request,env,match[1]);
      if(match[2]==='fan-scorecard'&&request.method==='PUT')return saveFanScorecard(request,env,match[1]);
      return new Response(JSON.stringify({error:'method_not_allowed'}),{status:405,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
    }
    return base.fetch(request,env,context);
  }
} satisfies ExportedHandler<Env>;
