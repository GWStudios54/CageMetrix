import {BRAND_NAME,SITE_ORIGIN} from './brand.ts';

type Env={DB:D1Database;ASSETS:Fetcher;MODEL_VERSION:string};
type Row=Record<string,any>;
const JSON_HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'public, max-age=60, s-maxage=300','x-content-type-options':'nosniff'};
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]!));
const score=(value:unknown)=>value===null||value===undefined||value===''?'—':Number.isFinite(Number(value))?Number(value).toFixed(1):'—';
const percent=(value:unknown)=>value===null||value===undefined||value===''?'—':Number.isFinite(Number(value))?`${Math.round(Number(value))}%`:'—';
const limit=(value:string|null,fallback=50,max=100)=>Math.min(max,Math.max(1,Number.parseInt(value||'',10)||fallback));
const offset=(value:string|null)=>Math.max(0,Number.parseInt(value||'',10)||0);
const number=(value:string|null,min:number,max:number)=>{const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):null;};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:JSON_HEADERS});

function shell(title:string,description:string,path:string,body:string){const url=`${SITE_ORIGIN}${path}`;return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta name="description" content="${esc(description)}"><link rel="canonical" href="${esc(url)}"><meta name="robots" content="index,follow,max-image-preview:large"><meta property="og:type" content="website"><meta property="og:site_name" content="${BRAND_NAME}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${SITE_ORIGIN}/og.png"><meta name="twitter:card" content="summary_large_image"><link rel="icon" href="/logo.svg" type="image/svg+xml"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/scout-score.css?v=1"></head><body><header class="topbar"><a class="brand" href="/"><img class="brand-mark" src="/logo.svg" alt="" width="44" height="44"><span>${BRAND_NAME}</span></a></header><main class="score-main">${body}</main><footer><span>${BRAND_NAME}</span><span>The MMA research engine.</span></footer></body></html>`;}

function where(url:URL){
  const clauses=['1=1'];const binds:any[]=[];
  const division=(url.searchParams.get('weight_class')||'').trim().slice(0,80);
  const promotion=(url.searchParams.get('promotion')||'').trim().slice(0,100);
  const ageMax=number(url.searchParams.get('age_max'),16,60);
  const minScore=number(url.searchParams.get('min_score'),0,100);
  const outsideUfc=url.searchParams.get('outside_ufc')==='1';
  if(division){clauses.push('s.current_weight_class=?');binds.push(division);}
  if(promotion){clauses.push('s.current_promotion_slug=?');binds.push(promotion);}
  if(ageMax!==null){clauses.push('s.age IS NOT NULL AND s.age<=?');binds.push(ageMax);}
  if(minScore!==null){clauses.push('s.scout_score>=?');binds.push(minScore);}
  if(outsideUfc)clauses.push(`lower(COALESCE(s.current_organization,'')) NOT LIKE '%ufc%'`);
  return {clauses,binds,filters:{weight_class:division||null,promotion:promotion||null,age_max:ageMax,min_score:minScore,outside_ufc:outsideUfc}};
}

async function rows(request:Request,env:Env){
  const url=new URL(request.url),take=limit(url.searchParams.get('limit')),skip=offset(url.searchParams.get('offset'));
  const {clauses,binds,filters}=where(url);binds.push(take,skip);
  const result=await env.DB.prepare(`
    SELECT s.*,sp.name promotion_name,sp.region promotion_region,p.nationality,p.gym,p.career_no_contests
    FROM scout_active_prospect_scores s
    JOIN scout_active_global_profiles p
      ON p.source_key=s.source_key AND p.snapshot_id=s.snapshot_id AND p.source_fighter_id=s.source_fighter_id
    LEFT JOIN scout_promotions sp ON sp.slug=s.current_promotion_slug
    WHERE ${clauses.join(' AND ')}
    ORDER BY s.scout_score DESC,s.raw_scout_signal DESC,s.global_rating DESC,s.fighter_name
    LIMIT ? OFFSET ?
  `).bind(...binds).all<Row>();
  return {data:result.results||[],filters,take,skip};
}

export async function scoutScoresApi(request:Request,env:Env){if(request.method!=='GET')return json({error:'method_not_allowed'},405);const result=await rows(request,env);return json({data:result.data,meta:{...result.filters,limit:result.take,offset:result.skip,definition:'Population-relative scouting interest among fighters with at least three bouts and activity in the last three years. Evidence is reported separately and is not a Scout Score component.'}});}

export async function prospectsPage(request:Request,env:Env){
  const url=new URL(request.url);url.searchParams.set('limit','100');
  const {data}=await rows(new Request(url,{method:'GET'}),env);
  const promos=(await env.DB.prepare(`SELECT slug,name FROM scout_promotions WHERE active=1 ORDER BY name`).all<Row>()).results||[];
  const get=(key:string)=>new URL(request.url).searchParams.get(key)||'';
  const selected=(key:string,value:string)=>get(key)===value?' selected':'';
  const cards=data.map(row=>`<a class="score-card" href="/scout/fighters/${esc(row.profile_slug)}"><div class="score-card-top"><div><span class="eyebrow">${esc(row.current_weight_class||'Unknown division')}${row.promotion_name?` · ${esc(row.promotion_name)}`:''}</span><h2>${esc(row.fighter_name)}</h2><p>${row.age!==null?`Age ${Number(row.age)} · `:''}${Number(row.career_wins||0)}-${Number(row.career_losses||0)}${Number(row.career_draws||0)?`-${Number(row.career_draws)}`:''}${row.gym?` · ${esc(row.gym)}`:''}</p></div><div class="score-hero-number"><small>SCOUT SCORE</small><strong>${score(row.scout_score)}</strong><span>#${Number(row.scout_rank)} current pool</span></div></div><div class="score-meta"><span><small>Global Rating</small><b>${score(row.global_rating)}</b></span><span><small>Age-adjusted</small><b>${score(row.age_adjusted_performance)}</b></span><span><small>Trajectory</small><b>${score(row.trajectory)}</b></span><span><small>Vs expectation</small><b>${score(row.expectation_performance)}</b></span><span><small>Activity</small><b>${score(row.activity)}</b></span><span><small>Evidence</small><b>${percent(row.evidence_strength)}</b></span></div></a>`).join('');
  const body=`<section class="score-hero"><span class="eyebrow">SCOUT BOARD</span><h1>Who is worth tracking right now?</h1><p>Scout Score is a population-relative discovery score. It rewards strong performance at the right stage of a career, upward trajectory, results above opponent expectation and recent activity. Evidence stays separate so uncertainty is visible instead of secretly becoming talent.</p><div class="score-note"><strong>Global Rating ≠ Scout Score.</strong> Global Rating estimates current opponent-adjusted strength. Scout Score estimates scouting interest.</div></section><section class="score-filter"><form method="get" action="/prospects"><label>Division<input name="weight_class" value="${esc(get('weight_class'))}" placeholder="Lightweight"></label><label>Promotion<select name="promotion"><option value="">Any promotion</option>${promos.map(p=>`<option value="${esc(p.slug)}"${selected('promotion',p.slug)}>${esc(p.name)}</option>`).join('')}</select></label><label>Max age<input type="number" name="age_max" min="16" max="60" value="${esc(get('age_max'))}" placeholder="25"></label><label>Min Scout Score<input type="number" name="min_score" min="0" max="100" value="${esc(get('min_score'))}" placeholder="75"></label><label class="score-check"><input type="checkbox" name="outside_ufc" value="1"${get('outside_ufc')==='1'?' checked':''}> Outside UFC</label><button class="button primary" type="submit">Search</button></form></section><section class="score-results"><div class="score-results-head"><span class="eyebrow">CURRENT POOL</span><h2>${data.length} fighters</h2></div>${cards||'<div class="score-empty">No fighters match these filters.</div>'}</section><section class="score-method"><span class="eyebrow">SCOUT SCORE 1.0</span><h2>Transparent by design.</h2><p>The underlying signal is 35% global performance, 25% age-adjusted performance, 20% trajectory, 10% performance versus expectation and 10% activity. The final 0–100 number is the fighter's percentile within the current eligible pool. Management, promotion prestige and evidence confidence add zero points.</p></section>`;
  return new Response(shell('MMA Prospect Rankings & Scout Scores | MMA Scouts','Discover rising MMA talent with Scout Score, Global Rating, age-adjusted performance, trajectory, activity and evidence.','/prospects',body),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'public, max-age=60, s-maxage=300'}});
}

