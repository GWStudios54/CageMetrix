import {scoutAsk as legacyScoutAsk} from './scout-ai.ts';

interface AiBinding { run(model:string,input:unknown,options?:unknown):Promise<unknown>; }
interface RateLimiter { limit(input:{key:string}):Promise<{success:boolean}>; }
interface Env {
  DB:D1Database;
  AI?:AiBinding;
  MODEL_VERSION:string;
  SCOUT_BURST_LIMITER?:RateLimiter;
  SCOUT_MINUTE_LIMITER?:RateLimiter;
}

type ExtendedIntent='prospect_search'|'similar_fighters'|'pre_ufc_rankings'|'legacy';
type PreMetric='resume'|'wins'|'major_org_bouts'|'finishes'|'bouts';
interface ExtendedPlan {
  intent:ExtendedIntent;
  fighter:string;
  division:string;
  age_under:number;
  min_wins:number;
  undefeated:boolean;
  outside_ufc:boolean;
  recent_days:number;
  pre_metric:PreMetric;
  limit:number;
}

type Row=Record<string,any>;
type EvidenceCard={id:string;title:string;kind:string;facts:string[];href?:string|null};

const MODEL='@cf/meta/llama-3.1-8b-instruct-fast';
const RATING_MODEL='CageMetrix Opponent-Adjusted Rating';
const JSON_HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const SPECIAL_RE=/\b(prospects?|regional|outside (?:the )?ufc|undefeated|similar|resembles?|lookalikes?|pre[- ]ufc|before (?:joining|entering) (?:the )?ufc|regional (?:resume|résumé)|under \d{2})\b/i;
const VECTOR_FIELDS=['striking_offense','striking_defense','wrestling_offense','wrestling_defense','grappling','pace','finishing','strength_of_schedule'] as const;

