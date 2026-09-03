(() => {
  const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pct=v=>`${(v*100).toFixed(1)}%`,num=(v,d=1)=>typeof v==='number'&&Number.isFinite(v)?v.toFixed(d):'—';
  const date=v=>v?new Date(v).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}):'Unavailable';
  const fields=[['cmr','CMR'],['technical','Technical'],['resume','Résumé'],['strikingOffense','Striking offense'],['strikingDefense','Striking defense'],['wrestlingOffense','Wrestling offense'],['wrestlingDefense','Wrestling defense'],['grappling','Grappling'],['pace','Pace'],['finishing','Finishing'],['strengthOfSchedule','Strength of schedule'],['recentForm','Recent form'],['confidence','Sample strength'],['eloRaw','Elo'],['bouts','Rated UFC bouts'],['minutes','Rated minutes']];
  let payload=null,initialized=false,who=null,token='',revision=0,saving=false,dirty=false;
  const id=location.pathname.match(/^\/fights\/([1-9]\d*)\/?$/)?.[1];
  const query=new URLSearchParams(location.search),selection=query.get('prediction');
  const api=`/api/fights/${id}${selection?`?prediction=${encodeURIComponent(selection)}`:''}`;
  const names=()=>payload.prediction.snapshot?.available?payload.prediction.snapshot.fighters:{a:{name:payload.bout.fighter_a_name,slug:payload.bout.fighter_a_slug},b:{name:payload.bout.fighter_b_name,slug:payload.bout.fighter_b_slug}};
  function renderSnapshot(){
    const {bout:b,prediction:p}=payload,s=p.snapshot,f=names();
    $('#fight-title').textContent=`${f.a.name} vs ${f.b.name}`;
    $('#fight-event').textContent=b.event_name;
    $('#fight-context').textContent=`${b.weight_class} · ${b.scheduled_rounds} rounds · ${date(b.starts_at)}`;
    const model=p.model_name==='CageMetrix Elo Baseline'?'Archived Elo baseline':'Predictor 0.1';
    $('#fight-probability').innerHTML=`<div class="fight-odds">${['a','b'].map(side=>`<div class="fight-corner"><a href="/fighters/${encodeURIComponent(f[side].slug)}">${esc(f[side].name)} ↗</a><strong>${pct(p[`fighter_${side}_probability`])}</strong><small>Locked win probability</small></div>`).join('')}</div><div class="fight-probability-bar" aria-hidden="true"><span style="width:${p.fighter_a_probability*100}%"></span></div><p class="locked-note">${esc(model)} · Locked ${esc(date(p.locked_at))}. This probability stays on the record.</p>`;
    if(!s?.available){
      $('#snapshot-note').textContent=s?.reason||'The original pre-fight snapshot is unavailable. Current ratings are not substituted.';
      $('#fight-stats').innerHTML='<p class="warning">Pre-fight comparison unavailable for this archived prediction.</p>';
      $('#fight-drivers').innerHTML=p.saved_drivers?.length?driverHtml(p.saved_drivers,f):'<p class="muted">No verified model explanation was retained for this prediction.</p>';
    }else{
      $('#snapshot-note').textContent=`Pre-fight snapshot · Data through ${s.source_max_date} · CMR ${s.cmr_version}`;
      $('#fight-stats').innerHTML=`<table class="comparison-table"><caption class="sr-only">Preserved pre-fight statistics, compared side by side</caption><thead><tr><th scope="col">CageMetrix metric</th><th scope="col">${esc(f.a.name)}</th><th scope="col">${esc(f.b.name)}</th></tr></thead><tbody>${fields.map(([key,label])=>`<tr class="${key==='cmr'?'cmr-row':''}"><th scope="row">${label}</th>${['a','b'].map(side=>`<td>${num(f[side].rating?.[key],key==='bouts'?0:1)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      const fallback=s.model_used==='elo_fallback'||s.model_used==='elo_baseline';
      const intro=fallback?(s.model_used==='elo_fallback'?'Neutral-start Elo fallback because at least one fighter was unrated.':'This archived prediction used the Elo baseline.'):'The strongest matchup factors behind the locked prediction:';
      const drivers=s.drivers||[];
      $('#fight-drivers').innerHTML=`<p class="muted">${esc(intro)}</p>${drivers.length?driverHtml(drivers,f):'<p>The measured inputs produced an even matchup.</p>'}`;
    }
    const archive=payload.predictions.filter(x=>x.id!==p.id);
    $('#prediction-archive').hidden=!archive.length;
    $('#prediction-archive').innerHTML=`<h2>Other saved predictions for this fight</h2><p>Each saved model stays separate.</p>${archive.map(x=>`<a href="/fights/${id}?prediction=${x.id}">${esc(x.model_name)} ${esc(x.model_version)} · ${pct(x.fighter_a_probability)} / ${pct(x.fighter_b_probability)} →</a>`).join('')}`;
  }
  function driverHtml(drivers,f){
    return drivers.map(d=>`<article class="driver"><div class="driver-heading"><strong>${esc(d.label)}</strong><span>${esc(f[d.side]?.name||'')} edge</span></div></article>`).join('');
  }
  function renderResult(){
    const b=payload.bout,p=payload.prediction,f=names(),status=$('#fight-status');
    $('#fight-context').textContent=`${b.weight_class} · ${b.scheduled_rounds} rounds · ${date(b.starts_at)}`;
    status.textContent=b.status==='completed'?'Completed':b.status==='cancelled'?'Cancelled':b.status==='live'?'Live':b.event_live?'Event live':'Scheduled';
    status.className=`status-badge ${b.status==='completed'?'completed':b.event_live?'live':''}`;
    const official=payload.official_observation?.source_url||b.source_url;
    const officialLink=official&&/^https:\/\/(www\.ufc\.com|d29dxerjsp82wz\.cloudfront\.net)\//.test(official)?`<a class="text-link" href="${esc(official)}" target="_blank" rel="noopener">Official source ↗</a>`:'';
    const winner=b.winner_id===b.fighter_a_id?f.a.name:b.winner_id===b.fighter_b_id?f.b.name:null;
    const grade={correct:'Correct pick',incorrect:'Incorrect pick',void:'Excluded from accuracy',cancelled:'Cancelled · excluded',pending:'Awaiting official result'}[p.grade];
    if(b.status==='completed')$('#fight-result').innerHTML=`<div class="official-result"><strong>${esc(winner?`${winner} wins`:'Draw / no contest')}</strong>${esc(b.result_method||'Result confirmed')}${b.result_round?` · Round ${b.result_round}`:''}${b.result_time_seconds!==null?` · ${Math.floor(b.result_time_seconds/60)}:${String(b.result_time_seconds%60).padStart(2,'0')}`:''}<br><span class="grade-${p.grade}">${esc(grade)}</span> · Original prediction retained. ${officialLink}</div>`;
    else if(b.status==='cancelled')$('#fight-result').innerHTML='<div class="replacement-note">This matchup was cancelled. Its original prediction and pre-fight stats remain on the record and are excluded from accuracy.</div>';
    else $('#fight-result').innerHTML=`<p class="muted">${b.event_live?'The event is live. This fight is awaiting a confirmed final result.':'The prediction is locked. Official results will appear here during the event.'} ${officialLink}</p>`;
    $('#fight-related').innerHTML=payload.related.length?`<div class="replacement-note">Other saved matchups for this card slot:${payload.related.map(r=>` <a href="/fights/${r.id}">${esc(r.fighter_a_name)} vs ${esc(r.fighter_b_name)} (${esc(r.status)})</a>`).join(' · ')}. Each matchup keeps its own prediction and scorecards.</div>`:'';
    const stale=b.event_live&&(b.results_error||!b.results_success_at||Date.now()-Date.parse(b.results_success_at)>300000);
    $('#fight-message').textContent=stale?'Official results are delayed. The last confirmed result is retained while checks retry.':'';
    $('#fight-message').classList.toggle('warning',Boolean(stale));
    const selected=$('#contributor-select').value;
    $('#contributor-select').innerHTML=payload.commentary.length?payload.commentary.map(c=>`<option value="${c.contributor_id}">${esc(c.display_name)}</option>`).join(''):'<option value="">No published contributors yet</option>';
    if(payload.commentary.some(c=>String(c.contributor_id)===selected))$('#contributor-select').value=selected;
    renderCommentary();
  }
  function renderCommentary(){
    const card=payload.commentary.find(c=>String(c.contributor_id)===$('#contributor-select').value),b=payload.bout,f=names();
    const rounds=Array.from({length:5},(_,i)=>i+1).map(round=>{
      const entry=card?.rounds.find(r=>r.round===round);
      const unplayed=round>b.scheduled_rounds||b.status==='cancelled'||b.status==='completed'&&b.result_round&&round>b.result_round;
      const text=entry?.text||(unplayed?'Not contested.':'No commentary published for this round.');
      return `<article class="round-card"><h3>Round ${round}</h3><p class="${entry?.text?'':'muted'}">${esc(text)}</p><div class="round-score">${entry?.score_a!==null&&entry?.score_a!==undefined?`${entry.score_a} – ${entry.score_b}`:'—'}<small>${esc(f.a.name)} / ${esc(f.b.name)}</small></div></article>`;
    }).join('');
    const total=card?.totals;
    const totalLabel=total?.scored_rounds===b.scheduled_rounds?'total':'subtotal';
    $('#contributor-card').innerHTML=`${card?`<p><strong>${esc(card.display_name)}</strong>${card.bio?` · ${esc(card.bio)}`:''}</p>`:'<p class="empty-card">No contributor card yet. Round commentary and scores will appear here once published.</p>'}<p class="muted">Score order: ${esc(f.a.name)} / ${esc(f.b.name)}</p>${rounds}<article class="round-card"><h3>Final Thoughts</h3><p class="${card?.final_thoughts?'':'muted'}">${esc(card?.final_thoughts||'No final thoughts published yet.')}</p></article><div class="card-total">${total?.scored_rounds?`Contributor ${totalLabel}: ${total.a} – ${total.b} · ${total.scored_rounds} round${total.scored_rounds===1?'':'s'} scored`:'No scored rounds yet'}</div>`;
  }
  const feedback=message=>{$('#editor-feedback').textContent=message;};
  function loadEditor(){
    const existing=payload.commentary.find(c=>c.contributor_id===who.id),b=payload.bout,f=names();
    revision=existing?.revision||0;dirty=false;
    $('#editor-name').textContent=`Publishing as ${who.display_name}`;
    $('#round-editors').innerHTML=Array.from({length:5},(_,i)=>i+1).map(round=>{
      const r=existing?.rounds.find(x=>x.round===round),disabled=round>b.scheduled_rounds||b.status==='cancelled'||Date.now()<Date.parse(b.starts_at)||b.status==='completed'&&b.result_round&&round>b.result_round;
      return `<fieldset class="editor-round" data-round="${round}" ${disabled?'disabled':''}><legend>Round ${round}${round>b.scheduled_rounds?' · Not scheduled':''}</legend><label for="round-text-${round}">Commentary</label><textarea id="round-text-${round}" rows="3" maxlength="4000">${esc(r?.text||'')}</textarea><div class="editor-score">${['a','b'].map(side=>`<label for="score-${round}-${side}">${esc(f[side].name)}<select id="score-${round}-${side}"><option value="">Unscored</option>${[10,9,8,7].map(score=>`<option value="${score}" ${r?.[`score_${side}`]===score?'selected':''}>${score}</option>`).join('')}</select></label>`).join('')}</div></fieldset>`;
    }).join('');
    $('#final-thoughts').value=existing?.final_thoughts||'';
    $('#scorecard-editor').hidden=false;$('#contributor-connect').hidden=true;updateTotal();
  }
  function editorCard(){
    const rounds=[...document.querySelectorAll('.editor-round')].filter(el=>!el.disabled).map(el=>{
      const round=Number(el.dataset.round),read=side=>$(`#score-${round}-${side}`).value;
      return {round,text:$(`#round-text-${round}`).value,score_a:read('a')===''?null:Number(read('a')),score_b:read('b')===''?null:Number(read('b'))};
    }).filter(r=>r.text.trim()||r.score_a!==null||r.score_b!==null);
    return {revision,rounds,final_thoughts:$('#final-thoughts').value};
  }
  function updateTotal(){const rounds=editorCard().rounds.filter(r=>r.score_a!==null&&r.score_b!==null);$('#editor-total').textContent=rounds.length?`Subtotal: ${rounds.reduce((n,r)=>n+r.score_a,0)} – ${rounds.reduce((n,r)=>n+r.score_b,0)} · ${rounds.length} rounds scored`:'No scored rounds';}
  $('#contributor-select').addEventListener('change',renderCommentary);
  $('#scorecard-editor').addEventListener('input',()=>{dirty=true;updateTotal();});
  $('#reload-card').addEventListener('click',()=>{loadEditor();feedback('Loaded the latest published card.');});
  $('#disconnect').addEventListener('click',()=>{token='';who=null;dirty=false;$('#scorecard-editor').hidden=true;$('#contributor-connect').hidden=false;$('#round-editors').innerHTML='';$('#final-thoughts').value='';feedback('Disconnected.');});
  $('#contributor-connect').addEventListener('submit',async event=>{event.preventDefault();
    const candidate=$('#publishing-key').value.trim();$('#publishing-key').value='';
    try{const r=await fetch('/api/contributors/me',{headers:{authorization:`Bearer ${candidate}`},cache:'no-store'});const body=await r.json();if(!r.ok)throw new Error(body.error);token=candidate;who=body;loadEditor();feedback('Connected. Published cards are visible to everyone.');}catch(e){feedback(e.message||'Could not connect.');}
  });
  $('#scorecard-editor').addEventListener('submit',async event=>{event.preventDefault();if(saving)return;saving=true;
    const button=$('#scorecard-editor button[type="submit"]');button.disabled=true;
    try{
      const r=await fetch(`/api/fights/${id}/commentary`,{method:'PUT',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify(editorCard())});
      const body=await r.json();if(!r.ok)throw new Error(body.error);
      revision=body.revision;payload.commentary=body.commentary;dirty=false;renderResult();$('#contributor-select').value=String(who.id);renderCommentary();feedback('Card published.');
    }catch(e){feedback(e.message||'Could not publish. Your edits are still here.');}finally{saving=false;button.disabled=false;}
  });
  function render(data){payload=data;if(!initialized){renderSnapshot();initialized=true;}renderResult();if(who&&dirty&&payload.commentary.find(c=>c.contributor_id===who.id)?.revision>revision)feedback('A newer card has been published. Your unsaved edits are retained; reload the published card before saving.');}
  try{const initial=JSON.parse($('#fight-data').textContent);if(initial)render(initial);}catch{}
  if(!id){$('#fight-message').textContent='Open a fight from the Predictions page.';return;}
  startAutoRefresh(async()=>{const r=await fetch(api,{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error('Fight unavailable');render(await r.json());},()=>{$('#fight-message').textContent='Connection interrupted. The last loaded prediction and results are retained; retrying automatically.';$('#fight-message').classList.add('warning');});
})();
