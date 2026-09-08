import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';

const args=process.argv.slice(2);
const remote=args.includes('--remote'),local=args.includes('--local'),dry=args.includes('--dry-run');
if(Number(remote)+Number(local)+Number(dry)!==1)throw new Error('Choose exactly one of --remote, --local or --dry-run');
const target=remote?'--remote':'--local';
const cache='.cache/fighter-intel';mkdirSync(cache,{recursive:true});
const checkedAt=new Date().toISOString();

function wrangler(params,capture=false){
  return execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js',...params],{encoding:'utf8',stdio:capture?['ignore','pipe','pipe']:'inherit',maxBuffer:40*1024*1024,env:process.env})||'';
}
function query(sql){
  const blocks=JSON.parse(wrangler(['d1','execute','cagemetrix',target,'--command',sql,'--json'],true));
  return blocks.flatMap(block=>block?.results||[]);
}

const facts=[
  {key:'identity.dob',category:'identity',column:'p.dob',where:'p.dob IS NOT NULL'},
  {key:'identity.nationality',category:'identity',column:'p.nationality',where:"p.nationality IS NOT NULL AND trim(p.nationality)<>''"},
  {key:'physical.height',category:'physical',column:"printf('%.1f cm',p.height_cm)",where:'p.height_cm IS NOT NULL'},
  {key:'physical.reach',category:'physical',column:"printf('%.1f cm',p.reach_cm)",where:'p.reach_cm IS NOT NULL'},
  {key:'physical.stance',category:'physical',column:'p.stance',where:"p.stance IS NOT NULL AND trim(p.stance)<>''"},
  {key:'team.primary',category:'team',column:'p.gym',where:"p.gym IS NOT NULL AND trim(p.gym)<>''"},
  {key:'career.organization',category:'career',column:'p.current_organization',where:"p.current_organization IS NOT NULL AND trim(p.current_organization)<>''"},
  {key:'career.promotion',category:'career',column:'p.current_promotion_slug',where:"p.current_promotion_slug IS NOT NULL AND trim(p.current_promotion_slug)<>''"},
  {key:'career.weight_class',category:'career',column:'p.current_weight_class',where:"p.current_weight_class IS NOT NULL AND trim(p.current_weight_class)<>''"},
  {key:'career.start',category:'career',column:'p.career_start_date',where:'p.career_start_date IS NOT NULL'},
  {key:'career.last_fight',category:'career',column:'p.last_fight_date',where:'p.last_fight_date IS NOT NULL'}
];

const sql=[];
sql.push("UPDATE fighter_intel_facts SET is_current=0,last_checked_at=CURRENT_TIMESTAMP WHERE source_type='derived_warehouse' AND is_current=1;");
for(const fact of facts){
  sql.push(`INSERT INTO fighter_intel_facts(fingerprint,source_key,source_fighter_id,category,fact_key,value_text,is_current,source_slug,source_type,confidence,verified_at,last_checked_at,notes)
SELECT 'warehouse:'||p.source_key||':'||p.source_fighter_id||':${fact.key}:'||lower(trim(CAST(${fact.column} AS TEXT))),p.source_key,p.source_fighter_id,'${fact.category}','${fact.key}',CAST(${fact.column} AS TEXT),1,'mma-master','derived_warehouse','B',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'Refreshed from the active normalized MMA Scouts profile snapshot.'
FROM scout_active_global_profiles p WHERE ${fact.where}
ON CONFLICT(fingerprint) DO UPDATE SET is_current=1,value_text=excluded.value_text,verified_at=excluded.verified_at,last_checked_at=CURRENT_TIMESTAMP;`);
}

