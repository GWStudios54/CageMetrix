import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {CONTRACT_DISCOVERY_SOURCES,articleText,candidateRows,parseContractListing} from './lib/contract-intel-discovery.mjs';

const args=process.argv.slice(2),remote=args.includes('--remote'),local=args.includes('--local'),dry=args.includes('--dry-run');
if(Number(remote)+Number(local)+Number(dry)!==1)throw new Error('Choose exactly one of --remote, --local or --dry-run');
const target=remote?'--remote':'--local',cache='.cache/contract-intel';mkdirSync(cache,{recursive:true});
const checkedAt=new Date().toISOString(),q=value=>value===null||value===undefined||value===''?'NULL':`'${String(value).replaceAll("'","''")}'`;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const LEGACY_METHODS="'exact_name+keyword','signal_block_exact_name_v2','signal_block_subject_v3'";
const UPGRADEABLE_METHODS="'exact_name+keyword','signal_block_exact_name_v2','signal_block_subject_v3','signal_block_scoped_subject_v4'";
const V2_SUPERSEDED_NOTE='Automatically superseded by signal-local discovery v2 after the initial extractor proved over-broad.';
const SUPERSEDED_NOTE='Automatically superseded by current scoped subject-attributed discovery after evidence-scope and subject-attribution hardening.';
const REACTIVATED_NOTE='Automatically reactivated or upgraded by current scoped subject-attributed discovery after passing evidence-scope and subject-attribution filters.';
function wrangler(params,capture=false){return execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js',...params],{encoding:'utf8',stdio:capture?['ignore','pipe','pipe']:'inherit',maxBuffer:80*1024*1024,env:process.env})||'';}
function query(sql){const blocks=JSON.parse(wrangler(['d1','execute','cagemetrix',target,'--command',sql,'--json'],true));return blocks.flatMap(block=>block?.results||[]);}
async function fetchText(url,attempts=3){
  let last;for(let attempt=1;attempt<=attempts;attempt++)try{
    const response=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(35000),headers:{'accept':'text/html,application/xhtml+xml,application/rss+xml,application/xml;q=0.9,*/*;q=0.5','accept-language':'en-US,en;q=0.8','user-agent':'Mozilla/5.0 (compatible; MMA Scouts contract research; +https://mmascouts.com/)'}});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);return await response.text();
  }catch(error){last=error;if(attempt<attempts)await wait(500*attempt);}
  throw last instanceof Error?last:new Error(String(last||'fetch failed'));
}

const sourceAudit=[],discovered=[];
let profiles=[];
if(!dry)profiles=query(`SELECT source_key,source_fighter_id,profile_slug,fighter_name FROM scout_active_global_profiles ORDER BY fighter_name`);
for(const source of CONTRACT_DISCOVERY_SOURCES){
  try{
    const listing=await fetchText(source.url),listed=parseContractListing(listing,source),seeded=Array.isArray(source.seedArticles)?source.seedArticles:[],mergedArticles=[...listed,...seeded],articleSeen=new Set(),articles=mergedArticles.filter(article=>{if(!article?.url||articleSeen.has(article.url))return false;articleSeen.add(article.url);return true;}).slice(0,80),signalRows=[];
    writeFileSync(`${cache}/${source.slug}-listing.${source.kind==='rss'?'xml':'html'}`,listing);
    for(const [index,article] of articles.entries()){
      try{
        const html=await fetchText(article.url),body=articleText(html,source);writeFileSync(`${cache}/${source.slug}-article-${index+1}.html`,html);
        const rows=dry?[]:candidateRows(article,source,body,profiles);discovered.push(...rows);
        signalRows.push({title:article.title,url:article.url,published_at:article.publishedAt||null,matched_candidates:rows.length});
        await wait(100);
      }catch(error){signalRows.push({title:article.title,url:article.url,error:error instanceof Error?error.message:String(error),matched_candidates:0});}
    }
    sourceAudit.push({slug:source.slug,publisher:source.publisher,url:source.url,status:'ok',signal_articles:articles.length,articles:signalRows});
    console.log(`${source.publisher}: ${articles.length} contract-signal article(s)${dry?'':`, ${signalRows.reduce((sum,row)=>sum+Number(row.matched_candidates||0),0)} fighter candidate(s)`}`);
  }catch(error){sourceAudit.push({slug:source.slug,publisher:source.publisher,url:source.url,status:'error',error:error instanceof Error?error.message:String(error),signal_articles:0,articles:[]});console.warn(`${source.publisher}: ${error instanceof Error?error.message:String(error)}`);}
}

const unique=[];const seen=new Set();for(const row of discovered){if(!seen.has(row.candidateKey)){seen.add(row.candidateKey);unique.push(row);}}
const summary={checked_at:checkedAt,mode:dry?'dry-run':remote?'remote':'local',sources_ok:sourceAudit.filter(row=>row.status==='ok').length,sources_failed:sourceAudit.filter(row=>row.status==='error').length,signal_articles:sourceAudit.reduce((sum,row)=>sum+row.signal_articles,0),candidates:unique.length,pending:unique.filter(row=>row.reviewStatus==='pending').length,needs_identity:unique.filter(row=>row.reviewStatus==='needs_identity').length,sources:sourceAudit,candidate_rows:unique};
writeFileSync(`${cache}/summary.json`,JSON.stringify(summary,null,2)+'\n');
if(dry){if(!summary.sources_ok)throw new Error('All contract discovery sources failed');console.log(`Contract discovery probe found ${summary.signal_articles} contract-signal article(s) across ${summary.sources_ok}/${CONTRACT_DISCOVERY_SOURCES.length} reachable sources.`);process.exit(0);}

