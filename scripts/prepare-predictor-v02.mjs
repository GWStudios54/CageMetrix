import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';

// Reconstruct the audited inputs from a fixed public upstream commit and this
// checkout's supplement. Never fetch the moving main branch for this replay.
const revision='3268146c05211de9deab8b9b4c0bb4a954815f0b';
const root=`https://raw.githubusercontent.com/komaksym/UFC-DataLab/${revision}/data`;
const directory='.cache/predictor-v02-inputs';
const expected=JSON.parse(readFileSync('docs/research/predictor-v02/sources.json','utf8'));
const sha=text=>createHash('sha256').update(text).digest('hex');
if(process.argv.length>2)throw new Error('This pinned research preparation command does not accept deployment or source overrides');
async function source(path){const r=await fetch(`${root}/${path}`,{signal:AbortSignal.timeout(60000)});if(!r.ok)throw new Error(`Pinned input request failed: ${r.status}`);return r.text();}
const [stats,details]=await Promise.all([source('stats/stats_raw.csv'),source('external_data/raw_fighter_details.csv')]);
// The original local profile capture included a final empty CRLF. Reproduce
// those exact bytes, not merely equivalent parsed rows, to honor its hash.
const pinnedDetails=[details,details+'\r\n'].find(text=>sha(text)===expected.details_sha256);
if(pinnedDetails===undefined)throw new Error('Pinned profile source does not match the audited input');
mkdirSync(directory,{recursive:true});
writeFileSync(join(directory,'base-stats.csv'),stats);
writeFileSync(join(directory,'base-details.csv'),pinnedDetails);
execFileSync(process.execPath,['scripts/refresh-data.mjs','--dry-run','--stats',join(directory,'base-stats.csv'),'--details',join(directory,'base-details.csv'),'--output',directory],{stdio:'inherit'});
for(const field of ['stats','details'])if(sha(readFileSync(join(directory,`${field}.csv`)))!==expected[`${field}_sha256`])throw new Error(`Reconstructed ${field} changed; use the audited checkout and source supplement`);
console.log(`Verified exact Predictor 0.2 inputs from UFC DataLab ${revision}. No D1 changes.`);
