import {JSDOM} from 'jsdom';

const clean=value=>String(value??'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
const nameKey=value=>clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-+|-+$/g,'');
const reserved=/\b(?:fight\s*card|main\s*card|prelims?|tickets?|watch|stream|event|arena|stadium|championships?|promotion|schedule|results?|live|rounds?|weigh-?ins?)\b/i;
const dateish=/\b(?:20\d{2}|\d{1,2}:\d{2}|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;
const pairSeparator=/\s+(?:vs\.?|versus|v\.?|×)\s+/i;
const WEIGHTS=['Atomweight','Strawweight','Flyweight','Bantamweight','Featherweight','Lightweight','Welterweight','Middleweight','Light Heavyweight','Heavyweight','Super Heavyweight','Catchweight'];
const NON_FIGHTER=/^(?:Champion|Challenger|Germany|Serbia|Croatia|Slovenia|Poland|Brazil|Georgia|Russia|Japan|Ireland|Italy|France|Spain|Portugal|England|Scotland|Wales|United Kingdom|United States|Canada|Australia|Thailand|Netherlands|Sweden|Norway|Finland|Denmark|Austria|Switzerland|Czech Republic|Czechia|Slovakia|Hungary|Romania|Bulgaria|Greece|Turkey|Albania|Kosovo|Bosnia(?: and Herzegovina)?|Montenegro|North Macedonia|Macedonia|Ukraine|Moldova|Armenia|Azerbaijan|Kazakhstan|Tajikistan|Uzbekistan|Kyrgyzstan|Mexico|Argentina|Chile|Peru|Colombia|Venezuela|South Africa|Nigeria|Ghana|Morocco|Tunisia|Egypt|Israel|China|South Korea|Korea|Philippines|Indonesia|Malaysia|Singapore|India|New Zealand|TBA|VS|VS\.)$/i;

function validName(value){
  const name=clean(value).replace(/^(?:main event|co-main event|mma)\s*[:：-]?\s*/i,'').replace(/^#\d+\s*/,'').trim();
  if(name.length<2||name.length>70||reserved.test(name)||dateish.test(name)||/\d/.test(name)||NON_FIGHTER.test(name))return null;
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
function add(out,seen,a,b,context,sourceUrl,overrides={}){
  const aa=validName(a),bb=validName(b);if(!aa||!bb||nameKey(aa)===nameKey(bb))return;
  const key=boutKey(aa,bb);if(!key||seen.has(key))return;
  seen.add(key);
  out.push({boutKey:key,fighterAName:aa,fighterBName:bb,weightClass:overrides.weightClass??weightClass(context),discipline:'MMA',titleFight:overrides.titleFight??/\b(?:title|championship|belt)\b/i.test(clean(context)),status:'scheduled',sourceUrl});
}
function walkJson(node,visit){
  if(Array.isArray(node)){for(const item of node)walkJson(item,visit);return;}
  if(!node||typeof node!=='object')return;
  visit(node);for(const value of Object.values(node))walkJson(value,visit);
}
function divisionFromKg(raw){
  const kg=Number(raw);if(!Number.isFinite(kg))return null;
  if(kg<=57.5)return 'Flyweight';if(kg<=61.7)return 'Bantamweight';if(kg<=66.7)return 'Featherweight';if(kg<=70.8)return 'Lightweight';if(kg<=77.7)return 'Welterweight';if(kg<=84.5)return 'Middleweight';if(kg<=93.5)return 'Light Heavyweight';return 'Heavyweight';
}
function deepDivision(text){
  const value=clean(text);
  const mappings=[['ストロー級','Strawweight'],['フライ級','Flyweight'],['バンタム級','Bantamweight'],['フェザー級','Featherweight'],['ライトヘビー級','Light Heavyweight'],['ライト級','Lightweight'],['ウェルター級','Welterweight'],['ミドル級','Middleweight'],['メガトン級','Megatonweight']];
  for(const [needle,label] of mappings)if(value.includes(needle))return label;
  const kg=value.match(/(\d+(?:\.\d+)?)\s*kg\s*以下/i)?.[1];return kg?`Catchweight ${kg} kg`:null;
}
function deepName(value){
  let name=clean(value).replace(/^[・●\s]*(?:\d+[.．]\s*)?/,'').replace(/^(?:王者|挑戦者)[:：]\s*/,'').replace(/[:：]\s*(?:王者|挑戦者)$/,'');
  name=name.replace(/[（(][^（）()]{0,160}[）)]/g,' ').replace(/\s+/g,' ').trim();
  return validName(name);
}
function parseDeep(doc,out,seen,sourceUrl){
  const root=doc.querySelector('.newsRes')||doc.body;let active=false,context='';
  for(const node of root.querySelectorAll('p')){
    const text=clean(node.textContent);if(!text)continue;
    if(text==='【対戦カード】'){active=true;context='';continue;}
    if(active&&/^【/.test(text))break;
    if(!active)continue;
    if(/\s*VS\.?\s*/i.test(text)){
      const parts=text.split(/\s*VS\.?\s*/i);if(parts.length!==2)continue;
      const a=deepName(parts[0]),b=deepName(parts[1]);
      if(a&&b)add(out,seen,a,b,context,sourceUrl,{weightClass:deepDivision(context),titleFight:/タイトルマッチ/.test(context)});
    }else context=text;
  }
}
function parseAca(doc,out,seen,sourceUrl){
  for(const item of doc.querySelectorAll('.card__more-item')){
    const text=clean(item.textContent);
    const match=text.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*kg\s*\|\s*[\d-]+\s+V\s*S\s+(?:\d+\s+)?(.+?)\s+(\d+(?:\.\d+)?)\s*kg\s*\|\s*[\d-]+$/i);
    if(!match)continue;
    const division=divisionFromKg(Math.max(Number(match[2]),Number(match[4])));
    add(out,seen,match[1],match[3],text,sourceUrl,{weightClass:division});
  }
}
function parseRizin(doc,out,seen,sourceUrl){
  for(const card of doc.querySelectorAll('.event-scoreboard-card')){
    const text=clean(card.textContent);if(!/Rule:\s*RIZIN\s+MMA\s+Rules/i.test(text))continue;
    const pair=pairFromText(clean(card.querySelector('h4')?.textContent));if(!pair)continue;
    const kg=text.match(/Weight:\s*(\d+(?:\.\d+)?)\s*kg/i)?.[1];
    add(out,seen,pair[0],pair[1],text,sourceUrl,{weightClass:kg?`${kg} kg`:null,titleFight:/TITLE|Championship/i.test(text)});
  }
}
function directTextTokens(root){
  const tokens=[];
  const walk=node=>{
    if(node.nodeType===3){const text=clean(node.nodeValue);if(text)tokens.push(text);return;}
    if(node.nodeType!==1||/^(?:SCRIPT|STYLE|NOSCRIPT|SVG)$/i.test(node.tagName||''))return;
    for(const child of node.childNodes)walk(child);
  };
  walk(root);return tokens;
}
function markerCandidate(value){
  const text=clean(value);if(!text||text.length>70||NON_FIGHTER.test(text))return null;
  if(/\b(?:kg|lbs?|cm|score|weight|height|reach|dob|matchup|information|bout|title|card|prelim|country|record)\b/i.test(text))return null;
  if(/^\d+(?:[-:.]\d+)+(?:\s*\([^)]*\))?$/.test(text))return null;
  return validName(text);
}
function parseVsMarkerCards(doc,out,seen,sourceUrl,sourceSlug){
  const tokens=directTextTokens(doc.body);
  const nearest=(start,step)=>{for(let i=start,seenCount=0;i>=0&&i<tokens.length&&seenCount<12;i+=step,seenCount++){const candidate=markerCandidate(tokens[i]);if(candidate)return candidate;}return null;};
  for(let i=0;i<tokens.length;i++){
    if(!/^(?:VS\.?|V\s*S)$/i.test(tokens[i]))continue;
    const context=tokens.slice(Math.max(0,i-10),Math.min(tokens.length,i+11)).join(' · ');
    if(sourceSlug==='fnc'&&/(?:^|\s)UB\s*\d|kickbox/i.test(context))continue;
    const a=nearest(i-1,-1),b=nearest(i+1,1);if(!a||!b)continue;
    add(out,seen,a,b,context,sourceUrl,{weightClass:weightClass(context)});
  }
}

export function parseGlobalEventBouts(html,{sourceSlug='',sourceUrl=''}={}){
  const doc=new JSDOM(String(html||'')).window.document;
  const out=[],seen=new Set();

  if(sourceSlug==='deep')parseDeep(doc,out,seen,sourceUrl);
  if(sourceSlug==='aca')parseAca(doc,out,seen,sourceUrl);
  if(sourceSlug==='rizin')parseRizin(doc,out,seen,sourceUrl);
  if(sourceSlug==='fnc'||sourceSlug==='cage-warriors')parseVsMarkerCards(doc,out,seen,sourceUrl,sourceSlug);

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
