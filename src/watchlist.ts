type Env={DB:D1Database;ASSETS:Fetcher;MODEL_VERSION:string};
type Row=Record<string,any>;
const SESSION_COOKIE='cm_session';
const PUBLIC_MODEL='CageMetrix Win Probability';
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const cookieValue=(request:Request,name:string)=>{const raw=request.headers.get('cookie')||'';return raw.split(';').map(v=>v.trim()).find(v=>v.startsWith(`${name}=`))?.slice(name.length+1)||null;};
async function hash(value:string){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');}
async function account(request:Request,db:D1Database){const raw=cookieValue(request,SESSION_COOKIE);if(!raw||raw.length<30)return null;return db.prepare(`SELECT a.id,a.handle,a.display_name FROM community_sessions s JOIN community_accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>CURRENT_TIMESTAMP LIMIT 1`).bind(await hash(raw)).first<Row>();}
function json(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});}
function sameOrigin(request:Request){const origin=request.headers.get('origin');return !origin||origin===new URL(request.url).origin;}
async function readBody(request:Request){if(!request.headers.get('content-type')?.startsWith('application/json'))throw new Error('bad');const text=await request.text();if(new TextEncoder().encode(text).length>2048)throw new Error('bad');return JSON.parse(text);}
const prettyDate=(value:unknown)=>{const raw=String(value||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return '';return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(`${raw}T12:00:00Z`));};

async function fighter(db:D1Database,slug:string){if(!/^[a-z0-9-]{1,180}$/.test(slug))return null;return db.prepare('SELECT id,slug,name,current_weight_class FROM fighters WHERE slug=? LIMIT 1').bind(slug).first<Row>();}
async function rows(db:D1Database,accountId:number){
  const result=await db.prepare(`SELECT f.id,f.slug,f.name,f.current_weight_class,w.created_at,
    b.id bout_id,e.slug next_event_slug,e.name next_event_name,e.event_date,e.starts_at,
    CASE WHEN b.fighter_a_id=f.id THEN z.name ELSE a.name END opponent_name,
    CASE WHEN b.fighter_a_id=f.id THEN z.slug ELSE a.slug END opponent_slug,
    p.picked_fighter_id,
    CASE WHEN b.fighter_a_id=f.id THEN p.fighter_a_probability ELSE p.fighter_b_probability END model_probability
    FROM community_fighter_follows w JOIN fighters f ON f.id=w.fighter_id
    LEFT JOIN bouts b ON b.id=(
      SELECT b2.id FROM bouts b2 JOIN events e2 ON e2.id=b2.event_id
      WHERE (b2.fighter_a_id=f.id OR b2.fighter_b_id=f.id) AND e2.status='scheduled' AND e2.starts_at>=CURRENT_TIMESTAMP
      ORDER BY e2.starts_at ASC,b2.bout_order ASC,b2.id ASC LIMIT 1
    )
    LEFT JOIN events e ON e.id=b.event_id
    LEFT JOIN fighters a ON a.id=b.fighter_a_id LEFT JOIN fighters z ON z.id=b.fighter_b_id
    LEFT JOIN predictions p ON p.id=(
      SELECT p2.id FROM predictions p2 JOIN model_versions mv ON mv.id=p2.model_version_id
      WHERE p2.bout_id=b.id AND mv.name=?
      ORDER BY CASE mv.version WHEN '0.2.1' THEN 0 WHEN '0.2.0' THEN 1 WHEN '0.1.0' THEN 2 ELSE 3 END,p2.id DESC LIMIT 1
    )
    WHERE w.account_id=? ORDER BY CASE WHEN e.starts_at IS NULL THEN 1 ELSE 0 END,e.starts_at ASC,w.created_at DESC LIMIT 100`).bind(PUBLIC_MODEL,accountId).all<Row>();
  return (result.results||[]).map(r=>({
    id:Number(r.id),slug:String(r.slug),name:String(r.name),division:r.current_weight_class||null,followed_at:r.created_at,
    next_fight:r.bout_id?{bout_id:Number(r.bout_id),event_slug:r.next_event_slug,event_name:r.next_event_name,event_date:r.event_date,starts_at:r.starts_at,opponent_name:r.opponent_name,opponent_slug:r.opponent_slug,model_probability:Number.isFinite(Number(r.model_probability))?Number(r.model_probability):null,model_pick:Number(r.picked_fighter_id)===Number(r.id)}:null
  }));
}

