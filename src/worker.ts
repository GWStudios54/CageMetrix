import base from './index.ts';
import {fanRecord,getFanSummary,saveFanPrediction,saveFanScorecard} from './fans.ts';
import {contributor,forgetContributor,rememberContributor,updateContributorProfile} from './contributors.ts';
import {getContributorNotes,saveContributorNote} from './contributor-notes.ts';
import {predictorForecasts} from './forecasts.ts';
import {augmentFighterProfileWithPreUfcHistory} from './fighter-history.ts';
import {enhanceFightPage,enhanceFighterPage} from './seo.ts';
import {publicSitemap} from './public-sitemap.ts';
import {eventPage} from './event-page.ts';
import {homePage,predictionsPage} from './static-seo.ts';
import {adminModeratePost,adminResolveReports} from './admin.ts';
import {adminDashboardPage,adminModerateForumPost,adminOverviewV2,adminResolveForumReports} from './admin-v2.ts';
import {ownerAdminLogin} from './admin-auth.ts';
import {separateDiscussion} from './discussion-links.ts';
import {createForumPost,createForumThread,forumHomePage,forumScopedThreadPage,forumThread,forumThreadPage,reactForumPost,reportForumPost} from './forum.ts';
import {normalizeForumSeo} from './forum-seo.ts';
import {enhanceFighterFollow,enhanceHomeWatchlist,fighterFollowStatus,getWatchlist,setFighterFollow,watchlistPage} from './watchlist.ts';
import {normalizeNavigation} from './navigation.ts';
import {
  blockCommunityUser,communityEvent,communityHomePage,communityLeaderboard,communityProfilePage,
  createDiscussionPost,discussion,enhanceEventCommunity,enhanceFightCommunity,getCommunityMe,
  loginCommunity,logoutCommunity,reactCommunityPost,registerCommunity,reportCommunityPost,
  saveCommunityPick,updateCommunityMe
} from './community.ts';

interface Env {DB:D1Database;ASSETS:Fetcher;MODEL_VERSION:string;}

const TOKEN_RE=/^cm_[A-Za-z0-9_-]{43}$/;
function contributorCookie(request:Request){const raw=request.headers.get('cookie')||'';const token=raw.split(';').map(v=>v.trim()).find(v=>v.startsWith('cm_contributor_key='))?.slice('cm_contributor_key='.length)||null;return token&&TOKEN_RE.test(token)?token:null;}
function withContributorCookie(request:Request){if(request.headers.get('authorization')?.match(/^Bearer cm_[A-Za-z0-9_-]{43}$/))return request;const token=contributorCookie(request);if(!token)return request;const headers=new Headers(request.headers);headers.set('authorization',`Bearer ${token}`);return new Request(request,{headers});}
function withModelCacheKey(request:Request,modelVersion:string){if(request.method!=='GET'||!new URL(request.url).pathname.startsWith('/api/'))return request;const url=new URL(request.url);url.searchParams.set('_model_version',modelVersion);return new Request(url,request);}
async function page(response:Response|Promise<Response>,request:Request,env:Env){return normalizeNavigation(await response,request,env);}
async function forecastsWithFans(request:Request,env:Env){
  const response=await predictorForecasts(env);if(!response.ok)return response;const payload:any=await response.json();
  const rows=await env.DB.prepare(`SELECT fp.bout_id,COUNT(*) total,SUM(CASE WHEN fp.picked_fighter_id=b.fighter_a_id THEN 1 ELSE 0 END) a_votes,SUM(CASE WHEN fp.picked_fighter_id=b.fighter_b_id THEN 1 ELSE 0 END) b_votes FROM fan_predictions fp JOIN bouts b ON b.id=fp.bout_id GROUP BY fp.bout_id`).all<Record<string,any>>();
  const fans=new Map((rows.results||[]).map(row=>[Number(row.bout_id),row]));payload.data=(payload.data||[]).map((row:any)=>{const f:any=fans.get(Number(row.bout_id));const total=Number(f?.total||0),a=Number(f?.a_votes||0),b=Number(f?.b_votes||0);return {...row,fan_total:total,fan_a_pct:total?a/total:null,fan_b_pct:total?b/total:null,fan_consensus_pick:a===b?null:a>b?'a':'b'};});
  const headers=new Headers(response.headers);headers.set('content-type','application/json; charset=utf-8');headers.set('cache-control','public, max-age=15');return new Response(JSON.stringify(payload),{status:response.status,headers});
}

