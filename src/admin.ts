type Env={DB:D1Database;ASSETS:Fetcher;MODEL_VERSION:string};
type Row=Record<string,any>;

const SESSION_COOKIE='cm_session';
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const cookieValue=(request:Request,name:string)=>{
  const raw=request.headers.get('cookie')||'';
  return raw.split(';').map(v=>v.trim()).find(v=>v.startsWith(`${name}=`))?.slice(name.length+1)||null;
};
async function hash(value:string){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
function sameOrigin(request:Request){const origin=request.headers.get('origin');return !origin||origin===new URL(request.url).origin;}
function json(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});}
async function body(request:Request,max=4096){
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw new Error('content_type');
  const text=await request.text();if(new TextEncoder().encode(text).length>max)throw new Error('too_large');
  try{return JSON.parse(text)}catch{throw new Error('invalid_json')}
}
function bodyError(error:any){const code=String(error?.message||error);return code==='content_type'?json({error:'Send application/json.'},415):code==='too_large'?json({error:'Request is too large.'},413):json({error:'Invalid JSON.'},400);}

async function adminAccount(request:Request,db:D1Database){
  const raw=cookieValue(request,SESSION_COOKIE);if(!raw||raw.length<30)return null;
  const tokenHash=await hash(raw);
  return db.prepare(`SELECT a.id,a.handle,a.display_name,a.role
    FROM community_sessions s JOIN community_accounts a ON a.id=s.account_id
    WHERE s.token_hash=? AND s.expires_at>CURRENT_TIMESTAMP AND a.role='admin' LIMIT 1`).bind(tokenHash).first<Row>();
}
async function requireAdmin(request:Request,env:Env){return adminAccount(request,env.DB);}

async function reportRows(db:D1Database){
  const rows=await db.prepare(`SELECT p.id post_id,p.scope_type,p.scope_id,p.body,p.created_at,p.deleted_at,
      a.handle,a.display_name,COUNT(*) report_count,GROUP_CONCAT(DISTINCT cr.reason) reasons,
      MIN(cr.created_at) first_report_at,e.slug event_slug
    FROM community_reports cr JOIN community_posts p ON p.id=cr.post_id
    JOIN community_accounts a ON a.id=p.account_id
    LEFT JOIN events e ON p.scope_type='event' AND e.id=p.scope_id
    WHERE cr.resolved_at IS NULL
    GROUP BY p.id,p.scope_type,p.scope_id,p.body,p.created_at,p.deleted_at,a.handle,a.display_name,e.slug
    ORDER BY report_count DESC,first_report_at ASC,p.id ASC LIMIT 100`).all<Row>();
  return (rows.results||[]).map((r:Row)=>({
    post_id:Number(r.post_id),scope_type:r.scope_type,scope_id:Number(r.scope_id),body:r.body,created_at:r.created_at,
    hidden:Boolean(r.deleted_at),author:{handle:r.handle,display_name:r.display_name,profile_url:`/u/${encodeURIComponent(String(r.handle))}`},
    report_count:Number(r.report_count||0),reasons:String(r.reasons||'').split(',').filter(Boolean),first_report_at:r.first_report_at,
    target_url:r.scope_type==='fight'?`/fights/${r.scope_id}`:r.event_slug?`/events/${encodeURIComponent(String(r.event_slug))}`:null
  }));
}