export async function getWatchlist(request:Request,env:Env){const who=await account(request,env.DB);if(!who)return json({error:'Sign in to view your watchlist.'},401);return json({account:{handle:who.handle,display_name:who.display_name},fighters:await rows(env.DB,Number(who.id))});}
export async function fighterFollowStatus(request:Request,env:Env,slug:string){const f=await fighter(env.DB,slug);if(!f)return json({error:'fighter_not_found'},404);const who=await account(request,env.DB);if(!who)return json({account:null,fighter:{slug:f.slug,name:f.name},following:false});const hit=await env.DB.prepare('SELECT 1 ok FROM community_fighter_follows WHERE account_id=? AND fighter_id=? LIMIT 1').bind(who.id,f.id).first<Row>();return json({account:{handle:who.handle,display_name:who.display_name},fighter:{slug:f.slug,name:f.name},following:!!hit});}
export async function setFighterFollow(request:Request,env:Env,slug:string){
  if(!sameOrigin(request))return json({error:'Cross-origin follow changes are not allowed.'},403);const who=await account(request,env.DB);if(!who)return json({error:'Sign in to follow fighters.'},401);const f=await fighter(env.DB,slug);if(!f)return json({error:'fighter_not_found'},404);
  let input:any;try{input=await readBody(request)}catch{return json({error:'Send a valid JSON request.'},400)}if(typeof input?.following!=='boolean')return json({error:'following must be true or false.'},400);
  if(input.following){const count=await env.DB.prepare('SELECT COUNT(*) n FROM community_fighter_follows WHERE account_id=?').bind(who.id).first<Row>();if(Number(count?.n||0)>=100)return json({error:'Watchlists are limited to 100 fighters.'},400);await env.DB.prepare('INSERT OR IGNORE INTO community_fighter_follows(account_id,fighter_id) VALUES(?,?)').bind(who.id,f.id).run();}
  else await env.DB.prepare('DELETE FROM community_fighter_follows WHERE account_id=? AND fighter_id=?').bind(who.id,f.id).run();
  return json({ok:true,following:input.following,fighter:{slug:f.slug,name:f.name}});
}

function cards(items:any[]){return items.map(item=>{const fight=item.next_fight;const fightHtml=fight?`<div class="watch-fight"><span class="eyebrow">NEXT FIGHT · ${esc(prettyDate(fight.event_date))}</span><strong>${esc(item.name)} vs ${esc(fight.opponent_name)}</strong><small>${esc(fight.event_name||'Upcoming event')}${fight.model_probability!=null?` · CageMetrix ${Math.round(fight.model_probability*100)}%${fight.model_pick?' pick':''}`:''}</small><div class="watch-actions"><a class="button primary" href="/fights/${fight.bout_id}">Fight breakdown →</a><a class="button secondary" href="/events/${esc(fight.event_slug)}">Full card</a></div></div>`:`<div class="watch-fight"><span class="eyebrow">NO FIGHT BOOKED</span><small>We’ll surface the next matchup here when one is on the schedule.</small></div>`;return `<article class="watch-card"><div class="watch-card-head"><div><a href="/fighters/${esc(item.slug)}"><strong>${esc(item.name)}</strong></a><small>${esc(item.division||'MMA')}</small></div><button class="button secondary" data-unfollow="${esc(item.slug)}">Following</button></div>${fightHtml}</article>`;}).join('');}

export async function watchlistPage(request:Request,env:Env){
  const who=await account(request,env.DB);const items=who?await rows(env.DB,Number(who.id)):[];
  const content=who?`<main class="watch-page"><section class="watch-hero"><p class="eyebrow">YOUR WATCHLIST</p><h1>Fighters you care about.</h1><p>Bookings, CageMetrix predictions and the next matchup stay in one place.</p></section><div class="watch-grid" data-watch-grid>${cards(items)||'<div class="watch-empty"><h2>No fighters followed yet.</h2><p>Open a fighter profile and tap Follow fighter.</p><a class="button primary" href="/#rankings">Browse rankings →</a></div>'}</div></main>`:`<main class="watch-page"><section class="watch-hero"><p class="eyebrow">WATCHLIST</p><h1>Sign in to follow fighters.</h1><p>Your watchlist stays attached to your CageMetrix profile.</p><a class="button primary" href="/community">Sign in →</a></section></main>`;
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,follow"><title>Your Fighter Watchlist — CageMetrix</title><link rel="stylesheet" href="/styles.css"><link rel="icon" href="/logo.svg" type="image/svg+xml"><style>.watch-page{max-width:1100px;margin:0 auto;padding:56px 24px 88px}.watch-hero{max-width:760px;margin-bottom:28px}.watch-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}.watch-card{border:1px solid var(--line,#333);border-radius:18px;padding:18px;background:var(--panel,#111)}.watch-card-head,.watch-actions{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}.watch-card-head div{display:grid;gap:3px}.watch-card-head small,.watch-fight small{color:var(--muted,#888)}.watch-fight{display:grid;gap:8px;margin-top:18px;padding-top:16px;border-top:1px solid var(--line,#333)}.watch-empty{padding:30px;border:1px dashed var(--line,#333);border-radius:18px}@media(max-width:700px){.watch-card-head button,.watch-actions .button{width:100%;text-align:center}}</style></head><body><header class="topbar"><a class="brand" href="/"><img class="brand-mark" src="/logo.svg" width="44" height="44" alt=""><span>CageMetrix™</span></a><nav><a href="/predictions.html">Predictions</a><a href="/forum">Forum</a><a href="/community">Profile</a></nav></header>${content}<footer><span>CageMetrix™</span><span>Follow the matchup, not the noise.</span></footer><script>document.querySelectorAll('[data-unfollow]').forEach(b=>b.addEventListener('click',async()=>{b.disabled=true;const r=await fetch('/api/community/fighters/'+encodeURIComponent(b.dataset.unfollow)+'/follow',{method:'PUT',headers:{'content-type':'application/json'},credentials:'same-origin',body:JSON.stringify({following:false})});if(r.ok)b.closest('.watch-card')?.remove();else b.disabled=false;}));</script></body></html>`;
  return new Response(html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'private, no-store','x-robots-tag':'noindex'}});
}

