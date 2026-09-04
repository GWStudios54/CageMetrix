(() => {
  const labels={
    'competitive strength':'Competitive-strength signals',
    'overall technical profile':'Technical-profile signals',
    'striking matchup':'Striking-matchup signals',
    'wrestling and grappling matchup':'Wrestling & grappling signals',
    'pace and finishing profile':'Pace & finishing signals',
    'recent form and schedule':'Recent-form & schedule signals',
    'ufc experience and evidence':'UFC sample & uncertainty adjustment',
    'ufc experience and sample':'UFC sample & uncertainty adjustment',
    'pre-ufc resume':'Pre-UFC résumé signals'
  };
  function payload(){
    try{return JSON.parse(document.querySelector('#fight-data')?.textContent||'null');}catch{return null;}
  }
  function modelLabel(p){
    if(!p)return 'CageMetrix Predictor';
    if(p.model_name==='CageMetrix Elo Baseline')return 'Archived Elo baseline';
    return p.model_version?`Predictor ${p.model_version}`:'CageMetrix Predictor';
  }
  function fixProbabilityLabel(data){
    const note=document.querySelector('.locked-note');
    if(!note||!data?.prediction)return;
    const marker=' · Locked ';
    const i=note.textContent.indexOf(marker);
    if(i>=0)note.textContent=`${modelLabel(data.prediction)}${note.textContent.slice(i)}`;
  }
  function fixDrivers(data){
    const root=document.querySelector('#fight-drivers');
    if(!root)return;
    for(const card of root.querySelectorAll('.driver')){
      const strong=card.querySelector('.driver-heading strong');
      const span=card.querySelector('.driver-heading span');
      if(!strong||!span)continue;
      const raw=strong.textContent.trim().toLowerCase();
      strong.textContent=labels[raw]||strong.textContent;
      const fighter=span.textContent.replace(/\s+edge$/i,'').trim();
      span.textContent=fighter?`Model contribution favors ${fighter}`:'Model contribution';
      if(raw==='ufc experience and evidence'||raw==='ufc experience and sample'){
        let explainer=card.querySelector('.driver-explainer');
        if(!explainer){explainer=document.createElement('small');explainer.className='driver-explainer muted';card.appendChild(explainer);}
        const f=data?.prediction?.snapshot?.fighters;
        const a=f?.a?.rating?.bouts,b=f?.b?.rating?.bouts;
        const sample=Number.isFinite(Number(a))&&Number.isFinite(Number(b))?` ${Number(a)} vs ${Number(b)} rated UFC bouts.`:'';
        explainer.textContent=`${sample} This is the fitted sample-size/uncertainty adjustment, not a claim that the favored fighter has more UFC experience.`.trim();
      }
    }
  }
  function apply(){const data=payload();fixProbabilityLabel(data);fixDrivers(data);}
  apply();
})();