export async function adminOverview(request:Request,env:Env){
  const admin=await requireAdmin(request,env);if(!admin)return json({error:'admin_required'},403);
  const [reports,counts]=await Promise.all([
    reportRows(env.DB),
    env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM community_accounts) accounts,
      (SELECT COUNT(*) FROM community_posts WHERE deleted_at IS NULL) visible_posts,
      (SELECT COUNT(*) FROM community_posts WHERE deleted_at IS NOT NULL) hidden_posts,
      (SELECT COUNT(*) FROM community_reports WHERE resolved_at IS NULL) open_reports`).first<Row>()
  ]);
  return json({admin:{handle:admin.handle,display_name:admin.display_name},counts:{accounts:Number(counts?.accounts||0),visible_posts:Number(counts?.visible_posts||0),hidden_posts:Number(counts?.hidden_posts||0),open_reports:Number(counts?.open_reports||0)},reports});
}

export async function adminModeratePost(request:Request,env:Env,postId:string){
  if(!sameOrigin(request))return json({error:'Cross-origin admin actions are not allowed.'},403);
  const admin=await requireAdmin(request,env);if(!admin)return json({error:'admin_required'},403);
  if(!/^[1-9]\d*$/.test(postId))return json({error:'post_not_found'},404);
  let input:any;try{input=await body(request)}catch(error){return bodyError(error)}
  if(typeof input?.hidden!=='boolean')return json({error:'hidden must be true or false.'},400);
  const post=await env.DB.prepare('SELECT id FROM community_posts WHERE id=? LIMIT 1').bind(Number(postId)).first<Row>();if(!post)return json({error:'post_not_found'},404);
  if(input.hidden)await env.DB.prepare('UPDATE community_posts SET deleted_at=COALESCE(deleted_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(Number(postId)).run();
  else await env.DB.prepare('UPDATE community_posts SET deleted_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(Number(postId)).run();
  return json({ok:true,post_id:Number(postId),hidden:input.hidden});
}

export async function adminResolveReports(request:Request,env:Env,postId:string){
  if(!sameOrigin(request))return json({error:'Cross-origin admin actions are not allowed.'},403);
  const admin=await requireAdmin(request,env);if(!admin)return json({error:'admin_required'},403);
  if(!/^[1-9]\d*$/.test(postId))return json({error:'post_not_found'},404);
  let input:any;try{input=await body(request)}catch(error){return bodyError(error)}
  const resolved=input?.resolved!==false;
  if(resolved)await env.DB.prepare('UPDATE community_reports SET resolved_at=CURRENT_TIMESTAMP,resolved_by=? WHERE post_id=? AND resolved_at IS NULL').bind(admin.id,Number(postId)).run();
  else await env.DB.prepare('UPDATE community_reports SET resolved_at=NULL,resolved_by=NULL WHERE post_id=?').bind(Number(postId)).run();
  return json({ok:true,post_id:Number(postId),resolved});
}

export async function adminPage(request:Request,env:Env){
  const admin=await requireAdmin(request,env);
  if(!admin){
    const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Admin — CageMetrix</title><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/community.css"><link rel="icon" href="/logo.svg" type="image/svg+xml"></head><body><header class="topbar"><a class="brand" href="/"><img class="brand-mark" src="/logo.svg" width="44" height="44" alt=""><span>CageMetrix™</span></a></header><main style="max-width:760px;margin:64px auto;padding:0 24px"><p class="eyebrow">ADMIN</p><h1>Admin sign-in required</h1><p>Sign in to the owner profile from the Community page, then return here.</p><p><a class="button primary" href="/community">Go to Community sign-in →</a></p></main></body></html>`;
    return new Response(html,{status:403,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-robots-tag':'noindex'}});
  }
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Admin — CageMetrix</title><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/community.css"><link rel="icon" href="/logo.svg" type="image/svg+xml"><style>
  .admin-shell{max-width:1100px;margin:48px auto;padding:0 24px 80px}.admin-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:24px 0}.admin-metric,.admin-report{border:1px solid var(--line,#d8d8d8);border-radius:16px;padding:18px;background:var(--panel,#fff)}.admin-metric strong{font-size:1.8rem;display:block}.admin-report{margin:12px 0}.admin-report-head,.admin-actions{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}.admin-report blockquote{margin:14px 0;padding:12px 14px;border-left:3px solid currentColor;background:rgba(127,127,127,.08)}.admin-actions button{cursor:pointer}.admin-muted{opacity:.72}@media(max-width:700px){.admin-metrics{grid-template-columns:repeat(2,1fr)}}
  </style></head><body><header class="topbar"><a class="brand" href="/"><img class="brand-mark" src="/logo.svg" width="44" height="44" alt=""><span>CageMetrix™</span></a><nav><a href="/community">Community</a><a href="/u/${encodeURIComponent(String(admin.handle))}">@${esc(admin.handle)}</a></nav></header><main class="admin-shell"><p class="eyebrow">CAGEMETRIX ADMIN</p><h1>Moderation dashboard</h1><p class="admin-muted">Signed in as ${esc(admin.display_name)} · @${esc(admin.handle)}</p><div id="admin-root"><p>Loading reports…</p></div></main><script>
  const root=document.getElementById('admin-root');
  const e=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(url,opts){const r=await fetch(url,{credentials:'same-origin',...opts});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||('HTTP '+r.status));return j;}
  async function load(){try{const d=await api('/api/admin');root.innerHTML='<div class="admin-metrics"><div class="admin-metric"><strong>'+d.counts.accounts+'</strong><span>accounts</span></div><div class="admin-metric"><strong>'+d.counts.visible_posts+'</strong><span>visible posts</span></div><div class="admin-metric"><strong>'+d.counts.hidden_posts+'</strong><span>hidden posts</span></div><div class="admin-metric"><strong>'+d.counts.open_reports+'</strong><span>open reports</span></div></div><section><div class="section-heading"><div><p class="eyebrow">REPORT QUEUE</p><h2>Open reports</h2></div></div><div id="reports"></div></section>';const box=document.getElementById('reports');if(!d.reports.length){box.innerHTML='<p class="muted">No open reports.</p>';return;}box.innerHTML=d.reports.map(r=>'<article class="admin-report"><div class="admin-report-head"><div><strong>#'+r.post_id+' · @'+e(r.author.handle)+'</strong><div class="admin-muted">'+e(r.scope_type)+' · '+r.report_count+' report'+(r.report_count===1?'':'s')+(r.hidden?' · hidden':'')+'</div></div>'+(r.target_url?'<a class="button secondary" href="'+e(r.target_url)+'">Open context ↗</a>':'')+'</div><blockquote>'+e(r.body)+'</blockquote><p><strong>Reasons:</strong> '+e(r.reasons.join(', ')||'other')+'</p><div class="admin-actions"><button class="button secondary" data-hide="'+r.post_id+'" data-next="'+(!r.hidden)+'">'+(r.hidden?'Restore post':'Hide post')+'</button><button class="button primary" data-resolve="'+r.post_id+'">Resolve reports</button></div></article>').join('');box.querySelectorAll('[data-hide]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await api('/api/admin/posts/'+b.dataset.hide,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({hidden:b.dataset.next==='true'})});await load();}catch(err){alert(err.message);b.disabled=false;}});box.querySelectorAll('[data-resolve]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await api('/api/admin/reports/'+b.dataset.resolve,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({resolved:true})});await load();}catch(err){alert(err.message);b.disabled=false;}});}catch(err){root.innerHTML='<p>'+e(err.message)+'</p>';}}
  load();
</script></body></html>`;
  return new Response(html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-robots-tag':'noindex'}});
}
