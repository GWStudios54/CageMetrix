import {adminAccount} from './admin-session.ts';
import {BRAND_NAME} from './brand.ts';

type Env={DB:D1Database};
type Row=Record<string,any>;
const REVIEW=new Set(['pending','accepted','rejected','duplicate','needs_identity']);
const esc=(value:unknown)=>String(value??'').replace(/[&<>\"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[ch]||ch));
const label=(value:unknown)=>String(value||'unknown').replaceAll('_',' ').replace(/\\b\\w/g,ch=>ch.toUpperCase());
const reviewStatus=(value:string|null)=>REVIEW.has(value||'')?value!:'pending';

function shell(body:string,script=''){
  return `<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"robots\" content=\"noindex,nofollow\"><title>Contract Review | ${BRAND_NAME}</title><link rel=\"icon\" href=\"/logo.svg\" type=\"image/svg+xml\"><link rel=\"stylesheet\" href=\"/styles.css\"><link rel=\"stylesheet\" href=\"/recruiting.css?v=3\"></head><body><header class=\"topbar\"><a class=\"brand\" href=\"/\"><img class=\"brand-mark\" src=\"/logo.svg\" alt=\"\" width=\"44\" height=\"44\"><span>${BRAND_NAME}</span></a></header><main class=\"recruit-main\">${body}</main><footer><span>${BRAND_NAME}</span><span>Private contract intelligence review.</span></footer>${script}</body></html>`;
}

function authPage(){
  return new Response(shell('<section class=\"recruit-hero\"><span class=\"eyebrow\">PRIVATE WORKSPACE</span><h1>Contract review access required.</h1><p>This queue contains unpublished intelligence leads and is restricted to authorized MMA Scouts users.</p><a class=\"button primary\" href=\"/admin\">Admin sign in →</a></section>'),{status:403,headers:{'content-type':'text/html; charset=utf-8','cache-control':'private, no-store','x-robots-tag':'noindex,nofollow'}});
}
const EVENT_TYPES=['signing','extension','renewal','renegotiation','bout_agreement','option_exercised','option_declined','release','expiration','free_agency','status_update','other'];
const STATUSES=['unknown','under_contract','non_exclusive','free_agent','released','expired'];
const SOURCE_TYPES=['fighter_direct','manager_or_agency_direct','promotion_direct','athletic_commission_record','court_record','verified_public_filing','reputable_trade_reporting','reputable_interview','secondary_reporting_with_attribution','archived_public_statement'];
const AGREEMENTS=['unknown','multi_fight','single_fight','developmental','exclusive','non_exclusive','tournament','short_notice','replacement'];

function options(values:string[],selected:string){
  return values.map(v=>`<option value=\"${esc(v)}\"${v===selected?' selected':''}>${esc(label(v))}</option>`).join('');
}

function card(row:Row){
  const noIdentity=!row.profile_slug||row.review_status==='needs_identity';
  const eventType=String(row.detected_event_type||'status_update');
  const statusAfter=String(row.detected_status||'unknown');
  const sourceType=String(row.source_type||'reputable_trade_reporting');
  const summary=String(row.detected_summary||row.source_title||'').slice(0,1800);
  const published=String(row.published_at||'').slice(0,40);
  const identity=noIdentity?'<strong>Identity unresolved — do not publish.</strong>':`<a href=\"/scout/fighters/${esc(row.profile_slug)}\">Open fighter dossier →</a>`;
  const publish=noIdentity?'':`
    <form class=\"contract-publish-form\" data-contract-publish>
      <input type=\"hidden\" name=\"profile_slug\" value=\"${esc(row.profile_slug)}\">
      <input type=\"hidden\" name=\"source_url\" value=\"${esc(row.source_url)}\">
      <input type=\"hidden\" name=\"source_title\" value=\"${esc(row.source_title||'')}\">
      <input type=\"hidden\" name=\"publisher\" value=\"${esc(row.publisher||'')}\">
      <input type=\"hidden\" name=\"published_at\" value=\"${esc(published)}\">
      <div class=\"contract-review-grid\">
        <label>Event type<select name=\"event_type\">${options(EVENT_TYPES,eventType)}</select></label>
        <label>Status after<select name=\"status_after\">${options(STATUSES,statusAfter)}</select></label>
        <label>Promotion slug<input name=\"promotion_slug\" maxlength=\"100\" value=\"${esc(row.promotion_slug||'')}\" placeholder=\"ufc\"></label>
        <label>Source type<select name=\"source_type\">${options(SOURCE_TYPES,sourceType)}</select></label>
        <label>Agreement<select name=\"agreement_type\">${options(AGREEMENTS,'unknown')}</select></label>
        <label>Disclosure<select name=\"disclosure_scope\"><option value=\"status_only\">Status only</option><option value=\"partial_terms\">Partial terms</option><option value=\"reported_terms\">Reported terms</option></select></label>
      </div>
      <label>Public evidence summary<textarea name=\"public_summary\" maxlength=\"2000\" required>${esc(summary)}</textarea></label>
      <label class=\"current-claim\"><input name=\"is_current\" type=\"checkbox\"><span><strong>Evidence explicitly supports this status as current now.</strong><small>Leave unchecked for historical signings, releases, or old deal announcements unless the source establishes current status. Recency is not enough.</small></span></label>
      <div class=\"contract-review-actions\"><button class=\"button primary\" type=\"submit\">Publish verified event</button><span data-publish-status></span></div>
    </form>`;
  return `<article class=\"contract-review-card\" data-contract-candidate=\"${Number(row.id)}\">
    <div class=\"contract-review-head\"><div><span class=\"eyebrow\">${esc(label(row.review_status))} · ${esc(row.publisher||'Public source')}</span><h2>${esc(row.fighter_name||'Identity unresolved')}</h2><p>${identity}${published?' · Published '+esc(published.slice(0,10)):''}</p></div><a class=\"button secondary\" href=\"${esc(row.source_url)}\" rel=\"nofollow noopener\" target=\"_blank\">Open evidence ↗</a></div>
    <div class=\"contract-lead-summary\"><strong>${esc(row.source_title||'Contract signal')}</strong><p>${esc(summary)}</p></div>
    <div class=\"contract-detected\"><span>Detected event <strong>${esc(label(eventType))}</strong></span><span>Detected status <strong>${esc(label(statusAfter))}</strong></span><span>Promotion <strong>${esc(row.promotion_slug||'unresolved')}</strong></span><span>Extractor <strong>${esc(row.extraction_method||'—')}</strong></span></div>
    ${publish}
    <div class=\"contract-disposition\"><button class=\"button secondary\" type=\"button\" data-disposition=\"rejected\">Reject lead</button><button class=\"button secondary\" type=\"button\" data-disposition=\"duplicate\">Duplicate</button><button class=\"button secondary\" type=\"button\" data-disposition=\"needs_identity\">Needs identity</button></div>
    <textarea data-review-notes maxlength=\"2000\" placeholder=\"Private review notes…\">${esc(row.notes||'')}</textarea>
  </article>`;
}

export async function contractReviewPage(request:Request,env:Env){
  if(!await adminAccount(request,env.DB))return authPage();
  const url=new URL(request.url),status=reviewStatus(url.searchParams.get('status'));
  const rows=(await env.DB.prepare(`SELECT c.id,c.source_url,c.source_title,c.publisher,c.published_at,c.source_type,c.fighter_name,c.source_key,c.source_fighter_id,c.promotion_slug,c.detected_event_type,c.detected_status,c.detected_summary,c.extraction_method,c.review_status,c.notes,p.profile_slug
    FROM contract_intel_candidates c
    LEFT JOIN scout_active_global_profiles p ON p.source_key=c.source_key AND p.source_fighter_id=c.source_fighter_id
    WHERE c.review_status=?
    ORDER BY CASE c.source_type WHEN 'fighter_direct' THEN 0 WHEN 'manager_or_agency_direct' THEN 1 WHEN 'promotion_direct' THEN 2 WHEN 'athletic_commission_record' THEN 3 ELSE 4 END,
             COALESCE(c.published_at,c.discovered_at) DESC,c.id DESC
    LIMIT 250`).bind(status).all<Row>()).results||[];
  const counts=(await env.DB.prepare(`SELECT review_status,COUNT(*) count FROM contract_intel_candidates GROUP BY review_status`).all<Row>()).results||[];
  const countMap=new Map(counts.map(r=>[String(r.review_status),Number(r.count||0)]));
  const filters=['pending','needs_identity','accepted','rejected','duplicate'].map(v=>`<a class=\"${status===v?'active':''}\" href=\"/recruiting/contracts?status=${v}\">${esc(label(v))} <strong>${countMap.get(v)||0}</strong></a>`).join('');
  const body=`<section class=\"recruit-hero\"><a class=\"back-link\" href=\"/recruiting\">← Recruiting workspace</a><span class=\"eyebrow\">CONTRACT INTELLIGENCE REVIEW</span><h1>Turn discovery leads into verified evidence.</h1><p>Detection is a private lead, not a fact. Review the exact fighter, source, promotion, event and status before publishing anything. Historical evidence stays historical unless the source explicitly supports a current claim.</p><div class=\"hero-actions\"><a class=\"button secondary\" href=\"/recruiting/intel\">Intelligence queue →</a></div></section><nav class=\"contract-review-filters\">${filters}</nav><section class=\"candidate-section\"><div class=\"section-heading\"><div><span class=\"eyebrow\">${esc(label(status))}</span><h2>${rows.length} leads shown</h2></div><p class=\"queue-note\">First-party/public-record evidence is prioritized. Nothing is auto-published.</p></div><div class=\"candidate-grid\">${rows.map(card).join('')||'<div class=\"recruit-empty\">No contract leads in this queue.</div>'}</div></section>`;
  const script=`<script>(()=>{async function api(url,opts){const r=await fetch(url,{credentials:'same-origin',...opts}),j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||('HTTP '+r.status));return j}async function disposition(card,status,notes){await api('/api/admin/talent/contracts/candidates',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:Number(card.dataset.contractCandidate),review_status:status,notes})});card.remove()}document.querySelectorAll('[data-disposition]').forEach(btn=>btn.addEventListener('click',async()=>{const card=btn.closest('[data-contract-candidate]'),notes=card.querySelector('[data-review-notes]')?.value||'';btn.disabled=true;try{await disposition(card,btn.dataset.disposition,notes)}catch(err){btn.disabled=false;alert(err.message)}}));document.querySelectorAll('[data-contract-publish]').forEach(form=>form.addEventListener('submit',async e=>{e.preventDefault();const card=form.closest('[data-contract-candidate]'),status=form.querySelector('[data-publish-status]'),submit=form.querySelector('button[type=submit]');submit.disabled=true;status.textContent='Publishing verified event…';const fd=new FormData(form),payload=Object.fromEntries(fd.entries());payload.is_current=fd.has('is_current');if(payload.published_at)payload.reported_at=payload.published_at;try{const written=await api('/api/admin/talent/contracts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}),notes=card.querySelector('[data-review-notes]')?.value||'';await api('/api/admin/talent/contracts/candidates',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:Number(card.dataset.contractCandidate),review_status:'accepted',notes:(notes?notes+'\\n':'')+'Published as contract event #'+written.contract_event_id+' after human review.'})});card.remove()}catch(err){status.textContent=err.message||'Publish failed';submit.disabled=false}}))})();</script>`;
  return new Response(shell(body,script),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'private, no-store','x-robots-tag':'noindex,nofollow'}});
}
