import { writeFileSync, mkdirSync } from 'node:fs';
import { parseEspnTechnicalStats } from './lib/espn-mma.mjs';

const samples = [
  { league:'bellator', event:'600044095', competition:'401698289', athlete:'4878438' },
  { league:'bellator', event:'600044095', competition:'401698289', athlete:'5085291' },
  { league:'pfl', event:'600044159', competition:null, athlete:null }
];
const CORE='https://sports.core.api.espn.com/v2/sports/mma';
const SITE='https://site.api.espn.com/apis/site/v2/sports/mma';
mkdirSync('.cache/espn-mma-validation',{recursive:true});

async function get(url){
  const response=await fetch(url,{headers:{accept:'application/json','user-agent':'CageMetrix ESPN diagnostics/1.0'},signal:AbortSignal.timeout(20000)});
  const text=await response.text();
  let json=null; try{json=text?JSON.parse(text):null}catch{}
  return {url,status:response.status,ok:response.ok,json,text:text.slice(0,500)};
}
function shape(value,depth=0){
  if(value===null||value===undefined)return value;
  if(depth>=3)return Array.isArray(value)?`array(${value.length})`:typeof value;
  if(Array.isArray(value))return {type:'array',length:value.length,sample:value.slice(0,2).map(v=>shape(v,depth+1))};
  if(typeof value!=='object')return typeof value;
  const out={}; for(const key of Object.keys(value).slice(0,40))out[key]=shape(value[key],depth+1); return out;
}
function findStats(node,path='$',out=[]){
  if(!node||typeof node!=='object'||out.length>=40)return out;
  if(Array.isArray(node)){for(let i=0;i<Math.min(node.length,50);i++)findStats(node[i],`${path}[${i}]`,out);return out;}
  const keys=Object.keys(node);
  if(keys.some(k=>/stat|strike|takedown|control|knockdown|submission/i.test(k)))out.push({path,keys:keys.filter(k=>/stat|strike|takedown|control|knockdown|submission/i.test(k)).slice(0,30)});
  for(const key of keys.slice(0,80))findStats(node[key],`${path}.${key}`,out);
  return out;
}

const report=[];
for(const sample of samples){
  if(!sample.competition)continue;
  const urls=[
    `${CORE}/leagues/${sample.league}/events/${sample.event}/competitions/${sample.competition}`,
    `${CORE}/leagues/${sample.league}/events/${sample.event}/competitions/${sample.competition}/competitors/${sample.athlete}/statistics`,
    `${SITE}/${sample.league}/summary?event=${sample.event}`,
    `https://cdn.espn.com/core/mma/game?xhr=1&gameId=${sample.event}`
  ];
  for(const url of urls){
    const response=await get(url);
    report.push({sample,url,status:response.status,shape:shape(response.json),stat_paths:findStats(response.json),parser:parseEspnTechnicalStats(response.json),text_prefix:response.text});
    console.log(response.status,url);
  }
}
writeFileSync('.cache/espn-mma-validation/source-diagnostics.json',JSON.stringify(report,null,2)+'\n');
