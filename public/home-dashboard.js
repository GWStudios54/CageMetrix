(()=>{
  const root=document.querySelector('[data-home-dashboard]');if(!root)return;
  const eventSlug=root.dataset.eventSlug||'',userBox=root.querySelector('[data-home-user]');
  async function get(path){const r=await fetch(path,{credentials:'same-origin'}),j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'Request failed.');return j;}
  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  async function load(){
    if(!userBox)return;try{
      const me=(await get('/api/community/me')).account;
      if(!me){userBox.innerHTML=`<div><span class="eyebrow">YOUR CARD</span><strong>Put your picks on the record.</strong><small>Build a public record and try to beat the CageMetrix model every card.</small></div><a class="button primary" href="${eventSlug?`/events/${encodeURIComponent(eventSlug)}`:'/predictions.html'}">Make your picks →</a>`;return;}
      let card=null;if(eventSlug)try{card=(await get(`/api/community/events/${encodeURIComponent(eventSlug)}`)).card}catch{}
      const record=me.stats?.beat_model||{},made=Number(card?.made||0),total=Number(card?.total||0),left=Math.max(0,total-made);
      userBox.innerHTML=`<div><span class="eyebrow">WELCOME BACK, ${esc(me.display_name).toUpperCase()}</span><strong>${total?`${made}/${total} picks made · ${left} left`:'Your record is ready.'}</strong><small>Beat CageMetrix: ${Number(record.wins||0)}-${Number(record.losses||0)}-${Number(record.ties||0)} · ${Number(me.stats?.graded||0)} graded picks</small></div><div class="home-user-actions"><a class="button primary" href="${eventSlug?`/events/${encodeURIComponent(eventSlug)}`:esc(me.profile_url)}">${left?'Finish your card':'View your card'} →</a><a class="button secondary" href="${esc(me.profile_url)}">Profile</a></div>`;
    }catch{userBox.innerHTML='<small class="muted">Your CageMetrix profile could not be loaded.</small>'}
  }
  load();window.addEventListener('cm-auth-changed',load);
})();
