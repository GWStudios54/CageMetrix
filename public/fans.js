(() => {
  const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pct=v=>typeof v==='number'&&Number.isFinite(v)?`${(v*100).toFixed(1)}%`:'—';
  const num=(v,d=1)=>typeof v==='number'&&Number.isFinite(v)?v.toFixed(d):'—';
  const id=location.pathname.match(/^\/fights\/([1-9]\d*)\/?$/)?.[1];
  if(!id)return;
  let data=null,saving=false;
  const statusText={correct:'Correct',incorrect:'Incorrect',pending:'Pending',tie:'50/50 tie',no_votes:'No fan pick',void:'Excluded'};
  const gradeClass=g=>['correct','incorrect'].includes(g)?g:['tie','no_votes','void'].includes(g)?g:'pending';
  function renderPrediction(){
    const root=$('#fan-prediction');if(!root||!data)return;
    const b=data.bout,f=data.prediction,m=data.model;
    const modelGrade=`<span class="fan-grade ${gradeClass(m.grade)}">Model: ${esc(statusText[m.grade]||m.grade)}</span>`;
    const fanGrade=`<span class="fan-grade ${gradeClass(f.grade)}">Fans: ${esc(statusText[f.grade]||f.grade)}</span>`;
    const fanLines=f.total?`<div class="fans-line"><span>${esc(b.fighter_a_name)}</span><strong>${pct(f.a_pct)}</strong></div><div class="fans-line"><span>${esc(b.fighter_b_name)}</span><strong>${pct(f.b_pct)}</strong></div>`:`<p class="fan-empty">No fan predictions yet.</p>`;
    root.innerHTML=`<div class="fans-compare"><article class="fans-side"><h3>CageMetrix Predictor 0.1</h3><div class="fans-line"><span>${esc(b.fighter_a_name)}</span><strong>${pct(m.fighter_a_probability)}</strong></div><div class="fans-line"><span>${esc(b.fighter_b_name)}</span><strong>${pct(m.fighter_b_probability)}</strong></div>${b.status==='completed'?modelGrade:''}</article><article class="fans-side"><h3>Fan Consensus</h3>${fanLines}<p class="fans-meta">${f.total?`${f.total.toLocaleString()} fan pick${f.total===1?'':'s'}`:'Be the first fan to pick this fight.'}</p>${b.status==='completed'?fanGrade:''}</article></div>${f.open?`<div class="fan-pick-actions"><button class="fan-pick" data-pick="a" aria-pressed="${f.my_pick==='a'}">Pick ${esc(b.fighter_a_name)}</button><button class="fan-pick" data-pick="b" aria-pressed="${f.my_pick==='b'}">Pick ${esc(b.fighter_b_name)}</button></div><p class="fans-meta">Your pick may be changed until the card starts. Then every fan vote is locked for the permanent Fans vs. Model record.</p>`:`<p class="fans-meta">Fan predictions are locked. ${esc(f.lock_policy)}</p>`}<p id="fan-prediction-feedback" class="fan-feedback" role="status"></p>`;
  }
  function scoreOptions(value=''){
    const options=[['','Choose a score'],['10-9','Red 10–9 Blue'],['9-10','Blue 10–9 Red'],['10-8','Red 10–8 Blue'],['8-10','Blue 10–8 Red'],['10-7','Red 10–7 Blue'],['7-10','Blue 10–7 Red'],['10-10','10–10']];
    return options.map(([v,label])=>`<option value="${v}" ${v===value?'selected':''}>${label}</option>`).join('');
  }
  function renderScorecards(){
    const root=$('#fan-scorecards-body');if(!root||!data)return;
    const b=data.bout,s=data.scorecards;
    let summary='';
    if(s.total){
      const o=s.overall;
      summary=`<div class="fan-score-summary"><article class="fan-card-overall"><p class="eyebrow">FAN CARD CONSENSUS</p><strong>${pct(o.a_pct)} / ${pct(o.b_pct)}</strong><p>${esc(b.fighter_a_name)} / ${esc(b.fighter_b_name)}</p><p class="fan-average">${pct(o.tie_pct)} tied cards · average total ${num(o.average_a)}–${num(o.average_b)} · ${s.total.toLocaleString()} submitted card${s.total===1?'':'s'}</p></article><div><table class="fan-round-table"><thead><tr><th>Round</th><th>${esc(b.fighter_a_name)}</th><th>${esc(b.fighter_b_name)}</th><th>Tie</th><th>Avg.</th></tr></thead><tbody>${s.rounds.map(r=>`<tr><td>R${r.round}</td><td>${pct(r.a_pct)}</td><td>${pct(r.b_pct)}</td><td>${pct(r.tie_pct)}</td><td>${num(r.average_a)}–${num(r.average_b)}</td></tr>`).join('')}</tbody></table></div></div>`;
    }else summary='<p class="fan-empty">No fan scorecards have been submitted for this fight yet.</p>';
    if(!s.open){
      const note=b.status==='completed'&&s.scorable_rounds===0?'This fight ended before a completed round could be scored.':'Fan scorecards open only after the official result is confirmed.';
      root.innerHTML=`${summary}<p class="fans-meta">${esc(note)}</p>`;return;
    }
    const mine=new Map((s.mine?.rounds||[]).map(r=>[r.round,`${r.score_a}-${r.score_b}`]));
    const rows=Array.from({length:s.scorable_rounds},(_,i)=>i+1).map(round=>`<div class="fan-score-row"><label for="fan-round-${round}">Round ${round}</label><select id="fan-round-${round}" data-round="${round}" required>${scoreOptions(mine.get(round)||'')}</select></div>`).join('');
    root.innerHTML=`${summary}<form id="fan-score-form" class="fan-score-form"><p class="fans-meta">Submit one complete card per browser. You can update it later; the public aggregate changes with the latest submitted card.</p>${rows}<button class="button primary" type="submit">${s.mine?'Update my fan scorecard':'Submit fan scorecard'}</button><p id="fan-score-feedback" class="fan-feedback" role="status"></p></form>`;
  }
  function render(){renderPrediction();renderScorecards();}
  async function load(){
    const r=await fetch(`/api/fights/${id}/fans`,{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error('Fan consensus unavailable');
    data=await r.json();render();
  }
  async function put(path,body){
    const r=await fetch(`/api/fights/${id}/${path}`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(body),cache:'no-store'});
    const response=await r.json();if(!r.ok)throw new Error(response.error||'Could not save.');data=response;render();
  }
  document.addEventListener('click',async event=>{
    const button=event.target.closest?.('.fan-pick');if(!button||saving)return;
    saving=true;document.querySelectorAll('.fan-pick').forEach(b=>b.disabled=true);
    try{await put('fan-prediction',{pick:button.dataset.pick});const feedback=$('#fan-prediction-feedback');if(feedback)feedback.textContent='Fan pick saved.';}catch(error){const feedback=$('#fan-prediction-feedback');if(feedback)feedback.textContent=error.message||'Could not save your pick.';}finally{saving=false;document.querySelectorAll('.fan-pick').forEach(b=>b.disabled=false);}
  });
  document.addEventListener('submit',async event=>{
    if(event.target?.id!=='fan-score-form')return;event.preventDefault();if(saving)return;
    const selects=[...event.target.querySelectorAll('select[data-round]')];
    if(selects.some(s=>!s.value)){const feedback=$('#fan-score-feedback');if(feedback)feedback.textContent='Score every completed round before submitting.';return;}
    const rounds=selects.map(select=>{const [a,b]=select.value.split('-').map(Number);return {round:Number(select.dataset.round),score_a:a,score_b:b};});
    saving=true;const button=event.target.querySelector('button[type="submit"]');if(button)button.disabled=true;
    try{await put('fan-scorecard',{rounds});const feedback=$('#fan-score-feedback');if(feedback)feedback.textContent='Fan scorecard saved.';}catch(error){const feedback=$('#fan-score-feedback');if(feedback)feedback.textContent=error.message||'Could not save your scorecard.';}finally{saving=false;if(button)button.disabled=false;}
  });
  startAutoRefresh(load,()=>{const f=$('#fan-prediction-feedback');if(f)f.textContent='Fan consensus refresh is temporarily unavailable; the last loaded totals are retained.';},30000);
})();
