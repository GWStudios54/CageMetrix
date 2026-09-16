import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {WIKIPEDIA_USER_AGENT,amateurRecordCandidate,wikipediaLookupUrl} from './lib/amateur-record-intel-discovery.mjs';

const args=process.argv.slice(2),remote=args.includes('--remote'),local=args.includes('--local'),dry=args.includes('--dry-run');
if(Number(remote)+Number(local)+Number(dry)!==1)throw new Error('Choose exactly one of --remote, --local or --dry-run');
const target=remote?'--remote':'--local',cache='.cache/amateur-record-intel';mkdirSync(cache,{recursive:true});
const batchSize=Number.parseInt(process.env.AMATEUR_RECORD_BATCH_SIZE||'',10)||60;
const checkedAt=new Date().toISOString(),q=value=>value===null||value===undefined||value===''?'NULL':`'${String(value).replaceAll("'","''")}'`;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function wrangler(params,capture=false){return execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js',...params],{encoding:'utf8',stdio:capture?['ignore','pipe','pipe']:'inherit',maxBuffer:80*1024*1024,env:process.env})||'';}
function query(sql){const blocks=JSON.parse(wrangler(['d1','execute','cagemetrix',target,'--command',sql,'--json'],true));return blocks.flatMap(block=>block?.results||[]);}

async function fetchWikipedia(title,attempts=3){
  const url=wikipediaLookupUrl(title);
  let last;for(let attempt=1;attempt<=attempts;attempt++)try{
    const response=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(20000),headers:{'accept':'application/json','user-agent':WIKIPEDIA_USER_AGENT}});
    if(response.status===429){await wait(2000*attempt);continue;}
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    return await response.json();
  }catch(error){last=error;if(attempt<attempts)await wait(500*attempt);}
  throw last instanceof Error?last:new Error(String(last||'fetch failed'));
}

// Wikipedia is looked up per already-known fighter (a structured biographical lookup, not a news
// feed to scan), so this processes a bounded batch per run rather than the whole roster at once --
// both to be a respectful, rate-limited API consumer (Wikimedia's API etiquette) and because amateur
// records essentially never change once a fighter turns pro, so there's no urgency to recheck a
// fighter this run already covered. Order by least-recently-checked so the whole roster eventually
// cycles through across successive weekly runs.
let profiles=[];
if(!dry){
  profiles=query(`
    SELECT p.source_key,p.source_fighter_id,p.profile_slug,p.fighter_name,p.normalized_name,p.dob
    FROM scout_active_global_profiles p
    LEFT JOIN fighter_amateur_record r ON r.source_key=p.source_key AND r.source_fighter_id=p.source_fighter_id
    LEFT JOIN amateur_record_intel_candidates c ON c.source_key=p.source_key AND c.source_fighter_id=p.source_fighter_id
    LEFT JOIN amateur_record_wikipedia_lookups l ON l.source_key=p.source_key AND l.source_fighter_id=p.source_fighter_id
    WHERE r.id IS NULL AND c.id IS NULL AND (l.checked_at IS NULL OR l.checked_at<datetime('now','-180 days'))
    ORDER BY COALESCE(l.checked_at,'0000-00-00') ASC,p.fighter_name
    LIMIT ${batchSize}
  `);
}

const audit=[],discovered=[],lookups=[];
for(const profile of profiles){
  let result='error';
  try{
    const data=await fetchWikipedia(profile.fighter_name);
    const pages=Object.values(data?.query?.pages||{}),page=pages[0];
    if(!page||page.missing!==undefined){result='no_page';audit.push({fighter_name:profile.fighter_name,status:'no_page'});}
    else{
      const wikitext=page?.revisions?.[0]?.slots?.main?.['*']||'';
      const pageTitle=page.title,pageUrl=`https://en.wikipedia.org/wiki/${encodeURIComponent(pageTitle.replaceAll(' ','_'))}`;
      writeFileSync(`${cache}/${profile.source_fighter_id}.wikitext`,wikitext);
      const candidate=amateurRecordCandidate(profile,pageTitle,pageUrl,wikitext);
      if(candidate){result='candidate';discovered.push(candidate);audit.push({fighter_name:profile.fighter_name,status:'candidate',review_status:candidate.reviewStatus});}
      else{result='no_amateur_record';audit.push({fighter_name:profile.fighter_name,status:'no_amateur_record'});}
    }
  }catch(error){audit.push({fighter_name:profile.fighter_name,status:'error',error:error instanceof Error?error.message:String(error)});}
  lookups.push({sourceKey:profile.source_key,sourceFighterId:profile.source_fighter_id,result});
  await wait(150);
}

const summary={checked_at:checkedAt,mode:dry?'dry-run':remote?'remote':'local',fighters_checked:profiles.length,candidates:discovered.length,pending:discovered.filter(row=>row.reviewStatus==='pending').length,needs_identity:discovered.filter(row=>row.reviewStatus==='needs_identity').length,audit};
writeFileSync(`${cache}/summary.json`,JSON.stringify(summary,null,2)+'\n');
if(dry){
  const probe=await fetchWikipedia('Jon Jones');
  const ok=!!Object.values(probe?.query?.pages||{})[0];
  if(!ok)throw new Error('Wikipedia lookup probe failed');
  console.log('Amateur-record discovery probe: Wikipedia API reachable and parseable.');
  process.exit(0);
}

const sql=[];
for(const row of discovered){sql.push(`INSERT OR IGNORE INTO amateur_record_intel_candidates(candidate_key,source_url,source_title,fighter_name,normalized_name,source_key,source_fighter_id,detected_wins,detected_losses,detected_draws,detected_no_contests,wiki_birth_date,our_dob,identity_basis,detected_summary,extraction_method,review_status,discovered_at) VALUES(${q(row.candidateKey)},${q(row.sourceUrl)},${q(row.sourceTitle)},${q(row.fighterName)},${q(row.normalizedName)},${q(row.sourceKey)},${q(row.sourceFighterId)},${row.detectedWins},${row.detectedLosses},${row.detectedDraws},${row.detectedNoContests},${q(row.wikiBirthDate)},${q(row.ourDob)},${q(row.identityBasis)},${q(row.detectedSummary)},${q(row.extractionMethod)},${q(row.reviewStatus)},${q(checkedAt)});`);}
for(const row of lookups){sql.push(`INSERT INTO amateur_record_wikipedia_lookups(source_key,source_fighter_id,checked_at,result) VALUES(${q(row.sourceKey)},${q(row.sourceFighterId)},${q(checkedAt)},${q(row.result)}) ON CONFLICT(source_key,source_fighter_id) DO UPDATE SET checked_at=excluded.checked_at,result=excluded.result;`);}
if(sql.length){writeFileSync(`${cache}/candidates.sql`,sql.join('\n')+'\n');wrangler(['d1','execute','cagemetrix',target,'--file',`${cache}/candidates.sql`]);}
const queueCounts=query(`SELECT review_status,COUNT(*) count FROM amateur_record_intel_candidates GROUP BY review_status ORDER BY review_status`);
summary.queue=queueCounts;writeFileSync(`${cache}/summary.json`,JSON.stringify(summary,null,2)+'\n');
console.log(`Amateur-record discovery checked ${profiles.length} fighter(s) against Wikipedia; queued ${discovered.length} candidate(s); ${queueCounts.map(row=>`${row.review_status}:${row.count}`).join(', ')} currently stored.`);
