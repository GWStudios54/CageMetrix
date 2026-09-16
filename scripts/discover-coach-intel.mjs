import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {COACH_DISCOVERY_SOURCES,articleText,coachCandidateRows,parseCoachListing} from './lib/coach-intel-discovery.mjs';

const args=process.argv.slice(2),remote=args.includes('--remote'),local=args.includes('--local'),dry=args.includes('--dry-run');
if(Number(remote)+Number(local)+Number(dry)!==1)throw new Error('Choose exactly one of --remote, --local or --dry-run');
const target=remote?'--remote':'--local',cache='.cache/coach-intel';mkdirSync(cache,{recursive:true});
const checkedAt=new Date().toISOString(),q=value=>value===null||value===undefined||value===''?'NULL':`'${String(value).replaceAll("'","''")}'`;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function wrangler(params,capture=false){return execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js',...params],{encoding:'utf8',stdio:capture?['ignore','pipe','pipe']:'inherit',maxBuffer:80*1024*1024,env:process.env})||'';}
function query(sql){const blocks=JSON.parse(wrangler(['d1','execute','cagemetrix',target,'--command',sql,'--json'],true));return blocks.flatMap(block=>block?.results||[]);}
async function fetchText(url,attempts=3){
  let last;for(let attempt=1;attempt<=attempts;attempt++)try{
    const response=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(35000),headers:{'accept':'text/html,application/xhtml+xml,application/rss+xml,application/xml;q=0.9,*/*;q=0.5','accept-language':'en-US,en;q=0.8','user-agent':'Mozilla/5.0 (compatible; MMA Scouts coach-intelligence research; +https://mmascouts.com/)'}});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);return await response.text();
  }catch(error){last=error;if(attempt<attempts)await wait(500*attempt);}
  throw last instanceof Error?last:new Error(String(last||'fetch failed'));
}

const sourceAudit=[],discovered=[];
let profiles=[];
if(!dry)profiles=query(`SELECT source_key,source_fighter_id,profile_slug,fighter_name FROM scout_active_global_profiles ORDER BY fighter_name`);
for(const source of COACH_DISCOVERY_SOURCES){
  try{
    const listing=await fetchText(source.url),listed=parseCoachListing(listing,source),articleSeen=new Set(),articles=listed.filter(article=>{if(!article?.url||articleSeen.has(article.url))return false;articleSeen.add(article.url);return true;}).slice(0,80),signalRows=[];
    writeFileSync(`${cache}/${source.slug}-listing.${source.kind==='rss'?'xml':'html'}`,listing);
    for(const [index,article] of articles.entries()){
      try{
        const html=await fetchText(article.url),body=articleText(html,source);writeFileSync(`${cache}/${source.slug}-article-${index+1}.html`,html);
        const rows=dry?[]:coachCandidateRows(article,source,body,profiles);discovered.push(...rows);
        signalRows.push({title:article.title,url:article.url,published_at:article.publishedAt||null,matched_candidates:rows.length});
        await wait(100);
      }catch(error){signalRows.push({title:article.title,url:article.url,error:error instanceof Error?error.message:String(error),matched_candidates:0});}
    }
    sourceAudit.push({slug:source.slug,publisher:source.publisher,url:source.url,status:'ok',signal_articles:articles.length,articles:signalRows});
    console.log(`${source.publisher}: ${articles.length} coach-signal article(s)${dry?'':`, ${signalRows.reduce((sum,row)=>sum+Number(row.matched_candidates||0),0)} fighter candidate(s)`}`);
  }catch(error){sourceAudit.push({slug:source.slug,publisher:source.publisher,url:source.url,status:'error',error:error instanceof Error?error.message:String(error),signal_articles:0,articles:[]});console.warn(`${source.publisher}: ${error instanceof Error?error.message:String(error)}`);}
}

const unique=[];const seen=new Set();for(const row of discovered){if(!seen.has(row.candidateKey)){seen.add(row.candidateKey);unique.push(row);}}
const summary={checked_at:checkedAt,mode:dry?'dry-run':remote?'remote':'local',sources_ok:sourceAudit.filter(row=>row.status==='ok').length,sources_failed:sourceAudit.filter(row=>row.status==='error').length,signal_articles:sourceAudit.reduce((sum,row)=>sum+row.signal_articles,0),candidates:unique.length,pending:unique.filter(row=>row.reviewStatus==='pending').length,needs_identity:unique.filter(row=>row.reviewStatus==='needs_identity').length,sources:sourceAudit,candidate_rows:unique};
writeFileSync(`${cache}/summary.json`,JSON.stringify(summary,null,2)+'\n');
if(dry){if(!summary.sources_ok)throw new Error('All coach discovery sources failed');console.log(`Coach discovery probe found ${summary.signal_articles} signal article(s) across ${summary.sources_ok}/${COACH_DISCOVERY_SOURCES.length} reachable sources.`);process.exit(0);}

const sql=[];
for(const row of unique){sql.push(`INSERT OR IGNORE INTO coach_intel_candidates(candidate_key,source_url,source_title,publisher,published_at,source_type,fighter_name,normalized_name,source_key,source_fighter_id,detected_coach_name,detected_event_type,detected_summary,extraction_method,review_status,discovered_at) VALUES(${q(row.candidateKey)},${q(row.sourceUrl)},${q(row.sourceTitle)},${q(row.publisher)},${q(row.publishedAt)},${q(row.sourceType)},${q(row.fighterName)},${q(row.normalizedName)},${q(row.sourceKey)},${q(row.sourceFighterId)},${q(row.detectedCoachName)},${q(row.detectedEventType)},${q(row.detectedSummary)},${q(row.extractionMethod||'signal_block_scoped_subject_v1')},${q(row.reviewStatus)},${q(checkedAt)});`);}
if(sql.length){writeFileSync(`${cache}/candidates.sql`,sql.join('\n')+'\n');wrangler(['d1','execute','cagemetrix',target,'--file',`${cache}/candidates.sql`]);}
const queue=query(`SELECT review_status,COUNT(*) count FROM coach_intel_candidates GROUP BY review_status ORDER BY review_status`);
summary.queue=queue;writeFileSync(`${cache}/summary.json`,JSON.stringify(summary,null,2)+'\n');
console.log(`Coach discovery queued ${unique.length} signal-local fighter/article candidate(s); ${queue.map(row=>`${row.review_status}:${row.count}`).join(', ')} currently stored.`);
