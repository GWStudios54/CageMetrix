import {SITE_ORIGIN} from './brand.ts';

type Env={DB:D1Database};
type Row=Record<string,any>;
const HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'public, max-age=60, s-maxage=300','x-content-type-options':'nosniff'};
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]!));
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:HEADERS});
const pretty=(value:unknown)=>{const raw=String(value||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return String(value||'—');try{return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(`${raw}T12:00:00Z`));}catch{return raw;}};
const label=(value:unknown)=>String(value||'').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());

const CORE_FIELDS:[string,string,(row:Row)=>boolean][]=[
  ['Date of birth','dob',r=>Boolean(r.dob)],['Height','height_cm',r=>r.height_cm!==null&&r.height_cm!==undefined],['Reach','reach_cm',r=>r.reach_cm!==null&&r.reach_cm!==undefined],['Stance','stance',r=>Boolean(r.stance)],
  ['Nationality','nationality',r=>Boolean(r.nationality)],['Gym / team','gym',r=>Boolean(String(r.gym||'').trim())],['Organization','current_organization',r=>Boolean(String(r.current_organization||'').trim())],['Weight class','current_weight_class',r=>Boolean(r.current_weight_class)],
  ['Career start','career_start_date',r=>Boolean(r.career_start_date)],['Last fight','last_fight_date',r=>Boolean(r.last_fight_date)],['Management','management_status',r=>r.management_status!=='unknown'],['Contract','contract_status',r=>r.contract_status!=='unknown'],
  ['Fight availability','open_to_fights',r=>r.open_to_fights!=='unknown'],['Management availability','open_to_management',r=>r.open_to_management!=='unknown'],['Team availability','open_to_team',r=>r.open_to_team!=='unknown'],['Professional base','base',r=>Boolean(r.base_city||r.base_region||r.base_country)],['Professional contact','professional_contact_url',r=>Boolean(r.professional_contact_url)]
];

function gaps(row:Row){return CORE_FIELDS.filter(([, ,known])=>!known(row)).map(([name])=>name);}
function confidence(value:unknown){return value==='A'?'Primary / verified':value==='B'?'Strong source':'Public record';}
function factValue(row:Row){
  if(row.fact_key==='identity.dob'||row.fact_key==='career.start'||row.fact_key==='career.last_fight')return pretty(row.value_text);
  if(row.fact_key.startsWith('availability.'))return label(row.value_text);
  if(row.fact_key==='contract.status')return label(row.value_text);
  return String(row.value_text||'—');
}

export async function fighterIntelApi(request:Request,env:Env,slug:string){
  if(request.method!=='GET')return json({error:'method_not_allowed'},405);
  const coverage=await env.DB.prepare(`
    SELECT c.*,s.scout_score,s.scout_rank,s.division_scout_rank,s.trajectory,s.activity,s.evidence_strength scout_score_evidence
    FROM scout_fighter_intel_coverage c
    JOIN scout_public_global_profiles p ON p.source_key=c.source_key AND p.source_fighter_id=c.source_fighter_id
    LEFT JOIN scout_active_prospect_scores s ON s.source_key=c.source_key AND s.source_fighter_id=c.source_fighter_id
    WHERE c.profile_slug=? LIMIT 1
  `).bind(slug).first<Row>();
  if(!coverage)return json({error:'fighter_not_found'},404);
  const [facts,events,management,sources]=await Promise.all([
    env.DB.prepare(`SELECT category,fact_key,value_text,value_json,effective_at,ended_at,source_slug,source_url,source_type,confidence,verified_at,last_checked_at,notes FROM fighter_intel_facts WHERE source_key=? AND source_fighter_id=? AND is_current=1 ORDER BY CASE confidence WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END,category,fact_key,verified_at DESC LIMIT 120`).bind(coverage.source_key,coverage.source_fighter_id).all<Row>(),
    env.DB.prepare(`SELECT event_type,title,summary,occurred_at,source_slug,source_url,source_type,confidence,verified_at FROM fighter_intel_events WHERE source_key=? AND source_fighter_id=? ORDER BY COALESCE(occurred_at,verified_at) DESC,verified_at DESC LIMIT 40`).bind(coverage.source_key,coverage.source_fighter_id).all<Row>(),
    env.DB.prepare(`SELECT agency_slug,agency_name,agency_website,agency_contact_kind,agency_contact_value,agency_contact_label,agency_contact_source_url,agency_contact_confidence,agency_contact_verified_at,manager_name,started_at,source_url,source_type,confidence,verified_at,last_checked_at FROM scout_current_management WHERE source_key=? AND source_fighter_id=? LIMIT 1`).bind(coverage.source_key,coverage.source_fighter_id).first<Row>(),
    env.DB.prepare(`SELECT source_slug,name,source_kind,base_url,official,priority FROM fighter_intel_sources WHERE active=1 ORDER BY priority DESC,name`).all<Row>()
  ]);
  return json({
    fighter:{profile_slug:coverage.profile_slug,fighter_name:coverage.fighter_name},
    coverage:{...coverage,gaps:gaps(coverage)},
    management:management||null,
    facts:facts.results||[],events:events.results||[],sources:sources.results||[],
    policy:{unknown_remains_unknown:true,professional_public_sources_only:true,no_private_contact_publication:true,no_rating_bonus_from_management:true,fighter_removal_supported:true}
  });
}

