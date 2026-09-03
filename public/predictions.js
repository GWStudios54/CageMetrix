const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const percent=value=>`${(Number(value)*100).toFixed(1)}%`;
const savedTime=value=>new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
function fighter(row, side) {
  const f={name:row[`fighter_${side}_name`],slug:row[`fighter_${side}_slug`]};
  return `<a class="forecast-fighter" href="/fighters/${encodeURIComponent(f.slug)}">${fighterMedia.portrait(f)}<span><strong>${escapeHtml(f.name)}</strong><b>${percent(row[`fighter_${side}_probability`])}</b></span></a>`;
}
async function loadForecasts() {
  const response=await fetch('/api/forecasts');
  if(!response.ok)throw new Error('Forecasts unavailable');
  const [payload]=await Promise.all([response.json(),fighterMedia.ready]);
  const {data,summary,meta}=payload;
  document.querySelector('#live-accuracy').textContent=summary.accuracy===null?'—':percent(summary.accuracy);
  document.querySelector('#live-record').textContent=`${summary.correct} / ${summary.graded}`;
  document.querySelector('#pending-count').textContent=summary.pending;
  document.querySelector('#accuracy-detail').textContent=summary.graded?`${summary.incorrect} incorrect · Brier ${summary.brier.toFixed(3)}`:'Waiting for the first graded fight';
  document.querySelector('#forecast-coverage').textContent=`Rating data through ${meta.data?.source_max_date||'unavailable'} · Forecast model v${meta.model_version}`;
  const upcoming=data.filter(r=>r.grade==='pending');
  const events=new Map();
  for(const row of upcoming){if(!events.has(row.event_slug))events.set(row.event_slug,[]);events.get(row.event_slug).push(row);}
  document.querySelector('#event-cards').innerHTML=[...events.values()].sort((a,b)=>a[0].starts_at.localeCompare(b[0].starts_at)).map(rows=>{
    const event=rows[0];
    return `<article class="event-card"><header><div><div class="eyebrow">${escapeHtml(event.event_date)}</div><h2>${escapeHtml(event.event_name)}</h2><span class="muted">${rows.length} saved predictions · Starts ${escapeHtml(savedTime(event.starts_at))}</span></div><a href="${escapeHtml(event.source_url)}" target="_blank" rel="noopener">Official card ↗</a></header>${rows.map(r=>`<div class="forecast-bout"><div class="forecast-matchup">${fighter(r,'a')}<span class="forecast-versus">VS</span>${fighter(r,'b')}</div><div class="probability-bar" aria-hidden="true"><span style="width:${Number(r.fighter_a_probability)*100}%"></span></div><div class="forecast-meta"><span>${escapeHtml(r.weight_class)}${r.notes?.startsWith('Limited')?' · Limited UFC sample':''}</span><span>Locked ${escapeHtml(savedTime(r.locked_at))}</span></div></div>`).join('')}</article>`;
  }).join('')||'<p class="ranking-loading">No upcoming predictions saved yet. Cards appear after matchups are confirmed.</p>';
  const history=data.filter(r=>r.grade!=='pending');
  document.querySelector('#prediction-history').innerHTML=history.map(r=>`<div class="prediction-row"><div><strong>${escapeHtml(r.fighter_a_name)} vs ${escapeHtml(r.fighter_b_name)}</strong><small class="muted"> · ${escapeHtml(r.event_date)} · ${percent(r.fighter_a_probability)} / ${percent(r.fighter_b_probability)}</small></div><strong class="grade-${escapeHtml(r.grade)}">${escapeHtml(r.grade)}</strong></div>`).join('')||'<p class="ranking-loading">The record begins with these locked forecasts. Completed fights will appear here automatically.</p>';
}
loadForecasts().catch(()=>{document.querySelector('#event-cards').innerHTML='<p class="ranking-loading">Couldn’t load predictions. Please refresh to try again.</p>';document.querySelector('#accuracy-detail').textContent='Record temporarily unavailable';});