function json(data:unknown,status=200,extra:Record<string,string>={}){
  return new Response(JSON.stringify(data,null,2),{status,headers:{...JSON_HEADERS,...extra}});
}
function clamp(n:unknown,min:number,max:number,fallback:number){const v=Number(n);return Number.isFinite(v)?Math.max(min,Math.min(max,Math.trunc(v))):fallback;}
function cookie(request:Request,name:string){return (request.headers.get('cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(`${name}=`))?.slice(name.length+1)||'';}
async function hash(value:string){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');}
function sameOrigin(request:Request){const origin=request.headers.get('origin');return !origin||origin===new URL(request.url).origin;}
function ageFromDob(dob:unknown){
  if(typeof dob!=='string'||!/^\d{4}-\d{2}-\d{2}/.test(dob))return null;
  const born=new Date(`${dob.slice(0,10)}T00:00:00Z`);if(!Number.isFinite(born.getTime()))return null;
  const now=new Date();let age=now.getUTCFullYear()-born.getUTCFullYear();
  if(now.getUTCMonth()<born.getUTCMonth()||(now.getUTCMonth()===born.getUTCMonth()&&now.getUTCDate()<born.getUTCDate()))age--;
  return age;
}
function slugify(value:string){return value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');}
function extractAi(value:unknown):any{const candidate=(value as any)?.response??value;if(typeof candidate==='string'){try{return JSON.parse(candidate)}catch{return candidate}}return candidate;}
function normalizedDivision(value:unknown){
  const v=String(value||'').trim().toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ');
  const aliases:Record<string,string>={
    heavyweight:'Heavyweight','light heavyweight':'Light Heavyweight',middleweight:'Middleweight',welterweight:'Welterweight',lightweight:'Lightweight',featherweight:'Featherweight',bantamweight:'Bantamweight',flyweight:'Flyweight',
    "women's bantamweight":"Women's Bantamweight",'womens bantamweight':"Women's Bantamweight","women's flyweight":"Women's Flyweight",'womens flyweight':"Women's Flyweight","women's strawweight":"Women's Strawweight",'womens strawweight':"Women's Strawweight",strawweight:"Women's Strawweight"
  };
  return aliases[v]||'';
}
function fallbackPlan(question:string):ExtendedPlan{
  const lower=question.toLowerCase();
  const ageMatch=lower.match(/under\s+(\d{2})/);const minWinMatch=lower.match(/(?:at least|min(?:imum)?(?: of)?)\s+(\d+)\s+wins?/);
  let intent:ExtendedIntent='legacy';
  if(/similar|resembl|lookalike/.test(lower))intent='similar_fighters';
  else if(/pre[- ]ufc|before .*ufc|regional (?:resume|résumé)/.test(lower))intent='pre_ufc_rankings';
  else if(/prospect|regional|outside .*ufc|undefeated|under\s+\d{2}/.test(lower))intent='prospect_search';
  const division=['light heavyweight','heavyweight','middleweight','welterweight','lightweight','featherweight','bantamweight','flyweight','strawweight'].find(d=>lower.includes(d))||'';
  const named=question.match(/(?:similar to|resembles?|like)\s+([A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]+){1,3})/);
  return {intent,fighter:named?.[1]||'',division:normalizedDivision(division),age_under:ageMatch?Number(ageMatch[1]):0,min_wins:minWinMatch?Number(minWinMatch[1]):0,undefeated:/undefeated/.test(lower),outside_ufc:/regional|outside .*ufc/.test(lower),recent_days:1095,pre_metric:/major/.test(lower)?'major_org_bouts':/finish/.test(lower)?'finishes':/wins?/.test(lower)?'wins':'resume',limit:5};
}
async function extendedPlan(question:string,env:Env):Promise<ExtendedPlan>{
  const fallback=fallbackPlan(question);if(!env.AI)return fallback;
  try{
    const result=await env.AI.run(MODEL,{messages:[
      {role:'system',content:'You are the MMA Scouts query planner for advanced research. Classify only these advanced intents: prospect_search for regional/prospect discovery or age/undefeated filters; similar_fighters for statistical similarity to one named UFC fighter; pre_ufc_rankings for comparing UFC fighters by documented pre-UFC history; legacy for everything else. Never invent fighter names. age_under is 0 when unspecified. division is empty when unspecified. outside_ufc is true when the user wants regional/non-UFC fighters. pre_metric must reflect what the user explicitly asks for; use resume for broad pre-UFC résumé questions.'},
      {role:'user',content:question}
    ],temperature:0,max_tokens:240,response_format:{type:'json_schema',json_schema:{type:'object',properties:{intent:{type:'string',enum:['prospect_search','similar_fighters','pre_ufc_rankings','legacy']},fighter:{type:'string'},division:{type:'string'},age_under:{type:'integer',minimum:0,maximum:60},min_wins:{type:'integer',minimum:0,maximum:100},undefeated:{type:'boolean'},outside_ufc:{type:'boolean'},recent_days:{type:'integer',minimum:90,maximum:3650},pre_metric:{type:'string',enum:['resume','wins','major_org_bouts','finishes','bouts']},limit:{type:'integer',minimum:1,maximum:10}},required:['intent','fighter','division','age_under','min_wins','undefeated','outside_ufc','recent_days','pre_metric','limit']}}});
    const p=extractAi(result);if(!p||typeof p!=='object')return fallback;
    return {intent:['prospect_search','similar_fighters','pre_ufc_rankings','legacy'].includes(p.intent)?p.intent:fallback.intent,fighter:String(p.fighter||'').trim(),division:normalizedDivision(p.division)||fallback.division,age_under:clamp(p.age_under,0,60,fallback.age_under),min_wins:clamp(p.min_wins,0,100,fallback.min_wins),undefeated:Boolean(p.undefeated),outside_ufc:Boolean(p.outside_ufc),recent_days:clamp(p.recent_days,90,3650,1095),pre_metric:['resume','wins','major_org_bouts','finishes','bouts'].includes(p.pre_metric)?p.pre_metric:'resume',limit:clamp(p.limit,1,10,5)};
  }catch(error){console.error('Scout AI 0.2 planner failed',error);return fallback;}
}

async function actorKey(request:Request){
  const session=cookie(request,'cm_session');const fan=cookie(request,'cm_fan_id');
  const raw=session?`session:${session}`:fan?`fan:${fan}`:`ip:${request.headers.get('cf-connecting-ip')||request.headers.get('user-agent')||'unknown'}`;
  return `scout:${(await hash(raw)).slice(0,32)}`;
}
async function enforceRateLimit(request:Request,env:Env){
  const key=await actorKey(request);
  if(env.SCOUT_BURST_LIMITER){const r=await env.SCOUT_BURST_LIMITER.limit({key});if(!r.success)return json({error:'rate_limited',message:'Scout AI is receiving too many questions from this session. Try again shortly.'},429,{'retry-after':'10'});}
  if(env.SCOUT_MINUTE_LIMITER){const r=await env.SCOUT_MINUTE_LIMITER.limit({key});if(!r.success)return json({error:'rate_limited',message:'Scout AI minute limit reached. Try again in about a minute.'},429,{'retry-after':'60'});}
  return null;
}

async function resolveNativeFighter(name:string,env:Env){
  const clean=String(name||'').trim();if(!clean)return null;const slug=slugify(clean);
  const exact=await env.DB.prepare(`SELECT id,slug,name,dob,current_weight_class,active,ufc_bouts FROM fighters WHERE lower(name)=lower(?1) OR slug=?2 ORDER BY active DESC,ufc_bouts DESC LIMIT 1`).bind(clean,slug).first<Row>();
  if(exact)return exact;
  return env.DB.prepare(`SELECT id,slug,name,dob,current_weight_class,active,ufc_bouts FROM fighters WHERE lower(name) LIKE lower(?1) ORDER BY active DESC,ufc_bouts DESC,name COLLATE NOCASE LIMIT 1`).bind(`%${clean}%`).first<Row>();
}

async function prospectEvidence(plan:ExtendedPlan,env:Env){
  const clauses=[`s.last_fight_date>=DATE('now',?1)`];const binds:any[]=[`-${plan.recent_days} days`];
  if(plan.division){binds.push(plan.division);clauses.push(`lower(COALESCE(s.last_weight_class,''))=lower(?${binds.length})`);}
  if(plan.min_wins){binds.push(plan.min_wins);clauses.push(`s.career_wins>=?${binds.length}`);}
  if(plan.undefeated)clauses.push('s.career_losses=0');
  if(plan.outside_ufc)clauses.push(`NOT EXISTS (SELECT 1 FROM mma_identity_links l JOIN fighters nf ON nf.id=CAST(l.cagemetrix_fighter_id AS INTEGER) WHERE l.source_key=s.source_key AND l.source_fighter_id=s.source_fighter_id AND l.confidence>=0.90 AND nf.active=1)`);
  const rows=await env.DB.prepare(`SELECT s.* FROM scout_fighter_index s WHERE ${clauses.join(' AND ')} ORDER BY s.recent_wins_730d DESC,s.career_wins DESC,s.career_major_org_bouts DESC,s.last_fight_date DESC LIMIT 200`).bind(...binds).all<Row>();
  const filtered=(rows.results||[]).map(r=>({...r,age:ageFromDob(r.dob)})).filter(r=>!plan.age_under||(r.age!==null&&r.age<plan.age_under)).slice(0,plan.limit);
  const cards:EvidenceCard[]=filtered.map((r,i)=>({id:`E${i+1}`,title:r.fighter_name,kind:'regional_fighter',facts:[`${r.career_wins}-${r.career_losses}-${r.career_draws} in ${r.career_bouts} recorded bouts`,`${r.career_finishes} recorded wins by non-decision finish`,`${r.recent_wins_730d} wins in the last 730 days of indexed data`,r.age===null?'Age unavailable':`Age ${r.age}`,`Last recorded fight: ${r.last_fight_date||'unknown'} · ${r.last_organization||'organization unknown'} · ${r.last_weight_class||'weight class unknown'}`] }));
  return {kind:'prospect_search',rows:filtered,evidence:cards,sources:[]};
}

async function similarEvidence(plan:ExtendedPlan,env:Env){
  const fighter=await resolveNativeFighter(plan.fighter,env);if(!fighter)return {error:plan.fighter?`I could not match “${plan.fighter}” to a UFC fighter in the current database.`:'Name the fighter you want Scout AI to find statistical comparisons for.'};
  const target=await env.DB.prepare(`SELECT rh.* FROM ratings_history rh JOIN model_versions mv ON mv.id=rh.model_version_id WHERE rh.fighter_id=?1 AND mv.name=?2 AND mv.version=?3 ORDER BY rh.as_of_date DESC,rh.id DESC LIMIT 1`).bind(fighter.id,RATING_MODEL,env.MODEL_VERSION).first<Row>();
  if(!target)return {error:`${fighter.name} does not have a current Scout rating vector yet.`};
  const rows=await env.DB.prepare(`SELECT f.id,f.slug,f.name,f.current_weight_class,rh.cmr,rh.striking_offense,rh.striking_defense,rh.wrestling_offense,rh.wrestling_defense,rh.grappling,rh.pace,rh.finishing,rh.strength_of_schedule FROM fighters f JOIN ratings_history rh ON rh.fighter_id=f.id JOIN model_versions mv ON mv.id=rh.model_version_id WHERE f.active=1 AND f.id<>?1 AND f.current_weight_class=?2 AND mv.name=?3 AND mv.version=?4 AND rh.id=(SELECT x.id FROM ratings_history x WHERE x.fighter_id=rh.fighter_id AND x.model_version_id=rh.model_version_id ORDER BY x.as_of_date DESC,x.id DESC LIMIT 1) LIMIT 120`).bind(fighter.id,fighter.current_weight_class,RATING_MODEL,env.MODEL_VERSION).all<Row>();
  const scored=(rows.results||[]).map(r=>{let total=0,n=0;for(const field of VECTOR_FIELDS){const a=Number(target[field]),b=Number(r[field]);if(Number.isFinite(a)&&Number.isFinite(b)){total+=Math.abs(a-b);n++;}}return {...r,shared_metrics:n,similarity:n?Math.max(0,Math.round((100-total/n)*10)/10):0};}).filter(r=>r.shared_metrics>=5).sort((a,b)=>b.similarity-a.similarity).slice(0,plan.limit);
  const cards:EvidenceCard[]=[{id:'E0',title:fighter.name,kind:'target_fighter',href:`/fighters/${fighter.slug}`,facts:[`Scout Rating ${Number(target.cmr).toFixed(1)}`,`Division: ${fighter.current_weight_class||'unknown'}`]}];
  for(const [i,r] of scored.entries())cards.push({id:`E${i+1}`,title:r.name,kind:'similar_fighter',href:`/fighters/${r.slug}`,facts:[`${r.similarity}% rating-profile similarity across ${r.shared_metrics} shared Scout metrics`,`Scout Rating ${Number(r.cmr).toFixed(1)}`,`Division: ${r.current_weight_class}`]});
  return {kind:'similar_fighters',target:fighter,rows:scored,evidence:cards,sources:cards.filter(c=>c.href).map(c=>({label:c.title,href:c.href}))};
}

async function preUfcEvidence(plan:ExtendedPlan,env:Env){
  const order:Record<PreMetric,string>={resume:'h.pre_ufc_major_org_bouts DESC,h.pre_ufc_wins DESC,h.pre_ufc_finishes DESC,h.pre_ufc_bouts DESC',wins:'h.pre_ufc_wins DESC,h.pre_ufc_major_org_bouts DESC',major_org_bouts:'h.pre_ufc_major_org_bouts DESC,h.pre_ufc_wins DESC',finishes:'h.pre_ufc_finishes DESC,h.pre_ufc_wins DESC',bouts:'h.pre_ufc_bouts DESC,h.pre_ufc_wins DESC'};
  const clauses=['f.active=1','h.pre_ufc_bouts>0'];const binds:any[]=[];if(plan.division){binds.push(plan.division);clauses.push(`f.current_weight_class=?${binds.length}`);}binds.push(plan.limit);
  const rows=await env.DB.prepare(`SELECT f.slug,f.name,f.current_weight_class,h.first_ufc_date,h.pre_ufc_bouts,h.pre_ufc_wins,h.pre_ufc_losses,h.pre_ufc_draws,h.pre_ufc_finishes,h.pre_ufc_ko_tko_wins,h.pre_ufc_submission_wins,h.pre_ufc_decision_wins,h.pre_ufc_major_org_bouts,h.pre_ufc_distinct_opponents FROM ufc_fighter_history_summary h JOIN fighters f ON f.id=h.fighter_id WHERE ${clauses.join(' AND ')} ORDER BY ${order[plan.pre_metric]} LIMIT ?${binds.length}`).bind(...binds).all<Row>();
  const cards:EvidenceCard[]=(rows.results||[]).map((r,i)=>({id:`E${i+1}`,title:r.name,kind:'pre_ufc_history',href:`/fighters/${r.slug}`,facts:[`${r.pre_ufc_wins}-${r.pre_ufc_losses}-${r.pre_ufc_draws} across ${r.pre_ufc_bouts} documented pre-UFC bouts`,`${r.pre_ufc_major_org_bouts} major-organization bouts before UFC debut`,`${r.pre_ufc_finishes} pre-UFC finishes`,`${r.pre_ufc_distinct_opponents} distinct documented pre-UFC opponents`,`UFC debut date in current data: ${r.first_ufc_date||'unknown'}`]}));
  return {kind:'pre_ufc_rankings',metric:plan.pre_metric,rows:rows.results||[],evidence:cards,sources:cards.map(c=>({label:c.title,href:c.href}))};
}

function validCitationAnswer(answer:string,cards:EvidenceCard[]){const ids=new Set(cards.map(c=>c.id));return String(answer||'').replace(/\[(E\d+)\]/g,(all,id)=>ids.has(id)?all:'').replace(/\s{2,}/g,' ').trim();}
async function synthesize(question:string,data:any,env:Env){
  const cards:EvidenceCard[]=data.evidence||[];
  if(!env.AI)return {answer:`Scout AI retrieved ${cards.length} evidence records for this question, but natural-language synthesis is unavailable in this environment.`,confidence:'low',caveats:['Review the evidence cards directly.']};
  const result=await env.AI.run(MODEL,{messages:[
    {role:'system',content:'You are Scout AI for MMA Scouts. Answer ONLY from the supplied evidence cards and structured rows. Never invent a fighter, fight, age, record, organization, metric, or conclusion that the evidence does not support. Cite factual claims with evidence IDs like [E1]. Do not cite an ID that is not supplied. For prospect searches, call results candidates or indexed prospects rather than claiming they will reach the UFC. For similarity, explain that similarity is based on the site rating profile, not identical fighting style. For broad pre-UFC résumé questions, explicitly say the ordering is based on documented counts and major-organization exposure rather than a complete opponent-quality model. Avoid betting advice. Keep the answer concise.'},
    {role:'user',content:`Question: ${question}\n\nResearch payload:\n${JSON.stringify(data)}`}
  ],temperature:0.15,max_tokens:700,response_format:{type:'json_schema',json_schema:{type:'object',properties:{answer:{type:'string'},confidence:{type:'string',enum:['high','medium','low']},caveats:{type:'array',items:{type:'string'},maxItems:4}},required:['answer','confidence','caveats']}}});
  const out=extractAi(result);if(out&&typeof out==='object'&&typeof out.answer==='string')return {...out,answer:validCitationAnswer(out.answer,cards)};
  return {answer:typeof out==='string'?validCitationAnswer(out,cards):'Scout AI could not format an answer from the retrieved evidence.',confidence:'low',caveats:['The evidence was retrieved, but synthesis was incomplete.']};
}

async function specialAnswer(question:string,plan:ExtendedPlan,env:Env){
  let data:any;if(plan.intent==='prospect_search')data=await prospectEvidence(plan,env);else if(plan.intent==='similar_fighters')data=await similarEvidence(plan,env);else if(plan.intent==='pre_ufc_rankings')data=await preUfcEvidence(plan,env);else return null;
  if(data?.error)return json({question,answer:data.error,confidence:'low',caveats:[],sources:[],evidence:[],meta:{intent:plan.intent,preview:true,version:'0.2'}});
  const answer=await synthesize(question,data,env);
  return json({question,...answer,sources:data.sources||[],evidence:data.evidence||[],meta:{intent:plan.intent,division:plan.division||null,preview:true,version:'0.2',evidence_kind:data.kind,model:env.AI?MODEL:null}});
}

export async function scoutAskV02(request:Request,env:Env):Promise<Response>{
  if(request.method!=='POST')return json({error:'method_not_allowed'},405);
  if(!sameOrigin(request))return json({error:'cross_origin_forbidden',message:'Scout AI only accepts same-origin browser requests.'},403);
  const limited=await enforceRateLimit(request,env);if(limited)return limited;

  let payload:any;try{payload=await request.clone().json()}catch{return json({error:'invalid_json'},400)}
  const question=String(payload?.question||'').replace(/\s+/g,' ').trim();
  if(question.length<3||question.length>500)return legacyScoutAsk(request,env);
  if(!SPECIAL_RE.test(question))return legacyScoutAsk(request,env);

  const plan=await extendedPlan(question,env);
  if(plan.intent==='legacy')return legacyScoutAsk(request,env);
  try{return await specialAnswer(question,plan,env) as Response}catch(error){console.error('Scout AI 0.2 research failed',error);return json({error:'scout_research_unavailable',message:'Scout AI could not complete that research query.'},503)}
}
