import {JSDOM} from 'jsdom';

const clean=value=>String(value??'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
const nameKey=value=>clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-+|-+$/g,'');
const reserved=/\b(?:fight\s*card|main\s*card|prelims?|tickets?|watch|stream|event|arena|stadium|championships?|promotion|schedule|results?|live|rounds?|weigh-?ins?)\b/i;
const dateish=/\b(?:20\d{2}|\d{1,2}:\d{2}|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;
const pairSeparator=/\s+(?:vs\.?|versus|v\.?|×)\s+/i;
const WEIGHTS=['Atomweight','Strawweight','Flyweight','Bantamweight','Featherweight','Lightweight','Welterweight','Middleweight','Light Heavyweight','Heavyweight','Super Heavyweight','Catchweight'];

function validName(value){
  const name=clean(value).replace(/^(?:main event|co-main event|mma)\s*[:：-]?\s*/i,'').replace(/^#\d+\s*/,'').trim();
  if(name.length<2||name.length>70||reserved.test(name)||dateish.test(name)||/\d/.test(name))return null;
  if((name.match(/\p{L}/gu)||[]).length<2)return null;
  if(name.split(/\s+/).length>8)return null;
  return name;
}
function boutKey(a,b){return [nameKey(a),nameKey(b)].sort().join('--');}
function weightClass(context){const text=clean(context);return WEIGHTS.find(weight=>new RegExp(`\\b${weight.replace(' ','\\s+')}\\b`,'i').test(text))||null;}
function isMmaContext(sourceSlug,context){return sourceSlug!=='one'||/\bMMA\b|mixed martial arts/i.test(clean(context));}
function namesFromEntity(value){
  const list=Array.isArray(value)?value:[value];
  return list.map(item=>typeof item==='string'?item:item?.name).map(validName).filter(Boolean);
}
function pairFromText(text){
  const raw=clean(text);if(!pairSeparator.test(raw))return null;
  const parts=raw.split(pairSeparator);if(parts.length!==2)return null;
  const a=validName(parts[0]),b=validName(parts[1]);return a&&b?[a,b]:null;
}
function add(out,seen,a,b,context,sourceUrl){
  const aa=validName(a),bb=validName(b);if(!aa||!bb||nameKey(aa)===nameKey(bb))return;
  const key=boutKey(aa,bb);if(!key||seen.has(key))return;
  seen.add(key);
  out.push({boutKey:key,fighterAName:aa,fighterBName:bb,weightClass:weightClass(context),discipline:'MMA',titleFight:/\b(?:title|championship|belt)\b/i.test(clean(context)),status:'scheduled',sourceUrl});
}
function walkJson(node,visit){
  if(Array.isArray(node)){for(const item of node)walkJson(item,visit);return;}
  if(!node||typeof node!=='object')return;
  visit(node);for(const value of Object.values(node))walkJson(value,visit);
}

export function parseGlobalEventBouts(html,{sourceSlug='',sourceUrl=''}={}){
  const doc=new JSDOM(String(html||'')).window.document;
  const out=[],seen=new Set();

  for(const script of doc.querySelectorAll('script[type="application/ld+json"]')){
    let parsed;try{parsed=JSON.parse(script.textContent||'null')}catch{continue;}
    walkJson(parsed,node=>{
      const context=JSON.stringify(node);
      if(!isMmaContext(sourceSlug,context))return;
      const type=Array.isArray(node['@type'])?node['@type'].join(' '):String(node['@type']||'');
      if(!/SportsEvent|Event/i.test(type))return;
      const competitors=namesFromEntity(node.competitor);
      const performers=competitors.length>=2?[]:namesFromEntity(node.performer);
      const names=competitors.length>=2?competitors:performers;
      if(names.length===2)add(out,seen,names[0],names[1],context,sourceUrl);
      else if(typeof node.name==='string'){
        const pair=pairFromText(node.name);if(pair)add(out,seen,pair[0],pair[1],context,sourceUrl);
      }
    });
  }

  const selectors='tr,li,article,[class*="fight" i],[class*="bout" i],[class*="match" i]';
  for(const element of doc.querySelectorAll(selectors)){
    const text=clean(element.textContent);if(!text||text.length>500||!pairSeparator.test(text)||!isMmaContext(sourceSlug,text))continue;
    const anchors=[...element.querySelectorAll('a')].map(anchor=>validName(anchor.textContent)).filter(Boolean);
    if(anchors.length===2){add(out,seen,anchors[0],anchors[1],text,sourceUrl);continue;}
    const pair=pairFromText(text);if(pair)add(out,seen,pair[0],pair[1],text,sourceUrl);
  }

  return out.map((bout,index)=>({...bout,boutOrder:index+1}));
}