// A candidate key identifies the source + fighter + detected event, not the
// extractor version. When a stronger current extractor rediscovers an
// unreviewed candidate created by a weaker extractor, upgrade that same private
// queue row in place rather than letting INSERT OR IGNORE hide cleaner evidence. Human-reviewed rows are never
// reactivated automatically; only unreviewed legacy rows or rows auto-rejected
// by the v2 supersession pass are eligible.
let restored=0;
if(unique.length){
  const keys=unique.map(row=>q(row.candidateKey)).join(',');
  restored=Number(query(`SELECT COUNT(*) count FROM contract_intel_candidates WHERE candidate_key IN (${keys}) AND extraction_method IN (${UPGRADEABLE_METHODS}) AND (review_status IN ('pending','needs_identity') OR (review_status='rejected' AND instr(COALESCE(notes,''),${q(V2_SUPERSEDED_NOTE)})>0))`)[0]?.count||0);
}
const reconciliation=[];
for(const row of unique){
  reconciliation.push(`UPDATE contract_intel_candidates SET source_url=${q(row.sourceUrl)},source_title=${q(row.sourceTitle)},publisher=${q(row.publisher)},published_at=${q(row.publishedAt)},source_type=${q(row.sourceType)},fighter_name=${q(row.fighterName)},normalized_name=${q(row.normalizedName)},source_key=${q(row.sourceKey)},source_fighter_id=${q(row.sourceFighterId)},promotion_slug=${q(row.promotionSlug)},detected_event_type=${q(row.detectedEventType)},detected_status=${q(row.detectedStatus)},detected_summary=${q(row.detectedSummary)},extraction_method=${q(row.extractionMethod||'signal_block_scoped_subject_v4')},review_status=${q(row.reviewStatus)},discovered_at=${q(checkedAt)},reviewed_at=NULL,notes=${q(REACTIVATED_NOTE)} WHERE candidate_key=${q(row.candidateKey)} AND extraction_method IN (${UPGRADEABLE_METHODS}) AND extraction_method<>${q(row.extractionMethod||'signal_block_scoped_subject_v4')} AND (review_status IN ('pending','needs_identity') OR (review_status='rejected' AND instr(COALESCE(notes,''),${q(V2_SUPERSEDED_NOTE)})>0));`);
}
if(reconciliation.length){writeFileSync(`${cache}/reconcile.sql`,reconciliation.join('\n')+'\n');wrangler(['d1','execute','cagemetrix',target,'--file',`${cache}/reconcile.sql`]);}

const superseded=Number(query(`SELECT COUNT(*) count FROM contract_intel_candidates WHERE extraction_method IN (${LEGACY_METHODS}) AND review_status IN ('pending','needs_identity')`)[0]?.count||0);
if(superseded>0)query(`UPDATE contract_intel_candidates SET review_status='rejected',reviewed_at=CURRENT_TIMESTAMP,notes=${q(SUPERSEDED_NOTE)} WHERE extraction_method IN (${LEGACY_METHODS}) AND review_status IN ('pending','needs_identity')`);

const sql=[];
for(const row of unique){sql.push(`INSERT OR IGNORE INTO contract_intel_candidates(candidate_key,source_url,source_title,publisher,published_at,source_type,fighter_name,normalized_name,source_key,source_fighter_id,promotion_slug,detected_event_type,detected_status,detected_summary,extraction_method,review_status,discovered_at) VALUES(${q(row.candidateKey)},${q(row.sourceUrl)},${q(row.sourceTitle)},${q(row.publisher)},${q(row.publishedAt)},${q(row.sourceType)},${q(row.fighterName)},${q(row.normalizedName)},${q(row.sourceKey)},${q(row.sourceFighterId)},${q(row.promotionSlug)},${q(row.detectedEventType)},${q(row.detectedStatus)},${q(row.detectedSummary)},${q(row.extractionMethod||'signal_block_scoped_subject_v4')},${q(row.reviewStatus)},${q(checkedAt)});`);}
if(sql.length){writeFileSync(`${cache}/candidates.sql`,sql.join('\n')+'\n');wrangler(['d1','execute','cagemetrix',target,'--file',`${cache}/candidates.sql`]);}
const queue=query(`SELECT review_status,COUNT(*) count FROM contract_intel_candidates GROUP BY review_status ORDER BY review_status`);
summary.restored_legacy_candidates=restored;summary.superseded_legacy_candidates=superseded;summary.queue=queue;writeFileSync(`${cache}/summary.json`,JSON.stringify(summary,null,2)+'\n');
console.log(`Contract discovery queued ${unique.length} signal-local fighter/article candidate(s); restored ${restored} clean legacy row(s), superseded ${superseded} remaining unreviewed legacy row(s); ${queue.map(row=>`${row.review_status}:${row.count}`).join(', ')} currently stored.`);