async function fighterScore(env:Env,slug:string){return env.DB.prepare(`SELECT * FROM scout_active_prospect_scores WHERE profile_slug=? LIMIT 1`).bind(slug).first<Row>();}

export async function enhanceFighterScoutScore(response:Response,env:Env,slug:string){
  if(!response.ok||!response.headers.get('content-type')?.includes('text/html'))return response;
  const row=await fighterScore(env,slug);
  const rewriter=new HTMLRewriter().on('.dossier-rating-hero small',{element(el){el.setInnerContent('GLOBAL RATING');}});
  if(!row)return rewriter.transform(response);
  const panel=`<section class="scout-score-dossier"><div class="scout-score-number"><small>SCOUT SCORE</small><strong>${score(row.scout_score)}</strong><span>#${Number(row.scout_rank)} current pool${row.division_scout_rank?` · #${Number(row.division_scout_rank)} ${esc(row.current_weight_class||'division')}`:''}</span></div><div class="scout-score-copy"><h2>Scouting interest, not current strength.</h2><p>Global Rating measures opponent-adjusted ability. Scout Score asks how interesting this fighter is to scout right now. Evidence ${percent(row.evidence_strength)} is shown separately and does not add points.</p><div class="scout-score-components"><span><small>Age-adjusted</small><b>${score(row.age_adjusted_performance)}</b></span><span><small>Trajectory</small><b>${score(row.trajectory)}</b></span><span><small>Vs expectation</small><b>${score(row.expectation_performance)}</b></span><span><small>Activity</small><b>${score(row.activity)}</b></span></div><a href="/prospects">View Scout Board →</a></div></section>`;
  return rewriter.on('.dossier-component-grid',{element(el){el.before(panel,{html:true});}}).on('head',{element(el){el.append('<link rel="stylesheet" href="/scout-score.css?v=1">',{html:true});}}).transform(response);
}

export async function enhancePromotionScoutScores(response:Response,env:Env,promotionSlug:string){
  if(!response.ok||!response.headers.get('content-type')?.includes('text/html'))return response;
  const result=await env.DB.prepare(`SELECT profile_slug,scout_score,scout_rank FROM scout_active_prospect_scores WHERE current_promotion_slug=?`).bind(promotionSlug).all<Row>();
  const map=new Map((result.results||[]).map(row=>[String(row.profile_slug),row]));
  return new HTMLRewriter()
    .on('.directory-rating small',{element(el){el.setInnerContent('Global Rating');}})
    .on('.directory-fighter-row',{element(el){const href=el.getAttribute('href')||'',slug=href.split('/').filter(Boolean).at(-1)||'',row=map.get(slug);if(row)el.append(`<span class="directory-scout-score"><small>Scout Score</small><b>${score(row.scout_score)}</b></span>`,{html:true});}})
    .on('head',{element(el){el.append('<link rel="stylesheet" href="/scout-score.css?v=1">',{html:true});}})
    .transform(response);
}
