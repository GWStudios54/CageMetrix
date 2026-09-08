import {adminAccount,sameOrigin,sha256Hex} from './admin-session.ts';
import {BRAND_NAME,SITE_ORIGIN} from './brand.ts';

type Env={DB:D1Database};
type Row=Record<string,any>;
const JSON_HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]!));
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:JSON_HEADERS});
const validEmail=(value:string)=>/^[^\s@]{1,120}@[^\s@]{1,190}\.[^\s@]{2,80}$/.test(value);
const validHttps=(value:string)=>{if(!value)return null;try{const url=new URL(value);return url.protocol==='https:'?url.href:null;}catch{return null;}};

function shell(title:string,description:string,path:string,body:string,robots='index,follow'){
  const url=`${SITE_ORIGIN}${path}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta name="description" content="${esc(description)}"><link rel="canonical" href="${esc(url)}"><meta name="robots" content="${robots}"><link rel="icon" href="/logo.svg" type="image/svg+xml"><link rel="stylesheet" href="/styles.css"><style>.policy-main{max-width:940px;margin:0 auto;padding:96px 22px 64px}.policy-hero{margin-bottom:36px}.policy-hero h1{font-size:clamp(2.3rem,7vw,4.7rem);line-height:.96;margin:.25rem 0 1rem}.policy-hero p,.policy-card p,.policy-card li{line-height:1.7;color:var(--muted,#9aa5b1)}.policy-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.policy-card{border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:24px;background:rgba(255,255,255,.025)}.policy-card h2{margin-top:0}.policy-card ul{padding-left:1.2rem}.policy-callout{border-left:4px solid currentColor;padding:12px 16px;margin:20px 0;background:rgba(255,255,255,.035)}.removal-form{display:grid;gap:16px}.removal-form label{display:grid;gap:7px;font-weight:700}.removal-form input,.removal-form select,.removal-form textarea{width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:#111820;color:inherit}.removal-form textarea{min-height:130px}.removal-form .check{display:flex;align-items:flex-start;gap:10px;font-weight:500}.removal-form .check input{width:auto;margin-top:4px}.privacy-links{display:flex;gap:14px;flex-wrap:wrap;margin-top:24px}.privacy-links a{text-decoration:underline}@media(max-width:760px){.policy-grid{grid-template-columns:1fr}.policy-main{padding-top:76px}}</style></head><body><header class="topbar"><a class="brand" href="/" aria-label="${BRAND_NAME} home"><img class="brand-mark" src="/logo.svg" alt="" width="44" height="44"><span>${BRAND_NAME}</span></a></header><main class="policy-main">${body}</main><footer><span>${BRAND_NAME}</span><span>The MMA research engine.</span></footer></body></html>`;
}

export function dataPolicyPage(){
  const body=`<section class="policy-hero"><span class="eyebrow">DATA &amp; SOURCING POLICY</span><h1>Professional scouting data, with hard boundaries.</h1><p>MMA Scouts compiles professional MMA information from public and authorized sources. We preserve provenance, distinguish verified facts from unknowns, and do not publish private personal contact or residential information.</p></section>
  <div class="policy-grid"><section class="policy-card"><h2>What we collect</h2><ul><li>Fight records, results, event history and opponent context.</li><li>Public professional biography fields such as age, nationality, height, reach and stance.</li><li>Publicly identified team, gym, coach, promotion and management relationships.</li><li>Public professional opportunity information when the fighter or an authorized source explicitly states it.</li><li>Public career changes and professional contact pages represented as HTTPS links.</li></ul></section>
  <section class="policy-card"><h2>What we do not publish</h2><ul><li>Phone numbers.</li><li>Street addresses, home addresses or exact residential locations.</li><li>Private email addresses or private messaging details.</li><li>Inferred free-agent, unmanaged, available, injured or contract claims based only on silence or missing data.</li><li>Private information obtained by bypassing access controls, logins, CAPTCHAs or other technical restrictions.</li></ul></section>
  <section class="policy-card"><h2>Source hierarchy</h2><p>Verified fighter submissions and official management, promotion, team, commission and fighter sources receive the highest evidentiary weight. Credible reporting may supplement primary sources. Every external intel fact is designed to carry provenance, confidence and a verification date.</p><p>Promotion or management prestige never adds points to Global Rating or Scout Score.</p></section>
  <section class="policy-card"><h2>Corrections and removals</h2><p>We correct inaccurate professional information when reliable evidence is provided. Fighters may request that their public MMA Scouts profile be removed. An authorized representative may submit the request on the fighter's behalf.</p><p>An agency, manager, promotion or other third party does not automatically control whether an independently sourced fighter profile exists unless it is legally authorized to act for the fighter or removal is otherwise legally required.</p></section></div>
  <div class="policy-callout"><strong>Source-access objections are separate from fighter-profile removal.</strong> A legal or access notice concerning a particular website can pause collection from that source without requiring deletion of independently sourced professional facts.</div>
  <div class="privacy-links"><a href="/profile-removal">Request fighter profile removal</a><a href="/privacy">Privacy policy</a></div>`;
  return new Response(shell(`Data & Sourcing Policy | ${BRAND_NAME}`,'How MMA Scouts sources professional fighter intelligence, protects private information, handles corrections, and honors fighter profile-removal requests.','/data-policy',body),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'public, max-age=300, s-maxage=3600'}});
}

