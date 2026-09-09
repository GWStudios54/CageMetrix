import worker from './worker.ts';
import {canonicalRedirect} from './canonical.ts';
import {normalizeNavigation} from './navigation.ts';
import {globalFighterApi,globalFighterPage,globalFightersApi,promotionApi,promotionPage,promotionsApi,promotionsPage} from './global-scout.ts';
import {eventsApi,eventsPage} from './events.ts';
import {eventPage} from './event-page.ts';
import {enhancePromotionEvents} from './promotion-events.ts';
import {enhanceFighterTalentContext,fighterTalentApi,managementAgenciesApi,managementAgenciesPage,managementAgencyApi,managementAgencyPage,talentAdminApi,talentPage,talentSearchApi} from './talent-network.ts';
import {endManagementApi,setManagementApi} from './talent-admin.ts';
import {contractAdminApi,enhanceFighterContractContext,fighterContractApi} from './contract-intel.ts';
import {enhanceManagementAgencyAbout} from './management-about.ts';
import {enhanceFighterScoutScore,enhancePromotionScoutScores,prospectsPage,scoutScoresApi} from './scout-score.ts';
import {enhanceFighterIntel,fighterIntelApi} from './fighter-intel.ts';
import {dataPolicyPage,privacyPage,profileRemovalAdminApi,profileRemovalApi,profileRemovalPage} from './legal-safety.ts';

type Env={DB:D1Database;ASSETS:Fetcher;MODEL_VERSION:string;AI?:{run(model:string,input:unknown,options?:unknown):Promise<unknown>};SCOUT_BURST_LIMITER?:RateLimit;SCOUT_MINUTE_LIMITER?:RateLimit};

