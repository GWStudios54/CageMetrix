import { execFileSync } from 'node:child_process';

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';

console.log('Applying CageMetrix D1 migrations…');
execFileSync(command, ['wrangler', 'd1', 'migrations', 'apply', 'cagemetrix', '--remote'], {
  stdio: 'inherit',
  env: process.env
});

console.log('Bootstrapping CageMetrix data…');
await import('./bootstrap.mjs');
