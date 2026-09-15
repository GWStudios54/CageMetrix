import {BRAND_NAME,SITE_ORIGIN} from './brand.ts';

type Env={DB:D1Database;ASSETS:Fetcher;MODEL_VERSION:string};
type Row=Record<string,any>;
const GLOBAL_MODEL='global-1.0.0';
const JSON_HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'public, max-age=60, s-maxage=300'};
const escape=(value:unknown)=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]!));
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:JSON_HEADERS});
const limited=(value:string|null,fallback:number,max:number)=>Math.min(max,Math.max(1,Number.parseInt(value||'',10)||fallback));
const offset=(value:string|null)=>Math.max(0,Number.parseInt(value||'',10)||0);
const canonical=(path:string)=>`${SITE_ORIGIN}${path}`;

function age(dob:unknown){const raw=String(dob||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return null;const born=new Date(`${raw}T00:00:00Z`),now=new Date();let years=now.getUTCFullYear()-born.getUTCFullYear();if(now.getUTCMonth()<born.getUTCMonth()||(now.getUTCMonth()===born.getUTCMonth()&&now.getUTCDate()<born.getUTCDate()))years-=1;return years>=14&&years<=80?years:null;}
function prettyDate(value:unknown){const raw=String(value||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return '—';return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(`${raw}T12:00:00Z`));}
function record(row:Row){const w=Number(row.career_wins||0),l=Number(row.career_losses||0),d=Number(row.career_draws||0),nc=Number(row.career_no_contests||0);return `${w}-${l}${d?`-${d}`:''}${nc?` (${nc} NC)`:''}`;}
function score(value:unknown){if(value===null||value===undefined||value==='')return '—';const n=Number(value);return Number.isFinite(n)?n.toFixed(1):'—';}
function percent(value:unknown){if(value===null||value===undefined||value==='')return '—';const n=Number(value);return Number.isFinite(n)?`${Math.round(n)}%`:'—';}
function safeEvidence(raw:unknown){try{return JSON.parse(String(raw||'{}'))}catch{return {};}}
// Some source fight records carry a bout-type placeholder ("Professional", "Amateur") in the
// organization field instead of a real promotion name, e.g. when the underlying show wasn't a named
// promotion. Treat those as unknown rather than displaying "Last: professional" as if it were one.
const GENERIC_ORGANIZATION_VALUES=new Set(['unknown','professional','amateur','pro','mma','n/a','none']);
function isRealOrganization(value:unknown){const v=String(value||'').trim();return v.length>0&&!GENERIC_ORGANIZATION_VALUES.has(v.toLowerCase());}

function shell(title:string,description:string,path:string,body:string){const url=canonical(path);return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><meta name="description" content="${escape(description)}"><link rel="canonical" href="${escape(url)}"><meta name="robots" content="index,follow,max-image-preview:large"><meta property="og:type" content="website"><meta property="og:site_name" content="${BRAND_NAME}"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:url" content="${escape(url)}"><meta property="og:image" content="${SITE_ORIGIN}/og.png"><meta name="twitter:card" content="summary_large_image"><link rel="icon" href="/logo.svg" type="image/svg+xml"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/scout-directory.css"></head><body><header class="topbar"><a class="brand" href="/" aria-label="${BRAND_NAME} home"><img class="brand-mark" src="/logo.svg" alt="" width="44" height="44"><span>${BRAND_NAME}</span></a></header><main class="scout-directory-main">${body}</main><footer><span>${BRAND_NAME}</span><span>The MMA research engine.</span></footer></body></html>`;}

async function promotionSummary(env:Env){return env.DB.prepare(`
  SELECT sp.slug,sp.name,sp.region,sp.country,sp.scope,sp.official_url,sp.verified_at,
         COUNT(p.source_fighter_id) roster_count,
         ROUND(AVG(r.scout_rating),2) average_scout_rating,
         ROUND(MAX(r.scout_rating),2) top_scout_rating
  FROM scout_promotions sp
  LEFT JOIN scout_public_global_profiles p ON p.current_promotion_slug=sp.slug
  LEFT JOIN scout_active_global_ratings r
    ON r.source_key=p.source_key AND r.snapshot_id=p.snapshot_id AND r.source_fighter_id=p.source_fighter_id AND r.model_version=?
  WHERE sp.active=1
  GROUP BY sp.slug,sp.name,sp.region,sp.country,sp.scope,sp.official_url,sp.verified_at
  ORDER BY CASE sp.region WHEN 'United States' THEN 1 WHEN 'Europe' THEN 2 ELSE 3 END,roster_count DESC,sp.name
`).bind(GLOBAL_MODEL).all<Row>();}

export async function promotionsApi(request:Request,env:Env){
  if(request.method!=='GET')return json({error:'method_not_allowed'},405);
  const region=(new URL(request.url).searchParams.get('region')||'').trim();
  const result=await promotionSummary(env);let rows=result.results||[];
  if(region)rows=rows.filter(row=>String(row.region).toLowerCase()===region.toLowerCase());
  return json({data:rows,meta:{model_version:GLOBAL_MODEL,count:rows.length}});
}

export async function promotionApi(request:Request,env:Env,slug:string){
  if(request.method!=='GET')return json({error:'method_not_allowed'},405);
  const promo=await env.DB.prepare(`SELECT * FROM scout_promotions WHERE slug=? AND active=1 LIMIT 1`).bind(slug).first<Row>();
  if(!promo)return json({error:'promotion_not_found'},404);
  const url=new URL(request.url),division=(url.searchParams.get('weight_class')||'').trim(),limit=limited(url.searchParams.get('limit'),100,250),skip=offset(url.searchParams.get('offset'));
  const clauses=['p.current_promotion_slug=?'];const binds:any[]=[GLOBAL_MODEL,slug];
  if(division){clauses.push('p.current_weight_class=?');binds.push(division);}
  binds.push(limit,skip);
  const roster=await env.DB.prepare(`
    SELECT p.profile_slug,p.fighter_name,p.dob,p.nationality,p.gym,p.current_weight_class,p.last_fight_date,
           p.career_wins,p.career_losses,p.career_draws,p.career_no_contests,p.ko_tko_wins,p.submission_wins,p.recent_wins_730d,
           r.scout_rating,r.global_skill,r.resume_quality,r.schedule_strength,r.recent_form,r.finishing_quality,r.evidence_strength,r.division_rank,r.global_rank
    FROM scout_public_global_profiles p
    LEFT JOIN scout_active_global_ratings r
      ON r.source_key=p.source_key AND r.snapshot_id=p.snapshot_id AND r.source_fighter_id=p.source_fighter_id AND r.model_version=?
    WHERE ${clauses.join(' AND ')}
    ORDER BY r.scout_rating IS NULL,r.scout_rating DESC,p.last_fight_date DESC,p.fighter_name
    LIMIT ? OFFSET ?
  `).bind(...binds).all<Row>();
  return json({promotion:promo,data:roster.results||[],meta:{model_version:GLOBAL_MODEL,weight_class:division||null,limit,offset:skip}});
}

export async function globalFightersApi(request:Request,env:Env){
  if(request.method!=='GET')return json({error:'method_not_allowed'},405);
  const url=new URL(request.url),q=(url.searchParams.get('q')||'').trim().toLowerCase().slice(0,100),promotion=(url.searchParams.get('promotion')||'').trim(),division=(url.searchParams.get('weight_class')||'').trim(),region=(url.searchParams.get('region')||'').trim(),limit=limited(url.searchParams.get('limit'),25,100),skip=offset(url.searchParams.get('offset'));
  // Keep the default directory path rating-led so LIMIT is applied through the model/rating index before metadata joins.
  if(!q&&!promotion&&!division&&!region){
    const rows=await env.DB.prepare(`
      WITH ranked AS MATERIALIZED (
        SELECT p.profile_slug,p.fighter_name,p.dob,p.nationality,p.gym,p.current_organization,p.current_promotion_slug,p.current_weight_class,p.last_fight_date,
               p.career_wins,p.career_losses,p.career_draws,p.career_no_contests,p.ko_tko_wins,p.submission_wins,p.data_completeness,
               r.scout_rating,r.global_skill,r.resume_quality,r.schedule_strength,r.recent_form,r.finishing_quality,r.evidence_strength,r.division_rank,r.global_rank
        FROM scout_global_ratings AS r INDEXED BY idx_scout_global_rating_division
        JOIN mma_source_registry registry
          ON registry.source_key=r.source_key AND registry.active_snapshot_id=r.snapshot_id
        JOIN scout_global_profiles p
          ON p.source_key=r.source_key AND p.snapshot_id=r.snapshot_id AND p.source_fighter_id=r.source_fighter_id
        LEFT JOIN fighter_publication_controls controls
          ON controls.source_key=p.source_key AND controls.source_fighter_id=p.source_fighter_id
        WHERE r.model_version=? AND COALESCE(controls.public_status,'public')='public'
        ORDER BY r.scout_rating DESC
        LIMIT ? OFFSET ?
      )
      SELECT ranked.*,sp.name promotion_name,sp.region
      FROM ranked
      LEFT JOIN scout_promotions sp ON sp.slug=ranked.current_promotion_slug
      ORDER BY ranked.scout_rating DESC,ranked.last_fight_date DESC,ranked.fighter_name
    `).bind(GLOBAL_MODEL,limit,skip).all<Row>();
    return json({data:rows.results||[],meta:{model_version:GLOBAL_MODEL,q:null,promotion:null,weight_class:null,region:null,limit,offset:skip}});
  }
  const clauses=['1=1'];const binds:any[]=[GLOBAL_MODEL];
  if(q){clauses.push('instr(p.normalized_name,?)>0');binds.push(q);}
  if(promotion){clauses.push('p.current_promotion_slug=?');binds.push(promotion);}
  if(division){clauses.push('p.current_weight_class=?');binds.push(division);}
  if(region){clauses.push('sp.region=?');binds.push(region);}
  binds.push(limit,skip);
  const rows=await env.DB.prepare(`
    SELECT p.profile_slug,p.fighter_name,p.dob,p.nationality,p.gym,p.current_organization,p.current_promotion_slug,p.current_weight_class,p.last_fight_date,
           p.career_wins,p.career_losses,p.career_draws,p.career_no_contests,p.ko_tko_wins,p.submission_wins,p.data_completeness,
           sp.name promotion_name,sp.region,
           r.scout_rating,r.global_skill,r.resume_quality,r.schedule_strength,r.recent_form,r.finishing_quality,r.evidence_strength,r.division_rank,r.global_rank
    FROM scout_public_global_profiles p
    LEFT JOIN scout_promotions sp ON sp.slug=p.current_promotion_slug
    LEFT JOIN scout_active_global_ratings r
      ON r.source_key=p.source_key AND r.snapshot_id=p.snapshot_id AND r.source_fighter_id=p.source_fighter_id AND r.model_version=?
    WHERE ${clauses.join(' AND ')}
    ORDER BY r.scout_rating IS NULL,r.scout_rating DESC,p.last_fight_date DESC,p.fighter_name
    LIMIT ? OFFSET ?
  `).bind(...binds).all<Row>();
  return json({data:rows.results||[],meta:{model_version:GLOBAL_MODEL,q:q||null,promotion:promotion||null,weight_class:division||null,region:region||null,limit,offset:skip}});
}

export async function globalFighterApi(request:Request,env:Env,slug:string){
  if(request.method!=='GET')return json({error:'method_not_allowed'},405);
  const fighter=await env.DB.prepare(`
    SELECT p.*,sp.name promotion_name,sp.region promotion_region,sp.country promotion_country,sp.official_url,
           r.model_version,r.as_of_date,r.scout_rating,r.global_skill,r.resume_quality,r.schedule_strength,r.recent_form,r.finishing_quality,r.evidence_strength,
           r.pre_fight_elo,r.division_rank,r.global_rank,r.model_weights_json,r.evidence_json
    FROM scout_public_global_profiles p
    LEFT JOIN scout_promotions sp ON sp.slug=p.current_promotion_slug
    LEFT JOIN scout_active_global_ratings r
      ON r.source_key=p.source_key AND r.snapshot_id=p.snapshot_id AND r.source_fighter_id=p.source_fighter_id AND r.model_version=?
    WHERE p.profile_slug=? LIMIT 1
  `).bind(GLOBAL_MODEL,slug).first<Row>();
  if(!fighter)return json({error:'fighter_not_found'},404);
  const [fights,orgs]=await Promise.all([
    env.DB.prepare(`SELECT event_date,organization,promotion_slug,event_name,event_location,weight_class,result,opponent_source_fighter_id,opponent_name,opponent_pre_elo,is_title_fight,method,round_num,time_finish_seconds FROM scout_active_global_fights WHERE source_key=? AND snapshot_id=? AND source_fighter_id=? ORDER BY event_date DESC,source_fight_id DESC LIMIT 150`).bind(fighter.source_key,fighter.snapshot_id,fighter.source_fighter_id).all<Row>(),
    env.DB.prepare(`SELECT organization,COUNT(*) bouts,SUM(CASE WHEN result='W' THEN 1 ELSE 0 END) wins,MIN(event_date) first_fight,MAX(event_date) last_fight FROM scout_active_global_fights WHERE source_key=? AND snapshot_id=? AND source_fighter_id=? GROUP BY organization ORDER BY last_fight DESC`).bind(fighter.source_key,fighter.snapshot_id,fighter.source_fighter_id).all<Row>()
  ]);
  return json({fighter:{...fighter,age:age(fighter.dob),evidence:safeEvidence(fighter.evidence_json)},fights:fights.results||[],organizations:orgs.results||[]});
}

function promotionCard(row:Row){return `<a class="directory-promo-card" href="/promotions/${escape(row.slug)}"><span class="directory-region">${escape(row.region)}</span><h3>${escape(row.name)}</h3><p>${escape(row.country||'')}</p><div class="directory-card-stats"><span><b>${Number(row.roster_count||0)}</b> indexed fighters</span><span><b>${score(row.top_scout_rating)}</b> top rating</span></div><span class="directory-arrow">View roster →</span></a>`;}

export async function promotionsPage(_request:Request,env:Env){
  const rows=(await promotionSummary(env)).results||[];
  const groups=['United States','Europe','Asia'].map(region=>`<section class="directory-region-section"><div class="directory-section-head"><span class="eyebrow">${escape(region.toUpperCase())}</span><h2>${escape(region)} scouting circuits</h2></div><div class="directory-promo-grid">${rows.filter(row=>row.region===region).map(promotionCard).join('')}</div></section>`).join('');
  const body=`<section class="directory-hero"><span class="eyebrow">GLOBAL SCOUTING NETWORK</span><h1>Regional promotions.</h1><p>Follow feeder systems and major regional organizations producing the next generation of MMA talent. Promotion labels organize the research; they do not receive automatic Scout Rating bonuses.</p><div class="directory-hero-actions"><a class="button primary" href="/scout?q=${encodeURIComponent('Find the best regional prospects under 25')}">Ask Scout AI about prospects</a><a class="button secondary" href="/#rankings">Scout Rankings</a></div></section>${groups}`;
  return new Response(shell('Regional MMA Promotions & Fighter Rosters | MMA Scouts','Scout regional MMA promotions in the United States, Europe and Asia with fighter rosters, records and Global Scout Ratings.','/promotions',body),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'public, max-age=60, s-maxage=300'}});
}

export async function promotionPage(request:Request,env:Env,slug:string){
  const apiUrl=new URL(request.url);apiUrl.searchParams.set('limit','250');
  const response=await promotionApi(new Request(apiUrl,{method:'GET'}),env,slug);if(!response.ok)return new Response('Not found',{status:404});const payload:any=await response.json(),promo:Row=payload.promotion,rows:Row[]=payload.data||[];
  const divisions=[...new Set(rows.map(row=>String(row.current_weight_class||'Unknown')))].sort();
  const roster=rows.map((row,index)=>`<a class="directory-fighter-row" href="/scout/fighters/${escape(row.profile_slug)}"><span class="directory-rank">${row.division_rank?`#${Number(row.division_rank)}`:`${index+1}`}</span><span class="directory-fighter"><strong>${escape(row.fighter_name)}</strong><small>${escape(row.current_weight_class||'Unknown')} · ${escape(record(row))}${row.nationality?` · ${escape(row.nationality)}`:''}</small></span><span class="directory-component"><small>Résumé</small><b>${score(row.resume_quality)}</b></span><span class="directory-component"><small>Schedule</small><b>${score(row.schedule_strength)}</b></span><span class="directory-rating"><small>Scout Rating</small><b>${score(row.scout_rating)}</b><em>Evidence ${percent(row.evidence_strength)}</em></span></a>`).join('');
  const body=`<section class="directory-hero directory-promo-hero"><a class="directory-back" href="/promotions">← All promotions</a><span class="eyebrow">${escape(promo.region)} · ${escape(String(promo.scope).replaceAll('_',' '))}</span><h1>${escape(promo.name)}</h1><p>${escape(promo.country||'')} · ${rows.length} indexed fighters${promo.official_url?` · <a href="${escape(promo.official_url)}" rel="nofollow noopener">Official site ↗</a>`:''}</p>${divisions.length?`<div class="directory-chips">${divisions.map(d=>`<span>${escape(d)}</span>`).join('')}</div>`:''}</section><section class="directory-roster"><div class="directory-section-head"><span class="eyebrow">SCOUT ROSTER</span><h2>Fighters by Global Scout Rating</h2><p>Opponent strength travels with the fighter through the global fight graph. The promotion name itself adds no points.</p></div><div class="directory-fighter-list">${roster||'<p class="directory-empty">No indexed roster yet.</p>'}</div></section>`;
  return new Response(shell(`${promo.name} Fighter Roster, Records & Scout Ratings | MMA Scouts`,`Research ${promo.name} fighters, records, opponent quality and Global Scout Ratings on MMA Scouts.`,`/promotions/${slug}`,body),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'public, max-age=60, s-maxage=300'}});
}

export async function globalFighterPage(request:Request,env:Env,slug:string){
  const response=await globalFighterApi(new Request(request.url,{method:'GET'}),env,slug);if(!response.ok)return new Response('Not found',{status:404});const payload:any=await response.json(),f:Row=payload.fighter,e:any=f.evidence||{},fights:Row[]=payload.fights||[],orgs:Row[]=payload.organizations||[];
  const bestWins=(Array.isArray(e.best_wins)?e.best_wins:[]).map((win:any)=>`<div class="dossier-evidence-row"><span><strong>${escape(win.opponent)}</strong><small>${escape(prettyDate(win.date))}${win.finish?' · Finish':''}</small></span><b>Opp. ${Math.round(Number(win.opponent_pre_elo||0))}</b></div>`).join('');
  const fightRows=fights.slice(0,20).map(row=>`<div class="dossier-fight-row"><span class="dossier-result ${String(row.result).toLowerCase()}">${escape(row.result)}</span><span class="dossier-fight-name"><strong>${escape(row.opponent_name)}</strong><small>${escape(prettyDate(row.event_date))} · ${escape(row.organization)}${row.weight_class?` · ${escape(row.weight_class)}`:''}</small></span><span class="dossier-method">${escape(row.method||'—')}</span></div>`).join('');
  const orgRows=orgs.slice(0,12).map(row=>`<div class="dossier-org-row"><span><strong>${escape(row.organization)}</strong><small>${escape(prettyDate(row.first_fight))} – ${escape(prettyDate(row.last_fight))}</small></span><b>${Number(row.wins||0)}-${Math.max(0,Number(row.bouts||0)-Number(row.wins||0))}</b></div>`).join('');
  const finishes=Number(f.ko_tko_wins||0)+Number(f.submission_wins||0);
  const avgFinishRound=finishes>0?(Number(f.finish_round_sum||0)/finishes):null;
  const timesFinished=Number(f.times_finished||0);
  const durability=timesFinished>0?`Finished ${timesFinished}x`:Number(f.career_bouts||0)>=3?'Never finished':null;
  const factRows:[string,unknown][]=[['Age',f.age],['Height',f.height_cm?`${Math.round(Number(f.height_cm))} cm`:null],['Reach',f.reach_cm?`${Math.round(Number(f.reach_cm))} cm`:null],['Stance',f.stance],['Nationality',f.nationality],['Gym',f.gym],['Career span',f.career_start_date?`${prettyDate(f.career_start_date)} – ${prettyDate(f.last_fight_date)}`:null],['Organizations',Number(f.organization_count||0)],['Title fights',`${Number(f.title_fight_wins||0)} wins / ${Number(f.title_fight_bouts||0)} bouts`],['Finishes',`${Number(f.ko_tko_wins||0)} KO/TKO · ${Number(f.submission_wins||0)} SUB`],['Avg finish round',avgFinishRound!==null?`${avgFinishRound.toFixed(1)}${Number(f.first_round_finishes||0)>0?` (${Number(f.first_round_finishes)} in round 1)`:''}`:null],['Durability',durability],['Data completeness',percent(f.data_completeness)]];
  const facts=factRows.filter(([,v])=>v!==null&&v!==undefined&&v!=='');
  const body=`<section class="dossier-hero"><div><a class="directory-back" href="${f.current_promotion_slug?`/promotions/${escape(f.current_promotion_slug)}`:'/promotions'}">← ${escape(f.promotion_name||'Regional scouting')}</a><span class="eyebrow">FIGHTER SCOUT REPORT</span><h1>${escape(f.fighter_name)}</h1><p class="dossier-record">${escape(record(f))} · ${escape(f.current_weight_class||'Unknown division')}${f.promotion_name?` · ${escape(f.promotion_name)}`:isRealOrganization(f.current_organization)?` · Last: ${escape(f.current_organization)}`:''}</p></div><div class="dossier-rating-hero"><small>GLOBAL SCOUT RATING</small><strong>${score(f.scout_rating)}</strong><span>Evidence ${percent(f.evidence_strength)}</span>${f.division_rank?`<em>#${Number(f.division_rank)} indexed ${escape(f.current_weight_class||'division')}</em>`:''}</div></section><section class="dossier-component-grid"><article><small>Global Skill</small><strong>${score(f.global_skill)}</strong><p>Chronological fight-graph strength.</p></article><article><small>Résumé</small><strong>${score(f.resume_quality)}</strong><p>Quality and breadth of proven wins.</p></article><article><small>Schedule</small><strong>${score(f.schedule_strength)}</strong><p>Strength of opponents actually faced.</p></article><article><small>Recent Form</small><strong>${score(f.recent_form)}</strong><p>Recent results versus expectation.</p></article><article><small>Finishing</small><strong>${score(f.finishing_quality)}</strong><p>Quality-adjusted finishing production.</p></article></section><section class="dossier-grid"><div class="dossier-panel"><span class="eyebrow">PROFILE</span><h2>Scouting file</h2><div class="dossier-facts">${facts.map(([key,value])=>`<div><small>${escape(key)}</small><strong>${escape(value)}</strong></div>`).join('')}</div></div><div class="dossier-panel"><span class="eyebrow">BEST PROVEN WINS</span><h2>Résumé anchors</h2><p class="dossier-note">Opponent values are the opponent's rating state before that fight, not hindsight credit.</p><div class="dossier-evidence-list">${bestWins||'<p class="directory-empty">No decisive wins resolved yet.</p>'}</div></div></section><section class="dossier-grid"><div class="dossier-panel"><span class="eyebrow">RECENT HISTORY</span><h2>Last 20 fights</h2><div class="dossier-fight-list">${fightRows||'<p class="directory-empty">Fight identity is still being resolved for this profile.</p>'}</div></div><div class="dossier-panel"><span class="eyebrow">CAREER PATH</span><h2>Promotion history</h2><div class="dossier-org-list">${orgRows||'<p class="directory-empty">No resolved promotion history yet.</p>'}</div><div class="dossier-methodology"><strong>How this rating works</strong><p>Global Scout Rating uses the same fight-graph rules for every promotion. A logo does not add points. Beating strong fighters, facing strong schedules, outperforming expectation and building credible evidence does.</p></div></div></section><section class="dossier-panel"><span class="eyebrow">FIGHTER CONTROL</span><h2>Is this your profile?</h2><p class="dossier-note">Fighters can request removal from MMA Scouts public surfaces. We verify the request before suppression to prevent unauthorized removals.</p><p><a href="/profile-removal?profile=${encodeURIComponent(slug)}">Request profile removal →</a></p></section>`;
  return new Response(shell(`${f.fighter_name} Record, Scout Rating & Fight History | MMA Scouts`,`${f.fighter_name} MMA record, Global Scout Rating, opponent quality, recent form, promotion history and scouting profile.`,`/scout/fighters/${slug}`,body),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'public, max-age=120, s-maxage=600'}});
}