function statusRows(row:Row,management:Row|null){
  const base=[row.base_city,row.base_region,row.base_country].filter(Boolean).join(', ');
  return [
    ['Management',row.management_status==='represented'?(management?.agency_name||management?.manager_name||'Represented'):row.management_status==='unmanaged'?'Verified unmanaged':'Unknown'],
    ['Contract',row.contract_status==='unknown'?'Unknown':label(row.contract_status)],
    ['Gym / team',row.gym||'Unknown'],
    ['Professional base',base||'Unknown'],
    ['Fight availability',row.open_to_fights==='unknown'?'Unknown':label(row.open_to_fights)],
    ['Open to management',row.open_to_management==='unknown'?'Unknown':label(row.open_to_management)],
    ['Open to teams',row.open_to_team==='unknown'?'Unknown':label(row.open_to_team)]
  ];
}

export async function enhanceFighterIntel(response:Response,env:Env,slug:string){
  if(!response.ok||!response.headers.get('content-type')?.includes('text/html'))return response;
  let payload:any;
  try{const api=await fighterIntelApi(new Request(`${SITE_ORIGIN}/api/scout/fighters/${encodeURIComponent(slug)}/intel`),env,slug);if(!api.ok)return response;payload=await api.json();}catch{return response;}
  const c:Row=payload.coverage||{},management:Row|null=payload.management||null,facts:Row[]=payload.facts||[],events:Row[]=payload.events||[];
  const sourceFacts=facts.filter(f=>f.source_type!=='derived_warehouse').slice(0,10);
  const timeline=events.slice(0,12).map(event=>`<div class="dossier-evidence-row"><span><strong>${esc(event.title)}</strong><small>${esc(pretty(event.occurred_at||event.verified_at))}${event.summary?` · ${esc(event.summary)}`:''}</small></span><b>${esc(confidence(event.confidence))}</b></div>`).join('');
  const sourced=sourceFacts.map(f=>`<div class="dossier-evidence-row"><span><strong>${esc(label(f.fact_key.split('.').at(-1)))}: ${esc(factValue(f))}</strong><small>${esc(f.source_slug||f.source_type)} · checked ${esc(pretty(f.verified_at))}</small></span>${f.source_url?`<a href="${esc(f.source_url)}" rel="nofollow noopener">Source ↗</a>`:`<b>${esc(confidence(f.confidence))}</b>`}</div>`).join('');
  const rows=statusRows(c,management).map(([key,value])=>`<div><small>${esc(key)}</small><strong>${esc(value)}</strong></div>`).join('');
  const gapList=(c.gaps||[]).slice(0,10).map((g:string)=>`<span class="talent-badge muted">${esc(g)}</span>`).join('');
  const contactLabel=c.professional_contact_kind==='management_booking_email'?'Agency booking email'
    :c.professional_contact_kind==='management_email'?'Agency email'
    :c.professional_contact_kind==='management_booking_form'?'Agency booking form'
    :c.professional_contact_kind==='management_contact_form'?'Agency contact form'
    :c.professional_contact_kind==='management_website'?'Agency website'
    :'Public professional contact';
  const contact=c.professional_contact_url?`<p><a class="button secondary" href="${esc(c.professional_contact_url)}" rel="nofollow noopener">${esc(contactLabel)} ↗</a></p>`:'';
  const html=`<section class="dossier-grid fighter-intel-section"><div class="dossier-panel"><span class="eyebrow">INTELLIGENCE COVERAGE</span><h2>Professional intel file</h2><p class="dossier-note">${Number(c.known_intel_fields||0)} of 17 core scouting fields currently resolved · ${Number(c.intel_coverage_pct||0).toFixed(1)}% coverage. Missing evidence stays unknown.</p><div class="dossier-facts">${rows}</div>${contact}${gapList?`<div class="talent-statuses"><small>Open intelligence gaps</small>${gapList}</div>`:''}</div><div class="dossier-panel"><span class="eyebrow">SOURCE-BACKED INTEL</span><h2>Verified context</h2><div class="dossier-evidence-list">${sourced||'<p class="directory-empty">No external professional-source facts have been attached yet. Warehouse scouting data remains available above.</p>'}</div></div></section><section class="dossier-grid"><div class="dossier-panel"><span class="eyebrow">CAREER INTELLIGENCE</span><h2>Movement timeline</h2><div class="dossier-evidence-list">${timeline||'<p class="directory-empty">No career-movement events resolved yet.</p>'}</div></div><div class="dossier-panel"><span class="eyebrow">INTEL POLICY</span><h2>What MMA Scouts will and won't claim</h2><p>Official promotion, management, team, fighter, commission and verified-profile sources take priority. Credible reporting can supplement them. We do not infer free agency, lack of management, availability or a team departure from missing data, and we do not publish private phone numbers, street/home addresses, exact residential locations or private email addresses.</p></div></section>`;
  return new HTMLRewriter().on('main.scout-directory-main',{element(el){el.append(html,{html:true});}}).transform(response);
}
