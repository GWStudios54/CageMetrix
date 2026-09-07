(()=>{
  const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const rank=v=>v==='0.2.1'?0:v==='0.2.0'?1:v==='0.1.0'?2:3;
  const pct=v=>v==null?'—':`${Math.round(Number(v)*100)}%`;
  let payload=null,slug='';

  function dedupe(bouts=[]){
    const map=new Map();
    for(const b of bouts){
      const ids=[Number(b?.fighter_a?.id),Number(b?.fighter_b?.id)].sort((a,z)=>a-z),key=ids.every(Number.isFinite)?ids.join(':'):`bout:${b?.id}`;
      const cur=map.get(key);
      if(!cur||rank(b?.model?.version)<rank(cur?.model?.version)||(rank(b?.model?.version)===rank(cur?.model?.version)&&Number(b?.id)>Number(cur?.id)))map.set(key,b);
    }
    return [...map.values()];
  }
  function normalized(j){
    const bouts=dedupe(j?.bouts||[]),made=bouts.filter(b=>b.mine).length,community=bouts.reduce((n,b)=>n+Number(b.community?.total||0),0);
    const gradedBouts=bouts.filter(b=>b.mine?.grade&&(b.model?.grade==='correct'||b.model?.grade==='incorrect'));
    const userCorrect=gradedBouts.filter(b=>b.mine?.grade==='correct').length,modelCorrect=gradedBouts.filter(b=>b.model?.grade==='correct').length;
    return {...j,bouts,card:{...(j?.card||{}),made,total:bouts.length,community_picks:community,graded:gradedBouts.length,user_correct:userCorrect,model_correct:modelCorrect,result:gradedBouts.length?(userCorrect>modelCorrect?'user':userCorrect<modelCorrect?'model':'tie'):null}};
  }
  function accountButton(){return $('[data-cm-account-button]')}
  function promptAuth(){const b=accountButton();if(b)b.click();else location.href='/community'}
  async function api(path,opt={}){
    const init={credentials:'same-origin',...opt};
    if(init.body&&typeof init.body!=='string'){init.headers={'content-type':'application/json',...(init.headers||{})};init.body=JSON.stringify(init.body)}
    const r=await fetch(path,init),j=await r.json().catch(()=>({error:'Request failed.'}));
    if(!r.ok){const e=new Error(j.error||'Request failed.');e.status=r.status;throw e}return j;
  }
  function placeSummary(root){
    const oldList=$('[data-cm-pick-list]',root);if(oldList)oldList.hidden=true;
    if($('.cm-event-summary'))return;
    const head=$('.cm-community-head',root),score=$('[data-cm-event-score]',root),card=$('.event-card-seo');
    const section=card?.closest('section');if(!head||!score||!section)return;
    const summary=document.createElement('section');summary.className='cm-event-summary';
    const h=$('h2',head),p=$('p:not(.eyebrow)',head);if(h)h.textContent='Your card vs CageMetrix';if(p)p.textContent='Make each pick as you scroll. Your choice sits directly under the model call.';
    summary.append(head,score);section.before(summary);
  }
  function renderSummary(){
    const score=$('[data-cm-event-score]');if(!score||!payload)return;const c=payload.card||{};
    score.innerHTML=`<div class="cm-event-stat"><strong>${c.made||0}/${c.total||0}</strong><span>your card</span></div><div class="cm-event-stat"><strong>${c.community_picks||0}</strong><span>community picks</span></div><div class="cm-event-stat"><strong>${c.graded?`${c.user_correct}-${c.model_correct}`:'—'}</strong><span>you vs model</span></div><div class="cm-event-stat"><strong>${c.result==='user'?'YOU WIN':c.result==='model'?'MODEL WINS':c.result==='tie'?'TIE':payload.event?.locked?'LOCKED':'OPEN'}</strong><span>card status</span></div>`;
  }
  function crowdText(b){
    const total=Number(b.community?.total||0);if(!total)return 'Crowd · no picks yet';
    return `Crowd · ${b.fighter_a.name} ${pct(b.community.a_pct)} · ${b.fighter_b.name} ${pct(b.community.b_pct)}`;
  }
  function renderSlot(slot,b){
    const mine=b.mine,confidence=Number(mine?.confidence||65),picked=Number(mine?.picked_fighter_id||0),locked=!!payload.event?.locked;
    const selected=picked===Number(b.fighter_a.id)?b.fighter_a:picked===Number(b.fighter_b.id)?b.fighter_b:null,grade=mine?.grade||'';
    slot.innerHTML=`<div class="cm-inline-pick-head"><span>YOUR PICK</span><strong>${selected?esc(selected.name):'Choose a fighter'}</strong></div><div class="cm-inline-pick-actions"><button type="button" data-inline-side="a" class="${picked===Number(b.fighter_a.id)?'is-picked':''} ${picked===Number(b.fighter_a.id)&&grade?`is-${grade}`:''}" ${locked?'disabled':''}>${esc(b.fighter_a.name)}</button><button type="button" data-inline-side="b" class="${picked===Number(b.fighter_b.id)?'is-picked':''} ${picked===Number(b.fighter_b.id)&&grade?`is-${grade}`:''}" ${locked?'disabled':''}>${esc(b.fighter_b.name)}</button></div><div class="cm-inline-pick-meta"><label><span>Confidence</span><input type="range" min="50" max="100" value="${confidence}" ${locked?'disabled':''}><output>${confidence}%</output></label><small>${esc(crowdText(b))}</small></div>`;
    const slider=$('input',slot),out=$('output',slot);slider.oninput=()=>out.textContent=`${slider.value}%`;
    async function save(side){
      try{slot.classList.add('is-saving');payload=normalized(await api(`/api/community/events/${encodeURIComponent(slug)}/picks/${b.id}`,{method:'PUT',body:{pick:side,confidence:Number(slider.value)}}));renderAll()}
      catch(e){slot.classList.remove('is-saving');if(e.status===401){promptAuth();return}alert(e.message)}
    }
    $$('[data-inline-side]',slot).forEach(btn=>btn.onclick=()=>save(btn.dataset.inlineSide));
    slider.onchange=()=>{if(!mine)return;const side=picked===Number(b.fighter_a.id)?'a':picked===Number(b.fighter_b.id)?'b':null;if(side)save(side)};
  }
  function renderAll(){
    if(!payload)return;renderSummary();const byId=new Map(payload.bouts.map(b=>[String(b.id),b]));
    $$('[data-cm-inline-pick]').forEach(slot=>{const b=byId.get(String(slot.dataset.cmInlinePick));if(b)renderSlot(slot,b);else slot.innerHTML='<small class="muted">Pick unavailable for this matchup.</small>';});
  }
  async function load(){
    try{payload=normalized(await api(`/api/community/events/${encodeURIComponent(slug)}`));renderAll()}
    catch(e){$$('[data-cm-inline-pick]').forEach(slot=>slot.innerHTML=`<small class="muted">${esc(e.message)}</small>`)}
  }
  function boot(){
    const root=$('[data-cm-event]');if(!root)return;slug=root.dataset.cmEvent||'';if(!slug)return;placeSummary(root);load();
    window.addEventListener('cm-auth-changed',load);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
