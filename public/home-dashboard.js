(()=>{
  const hero=document.querySelector('.hero');
  if(hero&&!document.querySelector('.home-research-entry')){
    const section=document.createElement('section');
    section.className='home-research-entry';
    section.setAttribute('aria-label','MMA Scouts research tools');
    section.innerHTML=`<div class="home-ask-shell"><div class="home-ask-copy"><span class="eyebrow">ASK MMA SCOUTS</span><strong>Research the sport in plain English.</strong><small>Ask about fighters, matchups, prospects, résumés, rankings, or relationships across MMA history.</small></div><form class="home-ask-form" data-home-scout-form><label class="sr-only" for="home-scout-question">Ask MMA Scouts a research question</label><input id="home-scout-question" name="question" maxlength="500" autocomplete="off" placeholder="Ask MMA Scouts anything…"><button class="button primary" type="submit">Search</button></form><div class="home-sample-links"><span>Try:</span><a href="/scout?question=Compare%20Ilia%20Topuria%20and%20Islam%20Makhachev">Compare Topuria vs Makhachev</a><a href="/scout?question=Find%20undefeated%20regional%20fighters%20under%2025">Find prospects under 25</a><a href="/scout?question=Which%20active%20fighters%20had%20the%20strongest%20documented%20pre-UFC%20resumes%3F">Best pre-UFC résumés</a></div></div><div class="home-tool-grid"><a class="home-tool-card" href="/scout"><span class="home-tool-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg></span><div><strong>Scout AI</strong><small>Ask questions. Get evidence-backed answers.</small></div><b>→</b></a><a class="home-tool-card" href="/#rankings"><span class="home-tool-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M8 8h8M8 12h8M8 16h5"/></svg></span><div><strong>Fighter Reports</strong><small>Ratings, history, résumé and career context.</small></div><b>→</b></a><a class="home-tool-card" href="/predictions.html"><span class="home-tool-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h12M13 5l3 3-3 3M20 16H8M11 13l-3 3 3 3"/></svg></span><div><strong>Matchup Scout</strong><small>Model probabilities and matchup analysis.</small></div><b>→</b></a><a class="home-tool-card" href="/#rankings"><span class="home-tool-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V11h3v9M10.5 20V6h3v14M16 20V9h3v11"/></svg></span><div><strong>Scout Rankings</strong><small>Opponent-adjusted performance and schedule.</small></div><b>→</b></a><a class="home-tool-card" href="/scout?question=Find%20the%20best%20regional%20MMA%20prospects"><span class="home-tool-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.6 5.3 5.9.9-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.2 5.9-.9Z"/></svg></span><div><strong>Prospect Scout</strong><small>Search the next generation of fighters.</small></div><b>→</b></a></div>`;
    hero.insertAdjacentElement('afterend',section);
    const form=section.querySelector('[data-home-scout-form]'),input=section.querySelector('#home-scout-question');
    form?.addEventListener('submit',event=>{event.preventDefault();const question=String(input?.value||'').trim();location.href=question?`/scout?question=${encodeURIComponent(question)}`:'/scout';});
  }

  const root=document.querySelector('[data-home-dashboard]');if(!root)return;
  const eventSlug=root.dataset.eventSlug||'',userBox=root.querySelector('[data-home-user]');
  async function get(path){const r=await fetch(path,{credentials:'same-origin'}),j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'Request failed.');return j;}
  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  async function load(){
    if(!userBox)return;try{
      const me=(await get('/api/community/me')).account;
      if(!me){userBox.innerHTML=`<div><span class="eyebrow">YOUR CARD</span><strong>Put your picks on the record.</strong><small>Build a public record and try to beat the MMA Scouts model every card.</small></div><a class="button primary" href="${eventSlug?`/events/${encodeURIComponent(eventSlug)}`:'/predictions.html'}">Make your picks →</a>`;return;}
      let card=null;if(eventSlug)try{card=(await get(`/api/community/events/${encodeURIComponent(eventSlug)}`)).card}catch{}
      const record=me.stats?.beat_model||{},made=Number(card?.made||0),total=Number(card?.total||0),left=Math.max(0,total-made);
      userBox.innerHTML=`<div><span class="eyebrow">WELCOME BACK, ${esc(me.display_name).toUpperCase()}</span><strong>${total?`${made}/${total} picks made · ${left} left`:'Your record is ready.'}</strong><small>Beat MMA Scouts: ${Number(record.wins||0)}-${Number(record.losses||0)}-${Number(record.ties||0)} · ${Number(me.stats?.graded||0)} graded picks</small></div><div class="home-user-actions"><a class="button primary" href="${eventSlug?`/events/${encodeURIComponent(eventSlug)}`:esc(me.profile_url)}">${left?'Finish your card':'View your card'} →</a><a class="button secondary" href="${esc(me.profile_url)}">Profile</a></div>`;
    }catch{userBox.innerHTML='<small class="muted">Your MMA Scouts profile could not be loaded.</small>'}
  }
  load();window.addEventListener('cm-auth-changed',load);
})();
