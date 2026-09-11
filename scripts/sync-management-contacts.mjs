import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {MANAGEMENT_CONTACT_SOURCES,contactRowsFromOfficialPage} from './lib/management-contact-sources.mjs';

const args=process.argv.slice(2),remote=args.includes('--remote'),local=args.includes('--local'),dry=args.includes('--dry-run');
if(Number(remote)+Number(local)+Number(dry)!==1)throw new Error('Choose exactly one of --remote, --local or --dry-run');
const target=remote?'--remote':'--local',cache='.cache/management-contacts';mkdirSync(cache,{recursive:true});
const checkedAt=new Date().toISOString(),q=value=>value===null||value===undefined||value===''?'NULL':"'" + String(value).replaceAll("'","''") + "'";

function wrangler(params,capture=false){
  return execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js',...params],{encoding:'utf8',stdio:capture?['ignore','pipe','pipe']:'inherit',maxBuffer:40*1024*1024,env:process.env})||'';
}
function query(sql){
  const blocks=JSON.parse(wrangler(['d1','execute','cagemetrix',target,'--command',sql,'--json'],true));
  return blocks.flatMap(block=>block?.results||[]);
}
async function fetchHtml(url){
  const response=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(35000),headers:{accept:'text/html,application/xhtml+xml','accept-language':'en-US,en;q=0.8','user-agent':'Mozilla/5.0 (compatible; MMA Scouts management contact research; +https://mmascouts.com/)'}});
  if(!response.ok)throw new Error('HTTP '+response.status);
  return response.text();
}

const sourceAudit=[],discovered=[];
for(const source of MANAGEMENT_CONTACT_SOURCES){
  try{
    const html=await fetchHtml(source.url);
    writeFileSync(cache+'/'+source.agencySlug+'.html',html);
    const rows=contactRowsFromOfficialPage(html,source);
    discovered.push(...rows);
    sourceAudit.push({agency_slug:source.agencySlug,publisher:source.publisher,url:source.url,status:'ok',contacts:rows.length});
    console.log(source.publisher+': '+rows.length+' verified public contact route(s).');
  }catch(error){
    sourceAudit.push({agency_slug:source.agencySlug,publisher:source.publisher,url:source.url,status:'error',contacts:0,error:error instanceof Error?error.message:String(error)});
  }
}

if(dry){
  const summary={checked_at:checkedAt,mode:'dry-run',sources:sourceAudit,contacts:discovered};
  writeFileSync(cache+'/summary.json',JSON.stringify(summary,null,2)+'\n');
  if(!sourceAudit.some(row=>row.status==='ok'))throw new Error('All management contact sources failed');
  console.log('Management contact probe verified '+discovered.length+' source-backed contact route(s) across '+sourceAudit.filter(row=>row.status==='ok').length+'/'+MANAGEMENT_CONTACT_SOURCES.length+' reachable official sources.');
  process.exit(0);
}

const agencyRows=query('SELECT id,slug FROM management_agencies WHERE active=1');
const agencyBySlug=new Map(agencyRows.map(row=>[String(row.slug),Number(row.id)]));
const statements=[],missingAgencies=[];
for(const source of MANAGEMENT_CONTACT_SOURCES){
  const audit=sourceAudit.find(row=>row.agency_slug===source.agencySlug);
  if(!audit||audit.status!=='ok')continue;
  const agencyId=agencyBySlug.get(source.agencySlug);
  if(!agencyId){missingAgencies.push(source.agencySlug);continue;}
  statements.push('UPDATE management_agency_contacts SET is_current=0,last_checked_at='+q(checkedAt)+' WHERE agency_id='+agencyId+' AND source_url='+q(source.url)+' AND is_current=1;');
}
for(const row of discovered){
  const agencyId=agencyBySlug.get(row.agency_slug);
  if(!agencyId)continue;
  statements.push(
    'INSERT INTO management_agency_contacts(agency_id,contact_kind,contact_value,label,source_url,source_title,source_type,confidence,is_current,verified_at,last_checked_at,notes) VALUES('+
    [agencyId,q(row.contact_kind),q(row.contact_value),q(row.label),q(row.source_url),q(row.publisher+' official contact'),q(row.source_type),q(row.confidence),'1',q(checkedAt),q(checkedAt),q('Public professional management contact verified on the official agency website.')].join(',')+
    ') ON CONFLICT(agency_id,contact_kind,contact_value,source_url) DO UPDATE SET label=excluded.label,source_title=excluded.source_title,source_type=excluded.source_type,confidence=excluded.confidence,is_current=1,verified_at=excluded.verified_at,last_checked_at=excluded.last_checked_at,notes=excluded.notes;'
  );
}
if(statements.length){
  writeFileSync(cache+'/sync.sql',statements.join('\n')+'\n');
  wrangler(['d1','execute','cagemetrix',target,'--file',cache+'/sync.sql']);
}
const verification=query(`SELECT a.slug,a.name,c.contact_kind,c.contact_value,c.label,c.source_url,c.confidence,c.verified_at
  FROM scout_primary_management_contact c JOIN management_agencies a ON a.id=c.agency_id
  ORDER BY a.name`);
const representedContact=query(`SELECT COUNT(*) represented,
  SUM(CASE WHEN agency_contact_value IS NOT NULL THEN 1 ELSE 0 END) with_verified_agency_contact,
  SUM(CASE WHEN agency_contact_value IS NULL AND agency_website IS NOT NULL THEN 1 ELSE 0 END) website_fallback_only
  FROM scout_current_management`)[0]||{};
const summary={checked_at:checkedAt,mode:remote?'remote':'local',sources:sourceAudit,contacts_discovered:discovered.length,missing_agencies:missingAgencies,verification,represented_contact_coverage:representedContact};
writeFileSync(cache+'/summary.json',JSON.stringify(summary,null,2)+'\n');
console.log('Management contact sync verified '+verification.length+' primary agency contact route(s); '+Number(representedContact.with_verified_agency_contact||0)+' represented fighter file(s) now resolve to a verified agency contact.');
