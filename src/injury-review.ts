import {adminAccount} from './admin-session.ts';
import {BRAND_NAME} from './brand.ts';

type Env={DB:D1Database};
type Row=Record<string,any>;
const REVIEW=new Set(['pending','accepted','rejected','duplicate','needs_identity']);
const esc=(value:unknown)=>String(value??'').replace(/[&<>\"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]||ch));
const label=(value:unknown)=>String(value||'unknown').replaceAll('_',' ').replace(/\b\w/g,ch=>ch.toUpperCase());
const reviewStatus=(value:string|null)=>REVIEW.has(value||'')?value!:'pending';

function shell(body:string,script=''){
  return `<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"robots\" content=\"noindex,nofollow\"><title>Injury &amp; Availability Review | ${BRAND_NAME}</title><link rel=\"icon\" href=\"/logo.svg\" type=\"image/svg+xml\"><link rel=\"stylesheet\" href=\"/styles.css\"><link rel=\"stylesheet\" href=\"/recruiting.css?v=3\"></head><body><header class=\"topbar\"><a class=\"brand\" href=\"/\"><img class=\"brand-mark\" src=\"/logo.svg\" alt=\"\" width=\"44\" height=\"44\"><span>${BRAND_NAME}</span></a></header><main class=\"recruit-main\">${body}</main><footer><span>${BRAND_NAME}</span><span>Private injury/availability intelligence review.</span></footer>${script}</body></html>`;
}

function authPage(){
  return new Response(shell('<section class=\"recruit-hero\"><span class=\"eyebrow\">PRIVATE WORKSPACE</span><h1>Injury review access required.</h1><p>This queue contains unpublished intelligence leads and is restricted to authorized MMA Scouts users.</p><a class=\"button primary\" href=\"/admin\">Admin sign in →</a></section>'),{status:403,headers:{'content-type':'text/html; charset=utf-8','cache-control':'private, no-store','x-robots-tag':'noindex,nofollow'}});
}
const EVENT_TYPES=['withdrawal','injury_disclosed','cleared_to_compete','replacement_announced'];
const SOURCE_TYPES=['fighter_direct','coach_or_camp_direct','promotion_direct','reputable_trade_reporting','reputable_interview','secondary_reporting_with_attribution','archived_public_statement'];

function options(values:string[],selected:string){
  return values.map(v=>`<option value=\"${esc(v)}\"${v===selected?' selected':''}>${esc(label(v))}</option>`).join('');
}

function card(row:Row){
  const noIdentity=!row.profile_slug||row.review_status==='needs_identity';
  const eventType=String(row.detected_event_type||'injury_disclosed');
  const sourceType=String(row.source_type||'reputable_trade_reporting');
  const summary=String(row.detected_summary||row.source_title||'').slice(0,1800);
  const published=String(row.published_at||'').slice(0,40);
  const identity=noIdentity?'<strong>Identity unresolved — do not publish.</strong>':`<a href=\"/scout/fighters/${esc(row.profile_slug)}\">Open fighter dossier →</a>`;
  const publish=noIdentity?'':`
    <form class=\"contract-publish-form\" data-injury-publish>
      <input type=\"hidden\" name=\"profile_slug\" value=\"${esc(row.profile_slug)}\">
      <input type=\"hidden\" name=\"source_url\" value=\"${esc(row.source_url)}\">
      <input type=\"hidden\" name=\"source_title\" value=\"${esc(row.source_title||'')}\">
      <input type=\"hidden\" name=\"publisher\" value=\"${esc(row.publisher||'')}\">
      <input type=\"hidden\" name=\"published_at\" value=\"${esc(published)}\">
      <div class=\"contract-review-grid\">
        <label>Event type<select name=\"event_type\">${options(EVENT_TYPES,eventType)}</select></label>
        <label>Injury description (optional)<input name=\"injury_description\" maxlength=\"300\" placeholder=\"cut, torn ACL, ...\"></label>
        <label>Affected event (optional)<input name=\"affected_event\" maxlength=\"200\" placeholder=\"UFC 331\"></label>
        <label>Opponent/replacement (optional)<input name=\"opponent_name\" maxlength=\"160\"></label>
        <label>Evidence source type<select name=\"evidence_source_type\">${options(SOURCE_TYPES,sourceType)}</select></label>
        <label>Effective at (optional)<input name=\"effective_at\" placeholder=\"YYYY-MM-DD\"></label>
      </div>
      <label>Public evidence summary<textarea name=\"public_summary\" maxlength=\"2000\" required>${esc(summary)}</textarea></label>
      <label class=\"current-claim\"><input name=\"is_current\" type=\"checkbox\"><span><strong>Evidence explicitly supports this status as current now.</strong><small>Leave unchecked for a resolved/historical case (e.g. a withdrawal the fighter has since returned from).</small></span></label>
      <div class=\"contract-review-actions\"><button class=\"button primary\" type=\"submit\">Publish verified event</button><span data-publish-status></span></div>
    </form>`;
  return `<article class=\"contract-review-card\" data-injury-candidate=\"${Number(row.id)}\">
    <div class=\"contract-review-head\"><div><span class=\"eyebrow\">${esc(label(row.review_status))} · ${esc(row.publisher||'Public source')}</span><h2>${esc(row.fighter_name||'Identity unresolved')}</h2><p>${identity}${published?' · Published '+esc(published.slice(0,10)):''}</p></div><a class=\"button secondary\" href=\"${esc(row.source_url)}\" rel=\"nofollow noopener\" target=\"_blank\">Open evidence ↗</a></div>
    <div class=\"contract-lead-summary\"><strong>${esc(row.source_title||'Injury/availability signal')}</strong><p>${esc(summary)}</p></div>
    <div class=\"contract-detected\"><span>Detected event <strong>${esc(label(eventType))}</strong></span><span>Extractor <strong>${esc(row.extraction_method||'—')}</strong></span></div>
    ${publish}
    <div class=\"contract-disposition\"><button class=\"button secondary\" type=\"button\" data-disposition=\"rejected\">Reject lead</button><button class=\"button secondary\" type=\"button\" data-disposition=\"duplicate\">Duplicate</button><button class=\"button secondary\" type=\"button\" data-disposition=\"needs_identity\">Needs identity</button></div>
    <textarea data-review-notes maxlength=\"2000\" placeholder=\"Private review notes…\">${esc(row.notes||'')}</textarea>
  </article>`;
}

export async function injuryReviewPage(request:Request,env:Env){
  if(!await adminAccount(request,env.DB))return authPage();
  const url=new URL(request.url),status=reviewStatus(url.searchParams.get('status'));
  const rows=(await env.DB.prepare(`SELECT c.id,c.source_url,c.source_title,c.publisher,c.published_at,c.source_type,c.fighter_name,c.source_key,c.source_fighter_id,c.detected_event_type,c.detected_summary,c.extraction_method,c.review_status,c.notes,p.profile_slug
    FROM injury_intel_candidates c
    LEFT JOIN scout_active_global_profiles p ON p.source_key=c.source_key AND p.source_fighter_id=c.source_fighter_id
    WHERE c.review_status=?
    ORDER BY COALESCE(c.published_at,c.discovered_at) DESC,c.id DESC
    LIMIT 250`).bind(status).all<Row>()).results||[];
  const counts=(await env.DB.prepare(`SELECT review_status,COUNT(*) count FROM injury_intel_candidates GROUP BY review_status`).all<Row>()).results||[];
  const countMap=new Map(counts.map(r=>[String(r.review_status),Number(r.count||0)]));
  const filters=['pending','needs_identity','accepted','rejected','duplicate'].map(v=>`<a class=\"${status===v?'active':''}\" href=\"/recruiting/injuries?status=${v}\">${esc(label(v))} <strong>${countMap.get(v)||0}</strong></a>`).join('');
  const body=`<section class=\"recruit-hero\"><a class=\"back-link\" href=\"/recruiting\">← Recruiting workspace</a><span class=\"eyebrow\">INJURY &amp; AVAILABILITY REVIEW</span><h1>Turn withdrawal/injury leads into verified status.</h1><p>Detection is a private lead, not a fact. Review the exact fighter, source and event before publishing anything, and reject or mark needs-identity rather than guess.</p><div class=\"hero-actions\"><a class=\"button secondary\" href=\"/recruiting/contracts\">Contract review →</a><a class=\"button secondary\" href=\"/recruiting/camps\">Camp review →</a><a class=\"button secondary\" href=\"/recruiting/coaches\">Coach review →</a><a class=\"button secondary\" href=\"/recruiting/antidoping\">Anti-doping review →</a><a class=\"button secondary\" href=\"/recruiting/amateur-records\">Amateur record review →</a></div></section><nav class=\"contract-review-filters\">${filters}</nav><section class=\"candidate-section\"><div class=\"section-heading\"><div><span class=\"eyebrow\">${esc(label(status))}</span><h2>${rows.length} leads shown</h2></div><p class=\"queue-note\">Nothing is auto-published.</p></div><div class=\"candidate-grid\">${rows.map(card).join('')||'<div class=\"recruit-empty\">No injury/availability leads in this queue.</div>'}</div></section>`;
  const script=`<script>(()=>{async function api(url,opts){const r=await fetch(url,{credentials:'same-origin',...opts}),j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||('HTTP '+r.status));return j}async function disposition(card,status,notes){await api('/api/admin/talent/injuries/candidates',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:Number(card.dataset.injuryCandidate),review_status:status,notes})});card.remove()}document.querySelectorAll('[data-disposition]').forEach(btn=>btn.addEventListener('click',async()=>{const card=btn.closest('[data-injury-candidate]'),notes=card.querySelector('[data-review-notes]')?.value||'';btn.disabled=true;try{await disposition(card,btn.dataset.disposition,notes)}catch(err){btn.disabled=false;alert(err.message)}}));document.querySelectorAll('[data-injury-publish]').forEach(form=>form.addEventListener('submit',async e=>{e.preventDefault();const card=form.closest('[data-injury-candidate]'),status=form.querySelector('[data-publish-status]'),submit=form.querySelector('button[type=submit]');submit.disabled=true;status.textContent='Publishing verified event…';const fd=new FormData(form),payload=Object.fromEntries(fd.entries());payload.is_current=fd.has('is_current');if(payload.published_at)payload.reported_at=payload.published_at;try{const written=await api('/api/admin/talent/injuries',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}),notes=card.querySelector('[data-review-notes]')?.value||'';await api('/api/admin/talent/injuries/candidates',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:Number(card.dataset.injuryCandidate),review_status:'accepted',notes:(notes?notes+'\\n':'')+'Published as injury event #'+written.injury_event_id+' after human review.'})});card.remove()}catch(err){status.textContent=err.message||'Publish failed';submit.disabled=false}}))})();</script>`;
  return new Response(shell(body,script),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'private, no-store','x-robots-tag':'noindex,nofollow'}});
}