async function page(response:Response|Promise<Response>,request:Request,env:Env){return normalizeNavigation(await response,request,env);}
const retiredJson=()=>new Response(JSON.stringify({error:'feature_retired',message:'MMA Scouts is focused on scouting research.'}),{status:410,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const removedJson=()=>new Response(JSON.stringify({error:'fighter_not_found'}),{status:404,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-robots-tag':'noindex'}});
const removedPage=()=>new Response('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>Not found | MMA Scouts</title></head><body><main><h1>Fighter profile not found.</h1><p><a href="/scout">Return to MMA Scouts</a></p></main></body></html>',{status:404,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-robots-tag':'noindex'}});

function stripRetiredPersonalUi(response:Response){
  if(!response.headers.get('content-type')?.includes('text/html'))return response;
  return new HTMLRewriter()
    .on('.cm-follow-slot',{element(el){el.remove();}})
    .on('.home-watchlist',{element(el){el.remove();}})
    .transform(response);
}

async function legacyFightRedirect(path:string,request:Request,env:Env){
  const match=path.match(/^\/fights\/([1-9]\d*)\/?$/);if(!match)return null;
  const row=await env.DB.prepare(`SELECT e.slug FROM bouts b JOIN events e ON e.id=b.event_id WHERE b.id=? AND e.slug IS NOT NULL LIMIT 1`).bind(Number(match[1])).first<{slug:string}>();
  return Response.redirect(new URL(row?.slug?`/events/${row.slug}`:'/scout',request.url),308);
}

async function canonicalFighterRemoved(slug:string,env:Env){
  const row=await env.DB.prepare(`SELECT 1 removed
    FROM fighters f
    JOIN mma_identity_links l ON CAST(l.cagemetrix_fighter_id AS INTEGER)=f.id AND l.confidence>=0.90
    JOIN fighter_publication_controls c ON c.source_key=l.source_key AND c.source_fighter_id=l.source_fighter_id AND c.public_status='removed'
    WHERE f.slug=? LIMIT 1`).bind(slug).first<{removed:number}>();
  return !!row;
}

export default {
  async scheduled(controller:ScheduledController,env:Env,context:ExecutionContext){return worker.scheduled(controller,env,context);},
  async fetch(request:Request,env:Env,context:ExecutionContext):Promise<Response>{
    const redirected=canonicalRedirect(request);if(redirected)return redirected;
    const url=new URL(request.url),path=url.pathname;

    if(request.method==='GET'&&(path==='/predictions.html'||path==='/predictions'))return Response.redirect(new URL('/events',request.url),308);
    if(request.method==='GET'&&(path==='/validation.html'||path==='/validation'))return Response.redirect(new URL('/#rankings',request.url),308);
    if(request.method==='GET'&&(path==='/community'||path==='/community/'||path==='/forum'||path==='/forum/'||path==='/watchlist'||path==='/watchlist/'||/^\/forum\//.test(path)||/^\/u\//.test(path)))return Response.redirect(new URL('/scout',request.url),308);
    if(request.method==='GET'&&/^\/fights\/[1-9]\d*\/?$/.test(path))return (await legacyFightRedirect(path,request,env))!;

    if(path==='/api/forecasts'||path.startsWith('/api/community')||path.startsWith('/api/forum')||path.startsWith('/api/fans')||/^\/api\/fights\/[1-9]\d*\/(fans|fan-prediction|fan-scorecard)$/.test(path))return retiredJson();

    if(path==='/api/profile-removal')return profileRemovalApi(request,env);
    if(path==='/api/admin/privacy/removals'||path==='/api/admin/privacy/removals/')return profileRemovalAdminApi(request,env);
    if(path==='/api/events')return eventsApi(request,env);
    if(path==='/api/promotions')return promotionsApi(request,env);
    const promotionApiMatch=path.match(/^\/api\/promotions\/([a-z0-9-]{1,100})\/?$/);
    if(promotionApiMatch)return promotionApi(request,env,promotionApiMatch[1]);
    if(path==='/api/scout/fighters')return globalFightersApi(request,env);
    const fighterIntelMatch=path.match(/^\/api\/scout\/fighters\/([a-z0-9-]{1,180})\/intel\/?$/);
    if(fighterIntelMatch)return fighterIntelApi(request,env,fighterIntelMatch[1]);
    const fighterContractMatch=path.match(/^\/api\/scout\/fighters\/([a-z0-9-]{1,180})\/contracts\/?$/);
    if(fighterContractMatch)return fighterContractApi(request,env,fighterContractMatch[1]);
    const fighterApiMatch=path.match(/^\/api\/scout\/fighters\/([a-z0-9-]{1,180})\/?$/);
    if(fighterApiMatch)return globalFighterApi(request,env,fighterApiMatch[1]);
    if(path==='/api/prospects')return scoutScoresApi(request,env);
    if(path==='/api/talent')return talentSearchApi(request,env);
    if(path==='/api/management')return managementAgenciesApi(request,env);
    const managementApiMatch=path.match(/^\/api\/management\/([a-z0-9-]{1,120})\/?$/);
    if(managementApiMatch)return managementAgencyApi(request,env,managementApiMatch[1]);
    const fighterTalentMatch=path.match(/^\/api\/talent\/fighters\/([a-z0-9-]{1,180})\/?$/);
    if(fighterTalentMatch)return fighterTalentApi(request,env,fighterTalentMatch[1]);
    if(path==='/api/admin/talent/management'||path==='/api/admin/talent/management/')return setManagementApi(request,env);
    if(path==='/api/admin/talent/management/end'||path==='/api/admin/talent/management/end/')return endManagementApi(request,env);
    if(path==='/api/admin/talent/contracts'||path==='/api/admin/talent/contracts/')return contractAdminApi(request,env);
    const talentAdminMatch=path.match(/^\/api\/admin\/talent\/(agency|opportunity)\/?$/);
    if(talentAdminMatch)return talentAdminApi(request,env,talentAdminMatch[1]);

    if(request.method==='GET'&&(path==='/data-policy'||path==='/data-policy/')){
      if(path.endsWith('/'))return Response.redirect(new URL('/data-policy',request.url),308);
      return page(dataPolicyPage(),request,env);
    }
    if(request.method==='GET'&&(path==='/privacy'||path==='/privacy/')){
      if(path.endsWith('/'))return Response.redirect(new URL('/privacy',request.url),308);
      return page(privacyPage(),request,env);
    }
    if(request.method==='GET'&&(path==='/profile-removal'||path==='/profile-removal/')){
      if(path.endsWith('/'))return Response.redirect(new URL(`/profile-removal${url.search}`,request.url),308);
      return page(profileRemovalPage(request),request,env);
    }
    if(request.method==='GET'&&(path==='/events'||path==='/events/')){
      if(path.endsWith('/'))return Response.redirect(new URL('/events',request.url),308);
      return page(eventsPage(request,env),request,env);
    }
    const eventPageMatch=path.match(/^\/events\/([a-z0-9-]{1,180})\/?$/);
    if(request.method==='GET'&&eventPageMatch){
      if(path.endsWith('/'))return Response.redirect(new URL(`/events/${eventPageMatch[1]}`,request.url),308);
      return page(eventPage(request,env,eventPageMatch[1]),request,env);
    }
    if(request.method==='GET'&&(path==='/promotions'||path==='/promotions/')){
      if(path.endsWith('/'))return Response.redirect(new URL('/promotions',request.url),308);
      return page(promotionsPage(request,env),request,env);
    }
    const promotionPageMatch=path.match(/^\/promotions\/([a-z0-9-]{1,100})\/?$/);
    if(request.method==='GET'&&promotionPageMatch){
      if(path.endsWith('/'))return Response.redirect(new URL(`/promotions/${promotionPageMatch[1]}`,request.url),308);
      const promotionResponse=await promotionPage(request,env,promotionPageMatch[1]);
      const withEvents=await enhancePromotionEvents(promotionResponse,env,promotionPageMatch[1]);
      return page(enhancePromotionScoutScores(withEvents,env,promotionPageMatch[1]),request,env);
    }
    if(request.method==='GET'&&(path==='/prospects'||path==='/prospects/')){
      if(path.endsWith('/'))return Response.redirect(new URL(`/prospects${url.search}`,request.url),308);
      return page(prospectsPage(request,env),request,env);
    }
    if(request.method==='GET'&&(path==='/talent'||path==='/talent/')){
      if(path.endsWith('/'))return Response.redirect(new URL('/talent',request.url),308);
      return page(talentPage(request,env),request,env);
    }
    if(request.method==='GET'&&(path==='/management'||path==='/management/')){
      if(path.endsWith('/'))return Response.redirect(new URL('/management',request.url),308);
      return page(managementAgenciesPage(request,env),request,env);
    }
    const managementPageMatch=path.match(/^\/management\/([a-z0-9-]{1,120})\/?$/);
    if(request.method==='GET'&&managementPageMatch){
      if(path.endsWith('/'))return Response.redirect(new URL(`/management/${managementPageMatch[1]}`,request.url),308);
      const agencyResponse=await managementAgencyPage(request,env,managementPageMatch[1]);
      return page(enhanceManagementAgencyAbout(agencyResponse,env,managementPageMatch[1]),request,env);
    }
    const fighterPageMatch=path.match(/^\/scout\/fighters\/([a-z0-9-]{1,180})\/?$/);
    if(request.method==='GET'&&fighterPageMatch){
      if(path.endsWith('/'))return Response.redirect(new URL(`/scout/fighters/${fighterPageMatch[1]}`,request.url),308);
      let dossier=await globalFighterPage(request,env,fighterPageMatch[1]);
      dossier=await enhanceFighterTalentContext(dossier,env,fighterPageMatch[1]);
      dossier=await enhanceFighterContractContext(dossier,env,fighterPageMatch[1]);
      dossier=await enhanceFighterScoutScore(dossier,env,fighterPageMatch[1]);
      dossier=await enhanceFighterIntel(dossier,env,fighterPageMatch[1]);
      return page(dossier,request,env);
    }

    const legacyApiFighter=path.match(/^\/api\/fighters\/([a-z0-9-]{1,180})\/?$/);
    if(request.method==='GET'&&legacyApiFighter&&await canonicalFighterRemoved(legacyApiFighter[1],env))return removedJson();
    const legacyPageFighter=path.match(/^\/fighters\/([a-z0-9-]{1,180})\/?$/);
    if(request.method==='GET'&&legacyPageFighter&&await canonicalFighterRemoved(legacyPageFighter[1],env))return removedPage();

    return stripRetiredPersonalUi(await worker.fetch(request,env,context));
  }
};