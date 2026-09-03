let benchmark;
async function loadValidation(){
  const response=await fetch('/api/forecasts?live=1',{cache:'no-store',signal:AbortSignal.timeout(15_000)});
  if(!response.ok)throw new Error('Unavailable');
  const live=await response.json();
  if(!benchmark){const r=await fetch('/predictor-validation.json');if(!r.ok)throw new Error('Unavailable');benchmark=await r.json();}
  const report=benchmark;
  document.querySelector('#live-record-status').textContent='Refreshes every 30 seconds during your visit.';
  const s=live.summary;
  document.querySelector('#prospective-record').textContent=s.graded?`${s.correct} correct out of ${s.graded} graded fights (${(100*s.accuracy).toFixed(1)}%). ${s.pending} predictions await results.`:`Predictor 0.1 has no graded live fights yet. ${s.pending} predictions are saved. Historical tests do not add wins to this counter.`;
  document.querySelector('#benchmark-period').textContent=`Evaluation: ${report.evaluation_start} through ${report.source_max_date}. ${report.results.predictor_v01.bouts.toLocaleString()} matched fights; Predictor 0.1 was fitted on ${report.final_train_bouts_2018_2022.toLocaleString()} earlier fights through ${report.training_end}.`;
  document.querySelector('#benchmark-table').innerHTML=`<table class="validation-table"><thead><tr><th>Model</th><th>Accuracy</th><th>Brier ↓</th><th>Log loss ↓</th></tr></thead><tbody>${[['Predictor 0.1','predictor_v01'],['Calibrated Elo · old baseline','calibrated_elo'],['CMR alone','calibrated_cmr']].map(([name,key])=>{const m=report.results[key];return `<tr><td>${name}</td><td>${(m.accuracy*100).toFixed(1)}%</td><td>${m.brier.toFixed(4)}</td><td>${m.log_loss.toFixed(4)}</td></tr>`;}).join('')}</tbody></table>`;
  const interval=report.predictor_minus_elo_brier_95_interval;
  document.querySelector('#benchmark-conclusion').textContent=`The 95% event-bootstrap interval for Predictor 0.1 minus Elo Brier score is ${interval[0].toFixed(4)} to ${interval[1].toFixed(4)}. The full interval is below zero, so Predictor 0.1 had lower Brier error than Elo in this retrospective holdout. The live prospective record remains a separate test.`;
}
startAutoRefresh(loadValidation,()=>{document.querySelector('#live-record-status').textContent='Connection interrupted. Retrying automatically; displayed results may be out of date.';});