export async function enhanceFighterFollow(response:Response,_env:Env,slug:string){
  if(!response.ok||!response.headers.get('content-type')?.includes('text/html'))return response;
  const block=`<div class="cm-follow-slot" data-cm-follow-slot data-fighter-slug="${esc(slug)}"><button class="button secondary" type="button" data-cm-follow>Follow fighter</button><a href="/watchlist">Watchlist →</a></div>`;
  const script=`<style>.cm-follow-slot{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:14px}.cm-follow-slot a{font-size:.85rem}.cm-follow-slot .is-following{border-color:currentColor}@media(max-width:700px){.cm-follow-slot .button{width:100%}}</style><script>(()=>{const s=document.querySelector('[data-cm-follow-slot]'),b=s?.querySelector('[data-cm-follow]');if(!s||!b)return;const slug=s.dataset.fighterSlug;let signed=false,following=false;async function load(){try{const r=await fetch('/api/community/fighters/'+encodeURIComponent(slug)+'/follow',{credentials:'same-origin'}),j=await r.json();signed=!!j.account;following=!!j.following;b.textContent=following?'Following':'Follow fighter';b.classList.toggle('is-following',following);}catch{}}b.addEventListener('click',async()=>{if(!signed){location.href='/community';return;}b.disabled=true;try{const r=await fetch('/api/community/fighters/'+encodeURIComponent(slug)+'/follow',{method:'PUT',headers:{'content-type':'application/json'},credentials:'same-origin',body:JSON.stringify({following:!following})}),j=await r.json();if(!r.ok)throw new Error(j.error||'Request failed');following=!!j.following;b.textContent=following?'Following':'Follow fighter';b.classList.toggle('is-following',following);}catch(e){alert(e.message)}finally{b.disabled=false;}});load();})();</script>`;
  return new HTMLRewriter().on('.fighter-name',{element(el){el.after(block,{html:true});}}).on('.topbar nav',{element(el){el.append('<a href="/watchlist">Watchlist</a><a href="/forum">Forum</a>',{html:true});}}).on('head',{element(el){el.append(script,{html:true});}}).transform(response);
}

export async function enhanceHomeWatchlist(response:Response,request:Request,env:Env){
  if(!response.ok||!response.headers.get('content-type')?.includes('text/html'))return response;const who=await account(request,env.DB);if(!who)return response;const items=await rows(env.DB,Number(who.id));
  const compact=items.slice(0,4).map(item=>`<a class="home-watch-row" href="/fighters/${esc(item.slug)}"><span><strong>${esc(item.name)}</strong><small>${item.next_fight?`vs ${esc(item.next_fight.opponent_name)} · ${esc(prettyDate(item.next_fight.event_date))}`:'No fight booked'}</small></span>${item.next_fight?.model_probability!=null?`<b>${Math.round(item.next_fight.model_probability*100)}%</b>`:''}</a>`).join('');
  const block=`<section class="home-watchlist"><div class="home-watch-head"><div><span class="eyebrow">YOUR WATCHLIST</span><h2>Fighters you follow</h2></div><a href="/watchlist">Open watchlist →</a></div><div class="home-watch-rows">${compact||'<p class="home-watch-empty">Follow fighters from their profile pages and their next matchup will appear here.</p>'}</div></section>`;
  const style='<style>.home-watchlist{max-width:1120px;margin:0 auto 56px;padding:0 24px}.home-watch-head{display:flex;align-items:end;justify-content:space-between;gap:16px;margin-bottom:14px}.home-watch-rows{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}.home-watch-row{display:flex;justify-content:space-between;gap:12px;padding:14px 0;border-top:1px solid var(--line,#333);color:inherit;text-decoration:none}.home-watch-row span{display:grid;gap:3px}.home-watch-row small,.home-watch-empty{color:var(--muted,#888)}@media(max-width:700px){.home-watch-head{align-items:start;flex-direction:column}}</style>';
  const transformed=new HTMLRewriter().on('head',{element(el){el.append(style,{html:true});}}).on('footer',{element(el){el.before(block,{html:true});}}).transform(response);const out=new Response(transformed.body,transformed);out.headers.set('cache-control','private, no-store');return out;
}