export function privacyPage(){
  const body=`<section class="policy-hero"><span class="eyebrow">PRIVACY POLICY</span><h1>Collect less. Publish less. Keep the scouting useful.</h1><p>MMA Scouts is built around professional MMA research, not personal-data aggregation.</p></section>
  <div class="policy-grid"><section class="policy-card"><h2>Public fighter information</h2><p>Public profiles may include professional career facts and professional context from public or authorized sources. We do not publish phone numbers, street/home addresses, exact residential locations, or private email addresses.</p></section>
  <section class="policy-card"><h2>Removal requests</h2><p>A fighter or authorized representative may submit a profile-removal request. The verification contact email supplied with that request is stored privately for request handling, is never displayed on the fighter profile, and is not used as a scouting-data source.</p></section>
  <section class="policy-card"><h2>Unknown means unknown</h2><p>When management, contract, availability, team or location evidence is missing, MMA Scouts reports it as unknown rather than inferring a potentially harmful professional claim.</p></section>
  <section class="policy-card"><h2>Data retention</h2><p>Approved publication removals suppress the fighter from public MMA Scouts surfaces. Internal integrity records may be retained as necessary to preserve audit history, prevent accidental republication, maintain the fight graph and comply with legal obligations.</p></section></div>
  <div class="privacy-links"><a href="/profile-removal">Request fighter profile removal</a><a href="/data-policy">Data & sourcing policy</a></div>`;
  return new Response(shell(`Privacy Policy | ${BRAND_NAME}`,'MMA Scouts privacy policy for professional fighter data and profile-removal requests.','/privacy',body),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'public, max-age=300, s-maxage=3600'}});
}

