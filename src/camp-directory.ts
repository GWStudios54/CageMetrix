import {BRAND_NAME,SITE_ORIGIN} from './brand.ts';

type Env={DB:D1Database};
type Row=Record<string,any>;
const GLOBAL_MODEL='global-1.0.0';
const JSON_HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'public, max-age=60, s-maxage=300'};
const escape=(value:unknown)=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]!));
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:JSON_HEADERS});
const canonical=(path:string)=>`${SITE_ORIGIN}${path}`;
const score=(value:unknown)=>{if(value===null||value===undefined||value==='')return '—';const n=Number(value);return Number.isFinite(n)?n.toFixed(1):'—';};
const record=(row:Row)=>{const w=Number(row.career_wins||0),l=Number(row.career_losses||0),d=Number(row.career_draws||0),nc=Number(row.career_no_contests||0);return `${w}-${l}${d?`-${d}`:''}${nc?` (${nc} NC)`:''}`;};
const prettyDate=(value:unknown)=>{const raw=String(value||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return null;return new Intl.DateTimeFormat('en-US',{month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(`${raw}T12:00:00Z`));};

// Camps span more, and more varied, countries than the promotion directory's US/Europe/Asia
// grouping -- this maps the actual seeded set (migrations/0044) to a handful of continent buckets
// for directory grouping. A country not in this map falls into "Other" rather than crashing.
const CONTINENT_BY_COUNTRY:Record<string,string>={
  'United States':'North America','Canada':'North America',
  'Brazil':'South America',
  'Sweden':'Europe','France':'Europe','United Kingdom':'Europe','Ireland':'Europe','Russia':'Europe',
  'South Korea':'Asia-Pacific','China':'Asia-Pacific','Japan':'Asia-Pacific','Singapore':'Asia-Pacific','Thailand':'Asia-Pacific','New Zealand':'Asia-Pacific'
};
const CONTINENT_ORDER=['North America','South America','Europe','Asia-Pacific','Other'];
const continentOf=(country:unknown)=>CONTINENT_BY_COUNTRY[String(country||'')]||'Other';

function shell(title:string,description:string,path:string,body:string){const url=canonical(path);return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><meta name="description" content="${escape(description)}"><link rel="canonical" href="${escape(url)}"><meta name="robots" content="index,follow,max-image-preview:large"><meta property="og:type" content="website"><meta property="og:site_name" content="${BRAND_NAME}"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:url" content="${escape(url)}"><meta property="og:image" content="${SITE_ORIGIN}/og.png"><meta name="twitter:card" content="summary_large_image"><link rel="icon" href="/logo.svg" type="image/svg+xml"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/scout-directory.css"></head><body><header class="topbar"><a class="brand" href="/" aria-label="${BRAND_NAME} home"><img class="brand-mark" src="/logo.svg" alt="" width="44" height="44"><span>${BRAND_NAME}</span></a></header><main class="scout-directory-main">${body}</main><footer><span>${BRAND_NAME}</span><span>The MMA research engine.</span></footer></body></html>`;}

async function campSummary(env:Env){return env.DB.prepare(`
  SELECT t.slug,t.name,t.city,t.region,t.country,t.website_url,t.verified_at,
         COUNT(cur.source_fighter_id) roster_count,
         ROUND(MAX(r.scout_rating),2) top_scout_rating
  FROM training_camps t
  LEFT JOIN scout_current_camp cur ON cur.camp_id=t.id
  LEFT JOIN scout_public_global_profiles p ON p.source_key=cur.source_key AND p.source_fighter_id=cur.source_fighter_id
  LEFT JOIN scout_active_global_ratings r
    ON r.source_key=p.source_key AND r.snapshot_id=p.snapshot_id AND r.source_fighter_id=p.source_fighter_id AND r.model_version=?
  WHERE t.active=1
  GROUP BY t.slug,t.name,t.city,t.region,t.country,t.website_url,t.verified_at
  ORDER BY roster_count DESC,t.name
`).bind(GLOBAL_MODEL).all<Row>();}

export async function campsApi(request:Request,env:Env){
  if(request.method!=='GET')return json({error:'method_not_allowed'},405);
  const result=await campSummary(env);
  return json({data:result.results||[],meta:{count:(result.results||[]).length}});
}

export async function campApi(request:Request,env:Env,slug:string){
  if(request.method!=='GET')return json({error:'method_not_allowed'},405);
  const camp=await env.DB.prepare(`SELECT * FROM training_camps WHERE slug=? AND active=1 LIMIT 1`).bind(slug).first<Row>();
  if(!camp)return json({error:'camp_not_found'},404);
  const [roster,alumni]=await Promise.all([
    env.DB.prepare(`
      SELECT p.profile_slug,p.fighter_name,p.nationality,p.current_weight_class,p.last_fight_date,
             p.career_wins,p.career_losses,p.career_draws,p.career_no_contests,
             cur.coach_name,cur.started_at,
             r.scout_rating,r.division_rank,r.global_rank,r.evidence_strength
      FROM scout_current_camp cur
      JOIN scout_public_global_profiles p ON p.source_key=cur.source_key AND p.source_fighter_id=cur.source_fighter_id
      LEFT JOIN scout_active_global_ratings r
        ON r.source_key=p.source_key AND r.snapshot_id=p.snapshot_id AND r.source_fighter_id=p.source_fighter_id AND r.model_version=?
      WHERE cur.camp_id=?
      ORDER BY r.scout_rating IS NULL,r.scout_rating DESC,p.fighter_name
      LIMIT 250
    `).bind(GLOBAL_MODEL,camp.id).all<Row>(),
    env.DB.prepare(`
      SELECT DISTINCT p.profile_slug,p.fighter_name,h.started_at,h.ended_at
      FROM fighter_camp_history h
      JOIN scout_public_global_profiles p ON p.source_key=h.source_key AND p.source_fighter_id=h.source_fighter_id
      WHERE h.camp_id=? AND h.is_current=0
      ORDER BY COALESCE(h.ended_at,h.started_at) DESC
      LIMIT 20
    `).bind(camp.id).all<Row>()
  ]);
  return json({camp,roster:roster.results||[],alumni:alumni.results||[]});
}

function campCard(row:Row){
  const location=[row.city,row.region,row.country].filter(Boolean).join(', ');
  return `<a class="directory-promo-card" href="/camps/${escape(row.slug)}"><span class="directory-region">${escape(continentOf(row.country).toUpperCase())}</span><h3>${escape(row.name)}</h3><p>${escape(location||'Location not publicly listed')}</p><div class="directory-card-stats"><span><b>${Number(row.roster_count||0)}</b> current fighters</span><span><b>${score(row.top_scout_rating)}</b> top rating</span></div><span class="directory-arrow">View camp →</span></a>`;
}

export async function campsPage(_request:Request,env:Env){
  const result=await campSummary(env);const rows=result.results||[];
  const groups=CONTINENT_ORDER.map(continent=>{const inRegion=rows.filter(row=>continentOf(row.country)===continent);if(!inRegion.length)return '';return `<section class="directory-region-section"><div class="directory-section-head"><span class="eyebrow">${escape(continent.toUpperCase())}</span><h2>${escape(continent)} training camps</h2></div><div class="directory-promo-grid">${inRegion.map(campCard).join('')}</div></section>`;}).join('');
  const body=`<section class="directory-hero"><span class="eyebrow">TRAINING CAMP NETWORK</span><h1>Where fighters train.</h1><p>Camp and gym affiliation is published only when public evidence supports it and dated to when the affiliation actually changed. A camp listing organizes the research; it does not receive automatic Scout Rating bonuses.</p><div class="directory-hero-actions"><a class="button primary" href="/scout?q=${encodeURIComponent('Which training camp produces the best prospects?')}">Ask Scout AI about camps</a><a class="button secondary" href="/#rankings">Scout Rankings</a></div></section>${groups}`;
  return new Response(shell('Training Camps & Gyms Directory | MMA Scouts','Browse professional MMA training camps and gyms with current rosters, coaches and Global Scout Ratings.','/camps',body),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'public, max-age=60, s-maxage=300'}});
}

export async function campPage(request:Request,env:Env,slug:string){
  const apiUrl=new URL(request.url);
  const response=await campApi(new Request(apiUrl,{method:'GET'}),env,slug);if(!response.ok)return new Response('Not found',{status:404});
  const payload:any=await response.json(),camp:Row=payload.camp,roster:Row[]=payload.roster||[],alumni:Row[]=payload.alumni||[];
  const location=[camp.city,camp.region,camp.country].filter(Boolean).join(', ');
  const rosterRows=roster.map((row,index)=>`<a class="directory-fighter-row" href="/scout/fighters/${escape(row.profile_slug)}"><span class="directory-rank">${row.division_rank?`#${Number(row.division_rank)}`:`${index+1}`}</span><span class="directory-fighter"><strong>${escape(row.fighter_name)}</strong><small>${escape(row.current_weight_class||'Unknown')} · ${escape(record(row))}${row.coach_name?` · Coach: ${escape(row.coach_name)}`:''}</small></span><span class="directory-rating"><small>Scout Rating</small><b>${score(row.scout_rating)}</b></span></a>`).join('');
  const alumniRows=alumni.map(row=>`<div class="dossier-org-row"><span><strong><a href="/scout/fighters/${escape(row.profile_slug)}">${escape(row.fighter_name)}</a></strong><small>${row.ended_at?`Left ${prettyDate(row.ended_at)||row.ended_at}`:'Departure date not publicly established'}</small></span></div>`).join('');
  const body=`<section class="directory-hero directory-promo-hero"><a class="directory-back" href="/camps">← All training camps</a><span class="eyebrow">${escape(continentOf(camp.country).toUpperCase())}</span><h1>${escape(camp.name)}</h1><p>${escape(location||'Location not publicly listed')} · ${roster.length} current fighter${roster.length===1?'':'s'}${camp.website_url?` · <a href="${escape(camp.website_url)}" rel="nofollow noopener">Official site ↗</a>`:''}</p></section><section class="directory-roster"><div class="directory-section-head"><span class="eyebrow">CURRENT ROSTER</span><h2>Fighters training here now</h2><p>Camp affiliation is sourced and dated per fighter; see each fighter's profile for evidence.</p></div><div class="directory-fighter-list">${rosterRows||'<p class="directory-empty">No current camp affiliation publicly verified yet.</p>'}</div></section>${alumni.length?`<section class="dossier-grid"><div class="dossier-panel"><span class="eyebrow">CAMP HISTORY</span><h2>Former fighters</h2><div class="dossier-org-list">${alumniRows}</div></div></section>`:''}`;
  return new Response(shell(`${camp.name} Roster & Fighters | MMA Scouts`,`Research ${camp.name}'s current fighter roster, coaches and Global Scout Ratings on MMA Scouts.`,`/camps/${slug}`,body),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'public, max-age=60, s-maxage=300'}});
}