sql.push(`INSERT INTO fighter_intel_facts(fingerprint,source_key,source_fighter_id,category,fact_key,value_text,is_current,source_slug,source_url,source_type,confidence,verified_at,last_checked_at,notes)
SELECT 'management:'||h.id,h.source_key,h.source_fighter_id,'management','management.current',COALESCE(a.name,h.manager_name),h.is_current,'management-rosters',h.source_url,h.source_type,h.confidence,h.verified_at,CURRENT_TIMESTAMP,'Source-backed representation relationship.'
FROM fighter_management_history h LEFT JOIN management_agencies a ON a.id=h.agency_id
ON CONFLICT(fingerprint) DO UPDATE SET is_current=excluded.is_current,value_text=excluded.value_text,source_url=excluded.source_url,confidence=excluded.confidence,verified_at=excluded.verified_at,last_checked_at=CURRENT_TIMESTAMP;`);

sql.push(`INSERT INTO fighter_intel_facts(fingerprint,source_key,source_fighter_id,category,fact_key,value_text,is_current,source_slug,source_url,source_type,confidence,verified_at,last_checked_at)
SELECT 'opportunity:'||o.source_key||':'||o.source_fighter_id||':contract:'||o.contract_status,o.source_key,o.source_fighter_id,'contract','contract.status',o.contract_status,1,CASE WHEN o.source_type='verified_profile' THEN 'verified-profile' ELSE NULL END,o.source_url,o.source_type,o.confidence,o.verified_at,CURRENT_TIMESTAMP
FROM fighter_opportunity_status o WHERE o.contract_status<>'unknown'
ON CONFLICT(fingerprint) DO UPDATE SET is_current=1,source_url=excluded.source_url,confidence=excluded.confidence,verified_at=excluded.verified_at,last_checked_at=CURRENT_TIMESTAMP;`);
for(const field of ['open_to_fights','open_to_management','open_to_team']){
  const key=field==='open_to_fights'?'availability.fights':field==='open_to_management'?'availability.management':'availability.team';
  sql.push(`INSERT INTO fighter_intel_facts(fingerprint,source_key,source_fighter_id,category,fact_key,value_text,is_current,source_slug,source_url,source_type,confidence,verified_at,last_checked_at)
SELECT 'opportunity:'||o.source_key||':'||o.source_fighter_id||':${key}:'||o.${field},o.source_key,o.source_fighter_id,'availability','${key}',o.${field},1,CASE WHEN o.source_type='verified_profile' THEN 'verified-profile' ELSE NULL END,o.source_url,o.source_type,o.confidence,o.verified_at,CURRENT_TIMESTAMP
FROM fighter_opportunity_status o WHERE o.${field}<>'unknown'
ON CONFLICT(fingerprint) DO UPDATE SET is_current=1,source_url=excluded.source_url,confidence=excluded.confidence,verified_at=excluded.verified_at,last_checked_at=CURRENT_TIMESTAMP;`);
}
sql.push(`INSERT INTO fighter_intel_facts(fingerprint,source_key,source_fighter_id,category,fact_key,value_text,is_current,source_slug,source_url,source_type,confidence,verified_at,last_checked_at)
SELECT 'opportunity:'||o.source_key||':'||o.source_fighter_id||':location:'||lower(trim(COALESCE(o.base_city,'')||'|'||COALESCE(o.base_region,'')||'|'||COALESCE(o.base_country,''))),o.source_key,o.source_fighter_id,'location','location.base',trim(COALESCE(o.base_city,'')||CASE WHEN o.base_city IS NOT NULL AND o.base_region IS NOT NULL THEN ', ' ELSE '' END||COALESCE(o.base_region,'')||CASE WHEN COALESCE(o.base_city,o.base_region) IS NOT NULL AND o.base_country IS NOT NULL THEN ', ' ELSE '' END||COALESCE(o.base_country,'')),1,CASE WHEN o.source_type='verified_profile' THEN 'verified-profile' ELSE NULL END,o.source_url,o.source_type,o.confidence,o.verified_at,CURRENT_TIMESTAMP
FROM fighter_opportunity_status o WHERE COALESCE(o.base_city,o.base_region,o.base_country) IS NOT NULL
ON CONFLICT(fingerprint) DO UPDATE SET is_current=1,value_text=excluded.value_text,source_url=excluded.source_url,confidence=excluded.confidence,verified_at=excluded.verified_at,last_checked_at=CURRENT_TIMESTAMP;`);
sql.push(`INSERT INTO fighter_intel_facts(fingerprint,source_key,source_fighter_id,category,fact_key,value_text,is_current,source_slug,source_url,source_type,confidence,verified_at,last_checked_at)
SELECT 'opportunity:'||o.source_key||':'||o.source_fighter_id||':contact:'||lower(trim(o.public_contact_url)),o.source_key,o.source_fighter_id,'contact','contact.professional',o.public_contact_url,1,CASE WHEN o.source_type='verified_profile' THEN 'verified-profile' ELSE NULL END,o.source_url,o.source_type,o.confidence,o.verified_at,CURRENT_TIMESTAMP
FROM fighter_opportunity_status o WHERE o.public_contact_url IS NOT NULL AND trim(o.public_contact_url)<>''
ON CONFLICT(fingerprint) DO UPDATE SET is_current=1,value_text=excluded.value_text,source_url=excluded.source_url,confidence=excluded.confidence,verified_at=excluded.verified_at,last_checked_at=CURRENT_TIMESTAMP;`);

