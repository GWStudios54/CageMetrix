const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const percent=value=>`${(Number(value)*100).toFixed(1)}%`;
const savedTime=value=>new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
let loaded=false;
function fighter(row,side){
  const f={name:row[`fighter_${side}_name`],slug:row[`fighter_${side}_slug`]};
  return `<a class="forecast-fighter" href="/fighters/${encodeURIComponent(f.slug)}">${fighterMedia.portrait(f)}<span><strong>${escapeHtml(f.name)}</strong><b>${percent(row[`fighter_${side}_probability`])}</b></span></a>`;
}
function resultLabel(row){
  if(row.grade==='pending')return row.event_live?'Awaiting official result':'Locked prediction';
  if(row.grade==='cancelled')return 'Cancelled · excluded';
  const winner=row.winner_id===row.fighter_a_id?row.fighter_a_name:row.winner_id===row.fighter_b_id?row.fighter_b_name:null;
  return `${winner?`${winner} wins`:row.result_method||'Draw / no contest'}${winner&&row.result_method?` · ${row.result_method}`:''} · ${row.grade==='void'?'Excluded from accuracy':row.grade==='correct'?'Correct pick':'Incorrect pick'}`;
}
function fightLink(row){return `/fights/${Number(row.bout_id)}`;}
function confidenceBlurb(row){
  if(row.sample_strength===null||row.sample_strength===undefined)return '';
  const value=Number(row.sample_strength);
  return Number.isFinite(value)?`<small class="muted" title="Based on the weaker fighter's pre-fight sample strength">Model confidence: ${Math.round(value)}%</small>`:'';
}
function fanConsensusBlurb(row){
  const total=Number(row.fan_total||0),href=`${fightLink(row)}#fans-vs-model`;
  if(!total)return `<small><a class="muted" href="${href}">Fan consensus: Be the first to pick →</a></small>`;
  const picks=`${total.toLocaleString()} pick${total===1?'':'s'}`;
  if(!row.fan_consensus_pick)return `<small><a class="muted" href="${href}">Fans: 50/50 · ${picks} →</a></small>`;
  const side=row.fan_consensus_pick,name=side==='a'?row.fighter_a_name:row.fighter_b_name,p=side==='a'?row.fan_a_pct:row.fan_b_pct;
  return `<small><a class="muted" href="${href}">Fans: ${escapeHtml(name)} ${percent(p)} · ${picks} →</a></small>`;
}
async function loadForecasts(){
  const response=await fetch('/api/forecasts?live=1',{cache:'no-store',signal:AbortSignal.timeout(15_000)});
  if(!response.ok)throw new Error('Forecasts unavailable');
  const [payload]=await Promise.all([response.json(),fighterMedia.ready]);
  const {data,summary,meta}=payload;
  loaded=true;
  document.querySelector('#live-accuracy').textContent=summary.accuracy===null?'—':percent(summary.accuracy);
  document.querySelector('#live-record').textContent=`${summary.correct} / ${summary.graded}`;
  document.querySelector('#pending-count').textContent=summary.pending;
  document.querySelector('#accuracy-detail').textContent=summary.graded?`${summary.incorrect} incorrect · Brier ${summary.brier.toFixed(3)}`:'Waiting for the first graded fight';
  document.querySelector('#forecast-coverage').textContent=`Data through ${meta.data?.source_max_date||'unavailable'} · Predictor ${meta.model_version}`;
  const active=data.filter(r=>r.event_live);
  const successes=active.map(r=>r.results_success_at).filter(Boolean).sort();
  const lastCheck=successes[0];
  const delayed=active.length&&(active.some(r=>r.results_error||!r.results_success_at)||!lastCheck||Date.now()-Date.parse(lastCheck)>5*60_000);
  const status=document.querySelector('#live-refresh-status');
  status.classList.toggle('coverage-warning',Boolean(delayed));
  status.textContent=active.length
    ? `${delayed?'Waiting for fresh official results':'Fight-day result checks active'}${lastCheck?` · Updated ${savedTime(lastCheck)}`:''}`
    : 'Results update automatically on fight day.';
  const upcoming=data.filter(r=>r.grade==='pending'||r.event_live);
  const events=new Map();
  for(const row of upcoming){if(!events.has(row.event_slug))events.set(row.event_slug,[]);events.get(row.event_slug).push(row);}
  document.querySelector('#event-cards').innerHTML=[...events.values()].sort((a,b)=>a[0].starts_at.localeCompare(b[0].starts_at)).map(rows=>{
    const event=rows[0];
    return `<article class="event-card"><header><div><div class="eyebrow">${escapeHtml(event.event_date)}${event.event_live?' · FIGHT DAY':''}</div><h2>${escapeHtml(event.event_name)}</h2><span class="muted">${rows.length} saved predictions · Starts ${escapeHtml(savedTime(event.starts_at))}</span></div><a href="${escapeHtml(event.source_url)}" target="_blank" rel="noopener">Official card ↗</a></header>${rows.map(r=>`<div class="forecast-bout"><div class="forecast-matchup">${fighter(r,'a')}<span class="forecast-versus">VS</span>${fighter(r,'b')}</div><div class="probability-bar" aria-hidden="true"><span style="width:${Number(r.fighter_a_probability)*100}%"></span></div><p class="result-label grade-${escapeHtml(r.grade)}">${escapeHtml(resultLabel(r))}</p>${confidenceBlurb(r)}${fanConsensusBlurb(r)}<p><a class="fight-detail-link" href="${fightLink(r)}">Fight details, stats & reasoning →</a></p><div class="forecast-meta"><span>${escapeHtml(r.weight_class)}</span><span>Locked ${escapeHtml(savedTime(r.locked_at))}</span></div></div>`).join('')}</article>`;
  }).join('')||'<p class="ranking-loading">No upcoming predictions saved yet. Cards appear after matchups are confirmed.</p>';
  const history=data.filter(r=>r.grade!=='pending');
  document.querySelector('#prediction-history').innerHTML=history.map(r=>`<div class="prediction-row"><div><a class="fight-detail-link" href="${fightLink(r)}"><strong>${escapeHtml(r.fighter_a_name)} vs ${escapeHtml(r.fighter_b_name)}</strong> →</a><small class="muted"> · ${escapeHtml(r.event_date)} · ${percent(r.fighter_a_probability)} / ${percent(r.fighter_b_probability)}</small></div><strong class="grade-${escapeHtml(r.grade)}">${escapeHtml(resultLabel(r))}</strong></div>`).join('')||'<p class="ranking-loading">The record begins with these locked forecasts. Completed fights will appear here automatically.</p>';
}
startAutoRefresh(loadForecasts,()=>{
  const status=document.querySelector('#live-refresh-status');
  status.classList.add('coverage-warning');
  status.textContent='Connection interrupted. Retrying automatically.';
  if(!loaded){document.querySelector('#event-cards').innerHTML='<p class="ranking-loading">Couldn’t load predictions. Retrying automatically…</p>';document.querySelector('#accuracy-detail').textContent='Record temporarily unavailable';}
});
