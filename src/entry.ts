import worker from './worker.ts';
import {canonicalRedirect} from './canonical.ts';
import {normalizeNavigation} from './navigation.ts';
import {globalFighterApi,globalFighterPage,globalFightersApi,promotionApi,promotionPage,promotionsApi,promotionsPage} from './global-scout.ts';
import {eventsApi,eventsPage} from './events.ts';

type Env={DB:D1Database;ASSETS:Fetcher;MODEL_VERSION:string;AI?:{run(model:string,input:unknown,options?:unknown):Promise<unknown>};SCOUT_BURST_LIMITER?:RateLimit;SCOUT_MINUTE_LIMITER?:RateLimit};

async function page(response:Response|Promise<Response>,request:Request,env:Env){return normalizeNavigation(await response,request,env);}
const retiredJson=()=>new Response(JSON.stringify({error:'feature_retired',message:'MMA Scouts is focused on scouting research.'}),{status:410,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});

async function legacyFightRedirect(path:string,request:Request,env:Env){
  const match=path.match(/^\/fights\/([1-9]\d*)\/?$/);if(!match)return null;
  const row=await env.DB.prepare(`SELECT e.slug FROM bouts b JOIN events e ON e.id=b.event_id WHERE b.id=? AND e.slug IS NOT NULL LIMIT 1`).bind(Number(match[1])).first<{slug:string}>();
  return Response.redirect(new URL(row?.slug?`/events/${row.slug}`:'/scout',request.url),308);
}

export default {
  async scheduled(controller:ScheduledController,env:Env,context:ExecutionContext){return worker.scheduled(controller,env,context);},
  async fetch(request:Request,env:Env,context:ExecutionContext):Promise<Response>{
    const redirected=canonicalRedirect(request);if(redirected)return redirected;
    const url=new URL(request.url),path=url.pathname;

    if(request.method==='GET'&&(path==='/predictions.html'||path==='/predictions'))return Response.redirect(new URL('/events',request.url),308);
    if(request.method==='GET'&&(path==='/validation.html'||path==='/validation'))return Response.redirect(new URL('/#rankings',request.url),308);
    if(request.method==='GET'&&(path==='/community'||path==='/community/'||path==='/forum'||path==='/forum/'||/^\/forum\//.test(path)||/^\/u\//.test(path)))return Response.redirect(new URL('/scout',request.url),308);
    if(request.method==='GET'&&/^\/fights\/[1-9]\d*\/?$/.test(path))return (await legacyFightRedirect(path,request,env))!;

    if(path==='/api/forecasts'||path.startsWith('/api/community')||path.startsWith('/api/forum')||path.startsWith('/api/fans')||/^\/api\/fights\/[1-9]\d*\/(fans|fan-prediction|fan-scorecard)$/.test(path))return retiredJson();

    if(path==='/api/events')return eventsApi(request,env);
    if(path==='/api/promotions')return promotionsApi(request,env);
    const promotionApiMatch=path.match(/^\/api\/promotions\/([a-z0-9-]{1,100})\/?$/);
    if(promotionApiMatch)return promotionApi(request,env,promotionApiMatch[1]);
    if(path==='/api/scout/fighters')return globalFightersApi(request,env);
    const fighterApiMatch=path.match(/^\/api\/scout\/fighters\/([a-z0-9-]{1,180})\/?$/);
    if(fighterApiMatch)return globalFighterApi(request,env,fighterApiMatch[1]);

    if(request.method==='GET'&&(path==='/events'||path==='/events/')){
      if(path.endsWith('/'))return Response.redirect(new URL('/events',request.url),308);
      return page(eventsPage(request,env),request,env);
    }
    if(request.method==='GET'&&(path==='/promotions'||path==='/promotions/')){
      if(path.endsWith('/'))return Response.redirect(new URL('/promotions',request.url),308);
      return page(promotionsPage(request,env),request,env);
    }
    const promotionPageMatch=path.match(/^\/promotions\/([a-z0-9-]{1,100})\/?$/);
    if(request.method==='GET'&&promotionPageMatch){
      if(path.endsWith('/'))return Response.redirect(new URL(`/promotions/${promotionPageMatch[1]}`,request.url),308);
      return page(promotionPage(request,env,promotionPageMatch[1]),request,env);
    }
    const fighterPageMatch=path.match(/^\/scout\/fighters\/([a-z0-9-]{1,180})\/?$/);
    if(request.method==='GET'&&fighterPageMatch){
      if(path.endsWith('/'))return Response.redirect(new URL(`/scout/fighters/${fighterPageMatch[1]}`,request.url),308);
      return page(globalFighterPage(request,env,fighterPageMatch[1]),request,env);
    }

    return worker.fetch(request,env,context);
  }
};