sql.push(`WITH ordered AS (
  SELECT f.source_key,f.snapshot_id,f.source_fighter_id,f.source_fight_id,f.event_date,f.organization,f.weight_class,
         LAG(f.organization) OVER(PARTITION BY f.source_key,f.snapshot_id,f.source_fighter_id ORDER BY f.event_date,f.source_fight_id) previous_organization,
         LAG(f.weight_class) OVER(PARTITION BY f.source_key,f.snapshot_id,f.source_fighter_id ORDER BY f.event_date,f.source_fight_id) previous_weight
  FROM scout_active_global_fights f
)
INSERT INTO fighter_intel_events(event_key,source_key,source_fighter_id,event_type,title,summary,occurred_at,source_slug,source_type,confidence,verified_at,last_checked_at)
SELECT 'warehouse:promotion:'||source_key||':'||source_fighter_id||':'||source_fight_id,source_key,source_fighter_id,'promotion_change','Promotion move: '||organization,'Recorded bout after '||previous_organization,event_date,'mma-master','derived_warehouse','B',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
FROM ordered WHERE previous_organization IS NOT NULL AND organization IS NOT NULL AND lower(trim(previous_organization))<>lower(trim(organization))
ON CONFLICT(event_key) DO UPDATE SET title=excluded.title,summary=excluded.summary,occurred_at=excluded.occurred_at,last_checked_at=CURRENT_TIMESTAMP;`);

sql.push(`WITH ordered AS (
  SELECT f.source_key,f.snapshot_id,f.source_fighter_id,f.source_fight_id,f.event_date,f.organization,f.weight_class,
         LAG(f.weight_class) OVER(PARTITION BY f.source_key,f.snapshot_id,f.source_fighter_id ORDER BY f.event_date,f.source_fight_id) previous_weight
  FROM scout_active_global_fights f
)
INSERT INTO fighter_intel_events(event_key,source_key,source_fighter_id,event_type,title,summary,occurred_at,source_slug,source_type,confidence,verified_at,last_checked_at)
SELECT 'warehouse:weight:'||source_key||':'||source_fighter_id||':'||source_fight_id,source_key,source_fighter_id,'weight_change','Competed at '||weight_class,'Previous recorded weight class: '||previous_weight,event_date,'mma-master','derived_warehouse','B',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
FROM ordered WHERE previous_weight IS NOT NULL AND weight_class IS NOT NULL AND lower(trim(previous_weight))<>lower(trim(weight_class))
ON CONFLICT(event_key) DO UPDATE SET title=excluded.title,summary=excluded.summary,occurred_at=excluded.occurred_at,last_checked_at=CURRENT_TIMESTAMP;`);

