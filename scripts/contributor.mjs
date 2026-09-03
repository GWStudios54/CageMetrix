// Operator-managed named contributors, without public sign-up or user accounts.
// Only SHA-256 token hashes enter D1; plaintext keys are written to ignored files.
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {q} from './lib/dataset.mjs';
const args=process.argv.slice(2),mode=args[0],value=flag=>args[args.indexOf(flag)+1];
if(!args.includes('--local')&&!args.includes('--remote'))throw new Error('Choose --local or --remote');
const persist=args.includes('--persist-to')?['--persist-to',value('--persist-to')]:[];
const execute=sql=>execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','cagemetrix',args.includes('--remote')?'--remote':'--local',...persist,'--command',sql],{stdio:'inherit'});
if(mode==='create'){
  const slug=value('--slug'),name=value('--name');
  if(!args.includes('--slug')||!args.includes('--name')||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||slug.length>80||!name.trim()||name.length>80)throw new Error('Supply --slug and --name (at most 80 characters).');
  execute(`INSERT INTO contributors(slug,display_name) VALUES(${q(slug)},${q(name)}) ON CONFLICT(slug) DO NOTHING`);
  const token=`cm_${randomBytes(32).toString('base64url')}`,id=randomUUID(),hash=createHash('sha256').update(token).digest('hex');
  execute(`INSERT INTO contributor_keys(id,contributor_id,token_hash) SELECT ${q(id)},id,${q(hash)} FROM contributors WHERE slug=${q(slug)}`);
  mkdirSync('.cache/contributors',{recursive:true});
  const path=`.cache/contributors/${slug}-${id}.txt`;
  writeFileSync(path,token+'\n',{mode:0o600,flag:'wx'});
  console.log(`Publishing key saved to ignored file ${path}. Key ID for revocation: ${id}. Share the file privately with this contributor.`);
}else if(mode==='revoke'){
  const id=value('--key-id');if(!args.includes('--key-id')||!/^[a-f0-9-]{36}$/.test(id))throw new Error('Supply --key-id from key creation.');
  execute(`UPDATE contributor_keys SET revoked_at=CURRENT_TIMESTAMP WHERE id=${q(id)} AND revoked_at IS NULL`);
}else throw new Error('Use create --slug NAME --name "Display Name", or revoke --key-id ID.');
