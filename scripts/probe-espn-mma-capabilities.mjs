import { mkdirSync, writeFileSync } from 'node:fs';

const samples=[
  {label:'ufc-control',league:'ufc',event:'600051442',competition:'401737005',athletes:['4423876']},
  {label:'bellator',league:'bellator',event:'600044095',competition:'401698289',athletes:['4878438','5085291']}
];
const base='https://sports.core.api.espn.com/v2/sports/mma/leagues';
mkdirSync('.cache/espn-mma-validation',{recursive:true});
async function get(url){
  const response=await fetch(url,{headers:{accept:'application/json','user-agent':'CageMetrix ESPN capability probe/1.0'},signal:AbortSignal.timeout(20000)});
  const text=await response.text(); let json=null; try{json=text?JSON.parse(text):null}catch{}
  return {status:response.status,json,text:text.slice(0,1000)};
}
function useful(node,path='$',out=[]){
  if(!node||typeof node!=='object'||out.length>=100)return out;
  if(Array.isArray(node)){for(let i=0;i<Math.min(node.length,100);i++)useful(node[i],`${path}[${i}]`,out);return out;}
  const keys=Object.keys(node);
  const hit=keys.filter(k=>/stat|strike|takedown|control|knockdown|submission|play|score/i.test(k));
  if(hit.length)out.push({path,keys:hit.slice(0,30)});
  for(const key of keys.slice(0,100))useful(node[key],`${path}.${key}`,out);
  return out;
}
const report=[];
for(const s of samples){
  const root=`${base}/${s.league}/events/${s.event}/competitions/${s.competition}`;
  const comp=await get(root);
  report.push({sample:s.label,resource:'competition',url:root,status:comp.status,statsSource:comp.json?.statsSource,boxscoreSource:comp.json?.boxscoreSource,playByPlaySource:comp.json?.playByPlaySource,summaryAvailable:comp.json?.summaryAvailable,boxscoreAvailable:comp.json?.boxscoreAvailable,playByPlayAvailable:comp.json?.playByPlayAvailable,paths:useful(comp.json)});
  for(const resource of ['plays','status','officials']){
    const url=`${root}/${resource}`; const r=await get(url);
    report.push({sample:s.label,resource,url,status:r.status,keys:r.json&&typeof r.json==='object'?Object.keys(r.json).slice(0,30):[],paths:useful(r.json),text:r.status===200?undefined:r.text});
  }
  for(const athlete of s.athletes){
    for(const resource of ['statistics','linescores']){
      const url=`${root}/competitors/${athlete}/${resource}`; const r=await get(url);
      report.push({sample:s.label,athlete,resource,url,status:r.status,keys:r.json&&typeof r.json==='object'?Object.keys(r.json).slice(0,30):[],paths:useful(r.json),text:r.status===200?undefined:r.text});
    }
  }
}
writeFileSync('.cache/espn-mma-validation/capabilities.json',JSON.stringify(report,null,2)+'\n');
for(const row of report) console.log(`${row.sample} ${row.resource}${row.athlete?` ${row.athlete}`:''}: ${row.status}`);