export function profileRemovalPage(request:Request){
  const profile=(new URL(request.url).searchParams.get('profile')||'').trim().slice(0,180);
  const body=`<section class="policy-hero"><span class="eyebrow">FIGHTER CONTROL</span><h1>Request removal of your fighter profile.</h1><p>Fighters can ask MMA Scouts to remove their public scouting profile. We verify the request before suppression so another person cannot remove a fighter's profile without authority.</p></section>
  <section class="policy-card"><form class="removal-form" method="post" action="/api/profile-removal"><label>Profile slug or MMA Scouts profile URL<input name="profile" required value="${esc(profile)}" placeholder="scout/fighters/example-fighter"></label><label>Fighter name<input name="fighter_name" required maxlength="160"></label><label>You are<select name="requester_role" required><option value="fighter">The fighter</option><option value="authorized_representative">Authorized representative of the fighter</option></select></label><label>Your name<input name="requester_name" required maxlength="160"></label><label>Private verification email<input name="contact_email" type="email" required maxlength="240" autocomplete="email"><small>This is used only to verify/process the request and is never published on the fighter profile.</small></label><label>Public verification URL (optional)<input name="verification_url" type="url" maxlength="500" placeholder="https://official-fighter-or-agency-page.example/"></label><label>Reason or verification notes (optional)<textarea name="reason" maxlength="1200" placeholder="Anything that helps us verify the request."></textarea></label><input name="company" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px"><label class="check"><input type="checkbox" name="attested" value="1" required><span>I attest that I am the fighter or am authorized by the fighter to make this request.</span></label><button class="button primary" type="submit">Submit removal request</button></form></section>
  <div class="policy-callout">Managers and agencies may request corrections, but an agency relationship alone does not authorize removal of a fighter's profile. A representative submitting removal must be authorized by the fighter.</div><div class="privacy-links"><a href="/data-policy">Data & sourcing policy</a><a href="/privacy">Privacy policy</a></div>`;
  return new Response(shell(`Fighter Profile Removal | ${BRAND_NAME}`,'Request removal of a fighter profile from MMA Scouts public surfaces.','/profile-removal',body,'noindex,follow'),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
}

async function inputObject(request:Request){
  const type=request.headers.get('content-type')||'';
  if(type.includes('application/json'))return await request.json() as Record<string,unknown>;
  const form=await request.formData(),out:Record<string,unknown>={};for(const [key,value] of form.entries())if(typeof value==='string')out[key]=value;return out;
}

function normalizeProfile(value:unknown){
  const raw=String(value||'').trim();
  if(!raw)return '';
  try{const url=new URL(raw);return url.pathname.split('/').filter(Boolean).at(-1)?.toLowerCase()||'';}catch{return raw.split('?')[0].split('#')[0].split('/').filter(Boolean).at(-1)?.toLowerCase()||'';}
}

export async function profileRemovalApi(request:Request,env:Env){
  if(request.method!=='POST')return json({error:'method_not_allowed'},405);
  if(!sameOrigin(request))return json({error:'origin_not_allowed'},403);
  let input:Record<string,unknown>;try{input=await inputObject(request);}catch{return json({error:'invalid_request'},400);}
  if(String(input.company||'').trim())return json({ok:true,status:'received'},202);
  const profileSlug=normalizeProfile(input.profile),fighterName=String(input.fighter_name||'').trim().slice(0,160),role=String(input.requester_role||'').trim(),requesterName=String(input.requester_name||'').trim().slice(0,160),email=String(input.contact_email||'').trim().toLowerCase().slice(0,240),reason=String(input.reason||'').trim().slice(0,1200),verificationRaw=String(input.verification_url||'').trim().slice(0,500),verificationUrl=verificationRaw?validHttps(verificationRaw):null,attested=String(input.attested||'')==='1'||input.attested===true;
  if(!/^[a-z0-9-]{1,180}$/.test(profileSlug)||!fighterName||!requesterName||!['fighter','authorized_representative'].includes(role)||!validEmail(email)||!attested)return json({error:'invalid_request',message:'Complete the required fighter, authority, email, and attestation fields.'},400);
  if(verificationRaw&&!verificationUrl)return json({error:'invalid_verification_url',message:'Verification links must use HTTPS.'},400);
  const fighter=await env.DB.prepare(`SELECT source_key,source_fighter_id,profile_slug,fighter_name FROM scout_active_global_profiles WHERE profile_slug=? LIMIT 1`).bind(profileSlug).first<Row>();
  if(!fighter)return json({error:'fighter_not_found',message:'We could not match that profile slug.'},404);
  const actor=`${request.headers.get('cf-connecting-ip')||'unknown'}|${request.headers.get('user-agent')||'unknown'}`;
  const abuseHash=await sha256Hex(actor);
  const recent=await env.DB.prepare(`SELECT COUNT(*) count FROM fighter_profile_removal_requests WHERE abuse_key_hash=? AND created_at>=datetime('now','-24 hours')`).bind(abuseHash).first<{count:number}>();
  if(Number(recent?.count||0)>=5)return json({error:'rate_limited',message:'Too many removal requests from this client. Try again later.'},429);
  const existing=await env.DB.prepare(`SELECT id,status FROM fighter_profile_removal_requests WHERE profile_slug=? AND status='pending' ORDER BY created_at DESC LIMIT 1`).bind(profileSlug).first<Row>();
  if(existing)return json({ok:true,status:'pending',request_id:existing.id,message:'A removal request for this profile is already pending review.'},202);
  const result=await env.DB.prepare(`INSERT INTO fighter_profile_removal_requests(profile_slug,source_key,source_fighter_id,fighter_name,requester_role,requester_name,contact_email,verification_url,reason,attested,status,abuse_key_hash) VALUES(?,?,?,?,?,?,?,?,?,1,'pending',?) RETURNING id`).bind(fighter.profile_slug,fighter.source_key,fighter.source_fighter_id,fighterName,role,requesterName,email,verificationUrl,reason||null,abuseHash).first<{id:number}>();
  const accepts=request.headers.get('accept')||'';
  if(!accepts.includes('application/json')){
    const body=`<section class="policy-hero"><span class="eyebrow">REQUEST RECEIVED</span><h1>We have your removal request.</h1><p>Request #${Number(result?.id||0)} is pending verification. Once approved, the fighter will be suppressed from public fighter, prospect, talent, management-roster and sitemap surfaces while internal audit/integrity records may remain.</p></section><div class="privacy-links"><a href="/">Return to MMA Scouts</a><a href="/privacy">Privacy policy</a></div>`;
    return new Response(shell(`Removal Request Received | ${BRAND_NAME}`,'Your fighter profile-removal request was received.','/profile-removal',body,'noindex,nofollow'),{status:202,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
  }
  return json({ok:true,status:'pending',request_id:result?.id||null,message:'Request received and pending verification.'},202);
}

export async function profileRemovalAdminApi(request:Request,env:Env){
  const admin=await adminAccount(request,env.DB);if(!admin)return json({error:'admin_required'},403);
  if(request.method==='GET'){
    const rows=await env.DB.prepare(`SELECT id,profile_slug,fighter_name,requester_role,requester_name,contact_email,verification_url,reason,status,created_at,reviewed_at,reviewed_by,review_notes FROM fighter_profile_removal_requests ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END,created_at DESC LIMIT 250`).all<Row>();
    return json({data:rows.results||[]});
  }
  if(request.method!=='POST'||!sameOrigin(request))return json({error:'method_not_allowed'},405);
  let input:Record<string,unknown>;try{input=await inputObject(request);}catch{return json({error:'invalid_request'},400);}
  const id=Number(input.id),action=String(input.action||''),notes=String(input.notes||'').trim().slice(0,2000);
  if(!Number.isInteger(id)||id<1||!['approve','reject'].includes(action))return json({error:'invalid_request'},400);
  const row=await env.DB.prepare(`SELECT * FROM fighter_profile_removal_requests WHERE id=? LIMIT 1`).bind(id).first<Row>();if(!row)return json({error:'request_not_found'},404);
  if(row.status!=='pending')return json({error:'request_already_reviewed',status:row.status},409);
  if(action==='approve'){
    const basis=row.requester_role==='fighter'?'fighter_request':'authorized_representative';
    await env.DB.prepare(`INSERT INTO fighter_publication_controls(source_key,source_fighter_id,profile_slug_snapshot,public_status,basis,removal_request_id,reason,effective_at,updated_at) VALUES(?,?,?,'removed',?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(source_key,source_fighter_id) DO UPDATE SET profile_slug_snapshot=excluded.profile_slug_snapshot,public_status='removed',basis=excluded.basis,removal_request_id=excluded.removal_request_id,reason=excluded.reason,effective_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`).bind(row.source_key,row.source_fighter_id,row.profile_slug,basis,row.id,notes||row.reason||null).run();
    await env.DB.prepare(`UPDATE fighter_profile_removal_requests SET status='approved',reviewed_at=CURRENT_TIMESTAMP,reviewed_by=?,review_notes=? WHERE id=?`).bind(String(admin.handle||admin.id),notes||null,id).run();
    return json({ok:true,status:'approved',profile_slug:row.profile_slug});
  }
  await env.DB.prepare(`UPDATE fighter_profile_removal_requests SET status='rejected',reviewed_at=CURRENT_TIMESTAMP,reviewed_by=?,review_notes=? WHERE id=?`).bind(String(admin.handle||admin.id),notes||null,id).run();
  return json({ok:true,status:'rejected',profile_slug:row.profile_slug});
}
