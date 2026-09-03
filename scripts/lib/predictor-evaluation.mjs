export function metrics(rows,key='candidate_p') {
  if(!rows.length)return {bouts:0,accuracy:null,brier:null,log_loss:null};
  for(const row of rows)if(![0,1].includes(row.won)||!Number.isFinite(row[key])||row[key]<0||row[key]>1)throw new Error('Invalid evaluation outcome or probability');
  return {bouts:rows.length,
    accuracy:rows.reduce((s,r)=>s+(r[key]===0.5?0.5:Number((r[key]>0.5)===Boolean(r.won))),0)/rows.length,
    brier:rows.reduce((s,r)=>s+(r[key]-r.won)**2,0)/rows.length,
    log_loss:Math.max(0,-rows.reduce((s,r)=>s+Math.log(Math.max(1e-12,r.won?r[key]:1-r[key])),0)/rows.length)};
}
export function calibration(rows,key='candidate_p') {
  const bins=Array.from({length:10},(_,i)=>({range:`${i*10}-${(i+1)*10}%`,bouts:0,sum_p:0,sum_y:0}));
  for(const r of rows){const bin=bins[Math.min(9,Math.floor(r[key]*10))];bin.bouts++;bin.sum_p+=r[key];bin.sum_y+=r.won;}
  return bins.filter(b=>b.bouts).map(b=>({range:b.range,bouts:b.bouts,mean_predicted:b.sum_p/b.bouts,observed_win_rate:b.sum_y/b.bouts}));
}
export function pairedBrierInterval(rows,{samples=2000,seed=0xc02}={}) {
  if(!rows.length)return null;
  const dates=new Map();
  for(const r of rows){if(!dates.has(r.date))dates.set(r.date,{n:0,delta:0});const g=dates.get(r.date);g.n++;g.delta+=(r.candidate_p-r.won)**2-(r.baseline_p-r.won)**2;}
  const groups=[...dates.values()],draws=[];
  const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<samples;i++){let n=0,sum=0;for(let j=0;j<groups.length;j++){const g=groups[Math.floor(random()*groups.length)];n+=g.n;sum+=g.delta;}draws.push(sum/n);}
  draws.sort((a,b)=>a-b);
  return {low:draws[Math.floor(samples*0.025)],high:draws[Math.ceil(samples*0.975)-1],event_dates:groups.length,samples,method:'Paired event-date cluster percentile bootstrap; candidate minus frozen 0.1 Brier.'};
}
export function coverage(rows) {
  const result={bouts:rows.length,rated_bouts:rows.filter(r=>r.rated).length,fallback_bouts:rows.filter(r=>!r.rated).length};
  for(const [label,key] of [['age','age_years'],['layoff','days_since_ufc_fight'],['reach','reach_cm'],['stance','stance']]){
    result[label]={both_known:rows.filter(r=>r.context.a[key]!=null&&r.context.b[key]!=null).length,one_missing:rows.filter(r=>(r.context.a[key]==null)!==(r.context.b[key]==null)).length,both_missing:rows.filter(r=>r.context.a[key]==null&&r.context.b[key]==null).length};
  }
  result.bouts_with_retrospective_profile_assumption=rows.filter(r=>r.context.a.historical_profile_assumption||r.context.b.historical_profile_assumption).length;
  return result;
}
export function chronologicalSplit(rows) {
  const train=rows.filter(r=>r.rated&&r.date>='2018-01-01'&&r.date<'2022-01-01');
  const validation=rows.filter(r=>r.rated&&r.date>='2022-01-01'&&r.date<'2023-01-01');
  const finalTrain=rows.filter(r=>r.rated&&r.date>='2018-01-01'&&r.date<'2023-01-01');
  const test=rows.filter(r=>r.date>='2023-01-01');
  if(!train.length||!validation.length||!test.some(r=>r.rated))throw new Error('Insufficient chronological training, validation or evaluation data');
  if(new Set(rows.map(r=>r.id)).size!==rows.length)throw new Error('Duplicate evaluation fight identity');
  return {train,validation,finalTrain,test};
}
export function chooseTrial(trials) {
  if(!trials.length||trials.some(t=>!Number.isFinite(t.metrics.log_loss)||!Number.isFinite(t.metrics.brier)))throw new Error('Invalid tuning results');
  return [...trials].sort((a,b)=>a.metrics.log_loss-b.metrics.log_loss||a.metrics.brier-b.metrics.brier||a.experiment.localeCompare(b.experiment)||a.lambda-b.lambda)[0];
}