sql.push(`INSERT INTO fighter_intel_events(event_key,source_key,source_fighter_id,event_type,title,summary,occurred_at,source_slug,source_url,source_type,confidence,verified_at,last_checked_at)
SELECT 'management:'||h.id,h.source_key,h.source_fighter_id,'management_change',CASE WHEN h.is_current=1 THEN 'Representation verified' ELSE 'Representation ended' END,COALESCE(a.name,h.manager_name),COALESCE(h.started_at,h.ended_at,substr(h.verified_at,1,10)),'management-rosters',h.source_url,h.source_type,h.confidence,h.verified_at,CURRENT_TIMESTAMP
FROM fighter_management_history h LEFT JOIN management_agencies a ON a.id=h.agency_id
ON CONFLICT(event_key) DO UPDATE SET title=excluded.title,summary=excluded.summary,occurred_at=excluded.occurred_at,source_url=excluded.source_url,confidence=excluded.confidence,verified_at=excluded.verified_at,last_checked_at=CURRENT_TIMESTAMP;`);

sql.push(`INSERT INTO fighter_intel_events(event_key,source_key,source_fighter_id,event_type,title,summary,occurred_at,source_slug,source_url,source_type,confidence,verified_at,last_checked_at)
SELECT 'contract:'||o.source_key||':'||o.source_fighter_id||':'||o.contract_status,o.source_key,o.source_fighter_id,'contract_change','Contract status: '||replace(o.contract_status,'_',' '),o.availability_note,substr(o.verified_at,1,10),CASE WHEN o.source_type='verified_profile' THEN 'verified-profile' ELSE NULL END,o.source_url,o.source_type,o.confidence,o.verified_at,CURRENT_TIMESTAMP
FROM fighter_opportunity_status o WHERE o.contract_status<>'unknown'
ON CONFLICT(event_key) DO UPDATE SET title=excluded.title,summary=excluded.summary,occurred_at=excluded.occurred_at,source_url=excluded.source_url,confidence=excluded.confidence,verified_at=excluded.verified_at,last_checked_at=CURRENT_TIMESTAMP;`);

writeFileSync(`${cache}/sync.sql`,sql.join('\n\n')+'\n');
if(dry){writeFileSync(`${cache}/summary.json`,JSON.stringify({checked_at:checkedAt,mode:'dry-run',statements:sql.length},null,2)+'\n');console.log(`Prepared ${sql.length} fighter-intel statements.`);process.exit(0);}
wrangler(['d1','execute','cagemetrix',target,'--file',`${cache}/sync.sql`]);
const coverage=query(`SELECT COUNT(*) fighters,ROUND(AVG(intel_coverage_pct),1) avg_coverage,MIN(intel_coverage_pct) min_coverage,MAX(intel_coverage_pct) max_coverage,SUM(CASE WHEN management_status='represented' THEN 1 ELSE 0 END) represented,SUM(CASE WHEN gym IS NOT NULL AND trim(gym)<>'' THEN 1 ELSE 0 END) gym_known FROM scout_fighter_intel_coverage`)[0]||{};
const factsSummary=query(`SELECT category,COUNT(*) facts FROM fighter_intel_facts WHERE is_current=1 GROUP BY category ORDER BY facts DESC`);
const eventsSummary=query(`SELECT event_type,COUNT(*) events FROM fighter_intel_events GROUP BY event_type ORDER BY events DESC`);
const stale=query(`SELECT fact_key,COUNT(*) missing FROM scout_fighter_intel_coverage c CROSS JOIN (SELECT 'management.current' fact_key UNION ALL SELECT 'team.primary' UNION ALL SELECT 'contract.status' UNION ALL SELECT 'location.base') k WHERE (k.fact_key='management.current' AND c.management_status='unknown') OR (k.fact_key='team.primary' AND (c.gym IS NULL OR trim(c.gym)='')) OR (k.fact_key='contract.status' AND c.contract_status='unknown') OR (k.fact_key='location.base' AND COALESCE(c.base_city,c.base_region,c.base_country) IS NULL) GROUP BY fact_key ORDER BY missing DESC`);
const summary={checked_at:checkedAt,mode:remote?'remote':'local',coverage,facts:factsSummary,events:eventsSummary,largest_gaps:stale};
writeFileSync(`${cache}/summary.json`,JSON.stringify(summary,null,2)+'\n');
console.log(`Fighter intel refreshed for ${coverage.fighters||0} active fighters; average coverage ${coverage.avg_coverage??0}%.`);