export default {
  async scheduled(controller:ScheduledController,env:Env,context:ExecutionContext){return base.scheduled(controller,env,context);},
  async fetch(request:Request,env:Env,context:ExecutionContext):Promise<Response>{
    const url=new URL(request.url);
    if(request.method==='GET'&&url.pathname==='/'){let response=await homePage(request,env);response=await enhanceHomeWatchlist(response,request,env);return page(response,request,env);}
    if(request.method==='GET'&&url.pathname==='/predictions.html')return page(predictionsPage(request,env),request,env);
    if(request.method==='GET'&&url.pathname==='/sitemap.xml')return publicSitemap(env);
    if(request.method==='GET'&&(url.pathname==='/admin'||url.pathname==='/admin/')){if(url.pathname.endsWith('/'))return Response.redirect(new URL('/admin',request.url),308);return page(adminDashboardPage(request,env),request,env);}
    if(request.method==='GET'&&(url.pathname==='/watchlist'||url.pathname==='/watchlist/')){if(url.pathname.endsWith('/'))return Response.redirect(new URL('/watchlist',request.url),308);return page(watchlistPage(request,env),request,env);}
    if(request.method==='GET'&&(url.pathname==='/community'||url.pathname==='/community/')){if(url.pathname.endsWith('/'))return Response.redirect(new URL('/community',request.url),308);return page(communityHomePage(request,env),request,env);}
    if(request.method==='GET'&&(url.pathname==='/forum'||url.pathname==='/forum/')){if(url.pathname.endsWith('/'))return Response.redirect(new URL('/forum',request.url),308);return page(normalizeForumSeo(await forumHomePage(request,env),'/forum',true),request,env);}
    const forumEventMatch=url.pathname.match(/^\/forum\/event\/([a-z0-9-]{1,180})\/?$/);if(request.method==='GET'&&forumEventMatch){if(url.pathname.endsWith('/'))return Response.redirect(new URL(`/forum/event/${forumEventMatch[1]}`,request.url),308);return page(normalizeForumSeo(await forumScopedThreadPage(request,env,'event',forumEventMatch[1]),`/forum/event/${forumEventMatch[1]}`,false),request,env);}
    const forumFightMatch=url.pathname.match(/^\/forum\/fight\/([1-9]\d*)\/?$/);if(request.method==='GET'&&forumFightMatch){if(url.pathname.endsWith('/'))return Response.redirect(new URL(`/forum/fight/${forumFightMatch[1]}`,request.url),308);return page(normalizeForumSeo(await forumScopedThreadPage(request,env,'fight',forumFightMatch[1]),`/forum/fight/${forumFightMatch[1]}`,false),request,env);}
    const forumThreadMatch=url.pathname.match(/^\/forum\/thread\/([1-9]\d*)\/?$/);if(request.method==='GET'&&forumThreadMatch){if(url.pathname.endsWith('/'))return Response.redirect(new URL(`/forum/thread/${forumThreadMatch[1]}`,request.url),308);return page(normalizeForumSeo(await forumThreadPage(request,env,forumThreadMatch[1]),`/forum/thread/${forumThreadMatch[1]}`,false),request,env);}
    if(request.method==='GET'&&(url.pathname==='/u/cagemetrix_owner54'||url.pathname==='/u/cagemetrix_owner54/'))return Response.redirect(new URL('/u/cagemetrix_desk',request.url),308);
    const profileMatch=url.pathname.match(/^\/u\/([A-Za-z0-9_]{3,24})\/?$/);if(request.method==='GET'&&profileMatch){if(url.pathname.endsWith('/'))return Response.redirect(new URL(`/u/${profileMatch[1]}${url.search}`,request.url),308);return page(communityProfilePage(request,env,profileMatch[1]),request,env);}
    const eventMatch=url.pathname.match(/^\/events\/([a-z0-9-]{1,180})\/?$/);if(request.method==='GET'&&eventMatch){if(url.pathname.endsWith('/'))return Response.redirect(new URL(`/events/${eventMatch[1]}${url.search}`,request.url),308);let response=await eventPage(request,env,eventMatch[1]);response=await enhanceEventCommunity(response,env,eventMatch[1]);response=separateDiscussion(response,'event',eventMatch[1]);return page(response,request,env);}

    if(url.pathname==='/api/admin'&&request.method==='GET')return adminOverviewV2(request,env);
    const adminPostMatch=url.pathname.match(/^\/api\/admin\/posts\/([1-9]\d*)$/);if(adminPostMatch&&request.method==='PUT')return adminModeratePost(request,env,adminPostMatch[1]);
    const adminReportMatch=url.pathname.match(/^\/api\/admin\/reports\/([1-9]\d*)$/);if(adminReportMatch&&request.method==='PUT')return adminResolveReports(request,env,adminReportMatch[1]);
    const adminForumPostMatch=url.pathname.match(/^\/api\/admin\/forum\/posts\/([1-9]\d*)$/);if(adminForumPostMatch&&request.method==='PUT')return adminModerateForumPost(request,env,adminForumPostMatch[1]);
    const adminForumReportMatch=url.pathname.match(/^\/api\/admin\/forum\/reports\/([1-9]\d*)$/);if(adminForumReportMatch&&request.method==='PUT')return adminResolveForumReports(request,env,adminForumReportMatch[1]);

    if(url.pathname==='/api/forum/threads'&&request.method==='POST')return createForumThread(request,env);
    const forumApiThread=url.pathname.match(/^\/api\/forum\/threads\/([1-9]\d*)(?:\/posts)?$/);if(forumApiThread){if(request.method==='GET'&&!url.pathname.endsWith('/posts'))return forumThread(request,env,forumApiThread[1]);if(request.method==='POST'&&url.pathname.endsWith('/posts'))return createForumPost(request,env,forumApiThread[1]);return new Response(JSON.stringify({error:'method_not_allowed'}),{status:405,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
    const forumPostAction=url.pathname.match(/^\/api\/forum\/posts\/([1-9]\d*)\/(react|report)$/);if(forumPostAction){if(forumPostAction[2]==='react'&&request.method==='PUT')return reactForumPost(request,env,forumPostAction[1]);if(forumPostAction[2]==='report'&&request.method==='POST')return reportForumPost(request,env,forumPostAction[1]);return new Response(JSON.stringify({error:'method_not_allowed'}),{status:405,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}

    if(url.pathname==='/api/community/register'&&request.method==='POST')return registerCommunity(request,env);
    if(url.pathname==='/api/community/login'&&request.method==='POST'){let handle='';try{handle=String((await request.clone().json() as any)?.handle||'').trim().toLowerCase()}catch{}if(handle==='cagemetrix_desk')return ownerAdminLogin(request,env);return loginCommunity(request,env);}
    if(url.pathname==='/api/community/logout'&&request.method==='POST')return logoutCommunity(request,env);
    if(url.pathname==='/api/community/me'){if(request.method==='GET')return getCommunityMe(request,env);if(request.method==='PATCH')return updateCommunityMe(request,env);return new Response(JSON.stringify({error:'method_not_allowed'}),{status:405,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
    if(url.pathname==='/api/community/watchlist'&&request.method==='GET')return getWatchlist(request,env);
    const followMatch=url.pathname.match(/^\/api\/community\/fighters\/([a-z0-9-]{1,180})\/follow$/);if(followMatch){if(request.method==='GET')return fighterFollowStatus(request,env,followMatch[1]);if(request.method==='PUT')return setFighterFollow(request,env,followMatch[1]);return new Response(JSON.stringify({error:'method_not_allowed'}),{status:405,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
    if(url.pathname==='/api/community/leaderboard'&&request.method==='GET')return communityLeaderboard(request,env);
    const communityEventMatch=url.pathname.match(/^\/api\/community\/events\/([a-z0-9-]{1,180})(?:\/picks\/([1-9]\d*))?$/);if(communityEventMatch){if(!communityEventMatch[2]&&request.method==='GET')return communityEvent(request,env,communityEventMatch[1]);if(communityEventMatch[2]&&request.method==='PUT')return saveCommunityPick(request,env,communityEventMatch[1],communityEventMatch[2]);return new Response(JSON.stringify({error:'method_not_allowed'}),{status:405,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
    if(url.pathname==='/api/community/discussion'){if(request.method==='GET')return discussion(request,env);if(request.method==='POST')return createDiscussionPost(request,env);return new Response(JSON.stringify({error:'method_not_allowed'}),{status:405,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
    const reactMatch=url.pathname.match(/^\/api\/community\/posts\/([1-9]\d*)\/(react|report)$/);if(reactMatch){if(reactMatch[2]==='react'&&request.method==='PUT')return reactCommunityPost(request,env,reactMatch[1]);if(reactMatch[2]==='report'&&request.method==='POST')return reportCommunityPost(request,env,reactMatch[1]);return new Response(JSON.stringify({error:'method_not_allowed'}),{status:405,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
    const blockMatch=url.pathname.match(/^\/api\/community\/users\/([A-Za-z0-9_]{3,24})\/block$/);if(blockMatch&&request.method==='PUT')return blockCommunityUser(request,env,blockMatch[1]);

    if(request.method==='GET'&&url.pathname==='/api/fans/record')return fanRecord(request,env);
    const notes=url.pathname.match(/^\/api\/fights\/([1-9]\d*)\/notes$/);if(notes){if(request.method==='GET')return getContributorNotes(request,env,notes[1]);if(request.method==='PUT')return saveContributorNote(request,env,notes[1]);return new Response(JSON.stringify({error:'method_not_allowed'}),{status:405,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
    const match=url.pathname.match(/^\/api\/fights\/([1-9]\d*)\/(fans|fan-prediction|fan-scorecard)$/);if(match){if(match[2]==='fans'&&request.method==='GET')return getFanSummary(request,env,match[1]);if(match[2]==='fan-prediction'&&request.method==='PUT')return saveFanPrediction(request,env,match[1]);if(match[2]==='fan-scorecard'&&request.method==='PUT')return saveFanScorecard(request,env,match[1]);return new Response(JSON.stringify({error:'method_not_allowed'},null,2),{status:405,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
    if(url.pathname==='/api/contributors/me'){if(request.method==='GET'){const who=await contributor(request,env.DB);return who?new Response(JSON.stringify(who),{headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}}):new Response(JSON.stringify({error:'Invalid or revoked publishing key.'}),{status:401,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}if(request.method==='PATCH')return updateContributorProfile(request,env.DB);return new Response(JSON.stringify({error:'method_not_allowed'},null,2),{status:405,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
    if(url.pathname==='/api/contributors/device'){if(request.method==='POST')return rememberContributor(request,env.DB);if(request.method==='DELETE')return forgetContributor();return new Response(JSON.stringify({error:'method_not_allowed'},null,2),{status:405,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
    if(request.method==='GET'&&url.pathname==='/api/forecasts')return forecastsWithFans(request,env);
    const authenticated=withContributorCookie(request),routed=withModelCacheKey(authenticated,env.MODEL_VERSION);
    if(request.method==='GET'&&/^\/api\/fighters\/[^/]+$/.test(url.pathname)){const response=await base.fetch(routed,env,context);return augmentFighterProfileWithPreUfcHistory(response,env);}
    const fighterPath=url.pathname.match(/^\/fighters\/([^/]+)\/?$/);if(request.method==='GET'&&fighterPath){const slug=decodeURIComponent(fighterPath[1]);let response=await base.fetch(routed,env,context);response=await enhanceFighterPage(response,env,slug);response=await enhanceFighterFollow(response,env,slug);return page(response,request,env);}
    const fightPath=url.pathname.match(/^\/fights\/([1-9]\d*)\/?$/);if(request.method==='GET'&&fightPath){let response=await base.fetch(routed,env,context);response=await enhanceFightPage(response,env,fightPath[1]);response=await enhanceFightCommunity(response,env,fightPath[1]);response=separateDiscussion(response,'fight',fightPath[1]);return page(response,request,env);}
    return page(base.fetch(routed,env,context),request,env);
  }
} satisfies ExportedHandler<Env>;