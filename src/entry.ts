import worker from './worker.ts';
import {canonicalRedirect} from './canonical.ts';
import {normalizeNavigation} from './navigation.ts';
import {globalFighterApi,globalFighterPage,globalFightersApi,promotionApi,promotionPage,promotionsApi,promotionsPage} from './global-scout.ts';

type Env={DB:D1Database;ASSETS:Fetcher;MODEL_VERSION:string;AI?:{run(model:string,input:unknown,options?:unknown):Promise<unknown>};SCOUT_BURST_LIMITER?:RateLimit;SCOUT_MINUTE_LIMITER?:RateLimit};

async function page(response:Response|Promise<Response>,request:Request,env:Env){return normalizeNavigation(await response,request,env);}

export default {
  async scheduled(controller:ScheduledController,env:Env,context:ExecutionContext){return worker.scheduled(controller,env,context);},
  async fetch(request:Request,env:Env,context:ExecutionContext):Promise<Response>{
    const redirected=canonicalRedirect(request);if(redirected)return redirected;
    const url=new URL(request.url),path=url.pathname;

    if(path==='/api/promotions')return promotionsApi(request,env);
    const promotionApiMatch=path.match(/^\/api\/promotions\/([a-z0-9-]{1,100})\/?$/);
    if(promotionApiMatch)return promotionApi(request,env,promotionApiMatch[1]);
    if(path==='/api/scout/fighters')return globalFightersApi(request,env);
    const fighterApiMatch=path.match(/^\/api\/scout\/fighters\/([a-z0-9-]{1,180})\/?$/);
    if(fighterApiMatch)return globalFighterApi(request,env,fighterApiMatch[1]);

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
