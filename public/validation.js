async function loadValidation(){
  const responses=await Promise.all([fetch('/model-validation.json'),fetch('/api/forecasts')]);
  if(responses.some(r=>!r.ok))throw new Error('Unavailable');
  const [report,live]=await Promise.all(responses.map(r=>r.json()));
  const s=live.summary;
  document.querySelector('#prospective-record').textContent=s.graded?`${s.correct} correct out of ${s.graded} graded fights (${(100*s.accuracy).toFixed(1)}%). ${s.pending} predictions await results.`:`No fights graded yet. ${s.pending} predictions are saved. Accuracy will appear after the first completed, decisive fight; historical tests do not add wins to this counter.`;
  document.querySelector('#benchmark-period').textContent=`Evaluation: ${report.evaluation_start} through ${report.source_max_date}. ${report.results.cmr.bouts.toLocaleString()} matched fights; probability conversion trained on ${report.train_bouts.toLocaleString()} earlier fights.`;
  document.querySelector('#benchmark-table').innerHTML=`<table class="validation-table"><thead><tr><th>Model</th><th>Accuracy</th><th>Brier ↓</th><th>Log loss ↓</th></tr></thead><tbody>${[['CMR','cmr'],['Calibrated Elo · forecast baseline','calibrated_elo'],['Standard Elo','standard_elo']].map(([name,key])=>{const m=report.results[key];return `<tr><td>${name}</td><td>${(m.accuracy*100).toFixed(1)}%</td><td>${m.brier.toFixed(4)}</td><td>${m.log_loss.toFixed(4)}</td></tr>`;}).join('')}</tbody></table>`;
  const interval=report.brier_difference_cmr_minus_elo_95_interval;
  document.querySelector('#benchmark-conclusion').textContent=`The 95% event-bootstrap interval for CMR minus Elo Brier score is ${interval[0].toFixed(4)} to ${interval[1].toFixed(4)}. ${interval[0]<=0&&interval[1]>=0?'It spans zero, so this test does not establish a probability-quality difference.':'This is a retrospective comparison; prospective results are still needed.'}`;
}
loadValidation().catch(()=>{document.querySelector('#benchmark-period').textContent='The benchmark is temporarily unavailable. Please refresh to try again.';document.querySelector('#prospective-record').textContent='The live record is temporarily unavailable.';});
