(() => {
  const el=document.querySelector('#fan-record');if(!el)return;
  const pct=v=>typeof v==='number'&&Number.isFinite(v)?`${(v*100).toFixed(1)}%`:'—';
  const num=v=>typeof v==='number'&&Number.isFinite(v)?v.toFixed(4):'—';
  async function load(){
    const r=await fetch('/api/fans/record',{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error('Unavailable');
    const s=await r.json();
    if(!s.decisive_fights){
      el.innerHTML=`<p class="benchmark-note">Fans vs. Model has no graded fights yet. ${s.total_picks.toLocaleString()} fan pick${s.total_picks===1?' is':'s are'} saved across ${s.tracked_fights.toLocaleString()} fight${s.tracked_fights===1?'':'s'}.</p><p class="benchmark-note">${s.policy}</p>`;return;
    }
    el.innerHTML=`<table class="validation-table"><thead><tr><th>Same fan-voted fights</th><th>Accuracy</th><th>Brier ↓</th><th>Graded picks</th></tr></thead><tbody><tr><td>CageMetrix Predictor 0.1</td><td>${pct(s.model_same_fights.accuracy)}</td><td>${num(s.model_same_fights.brier)}</td><td>${s.model_same_fights.graded}</td></tr><tr><td>Fan Consensus</td><td>${pct(s.fan.accuracy)}</td><td>${num(s.fan.brier)}</td><td>${s.fan.graded}</td></tr></tbody></table><p class="benchmark-note">${s.total_picks.toLocaleString()} fan picks across ${s.tracked_fights.toLocaleString()} fights; ${s.decisive_fights.toLocaleString()} decisive fan-voted fights are in this comparison. ${s.policy}</p>`;
  }
  startAutoRefresh(load,()=>{el.innerHTML='<p class="benchmark-note">Fan consensus record is temporarily unavailable. Retrying automatically.</p>';},30000);
})();
