import {buildRatings} from './model_v03.mjs';
import {forecast} from './forecast.mjs';
import {fighterContext} from './predictor-context.mjs';
import {matchupVector} from './predictor_v02.mjs';
import {createHash} from 'node:crypto';

export function candidateHistory(pairs,profiles,{start='2018-01-01',end='2026-08-29',progress=()=>{}}={}) {
  const grouped=new Map();
  for(const pair of pairs){const date=pair.red.eventDate;if(date>end)throw new Error('Source extends beyond the declared evaluation end');if(!grouped.has(date))grouped.set(date,[]);grouped.get(date).push(pair);}
  const rows=[],prior=[],lastAppearance=new Map();
  const dates=[...grouped.keys()].sort();
  for(const [i,date] of dates.entries()){
    const today=grouped.get(date);
    if(date>=start){
      const ratings=new Map(buildRatings(prior).ratings.map(r=>[r.fighterId,r]));
      for(const pair of today){
        if(pair.red.noContest || pair.red.won===0.5)continue;
        const a=ratings.get(pair.red.fighterId),b=ratings.get(pair.blue.fighterId);
        const contextA=fighterContext(profiles.get(pair.red.identity),lastAppearance.get(pair.red.fighterId),date);
        const contextB=fighterContext(profiles.get(pair.blue.identity),lastAppearance.get(pair.blue.fighterId),date);
        const key=[date,pair.red.row.event_name,pair.red.fighterId,pair.blue.fighterId,pair.red.row.method,pair.red.row.round,pair.red.row.time].join('|');
        rows.push({id:createHash('sha256').update(key).digest('hex'),date,event:pair.red.row.event_name,
          a:pair.red.fighterId,b:pair.blue.fighterId,won:pair.red.won,weight_class:pair.red.weightClass,
          rated:Boolean(a&&b),min_bouts:Math.min(a?.bouts||0,b?.bouts||0),
          baseline_p:forecast(a,b).probabilityA,x:matchupVector(a,b,contextA,contextB,pair.red.weightClass),
          context:{a:contextA,b:contextB}});
      }
      if(i%25===0)progress({date,rows:rows.length});
    }
    // Update only after every prediction on this date; NC still marks activity.
    for(const pair of today){lastAppearance.set(pair.red.fighterId,date);lastAppearance.set(pair.blue.fighterId,date);}
    prior.push(...today);
  }
  return rows;
}
