import { execFileSync } from 'node:child_process';

console.log('Applying pending CageMetrix D1 migrations…');
execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'migrations', 'apply', 'cagemetrix', '--remote'], {
  stdio: 'inherit',
  env: process.env
});

execFileSync(process.execPath, ['scripts/backfill-prediction-snapshots.mjs','--remote'], {stdio:'inherit'});
execFileSync(process.execPath, ['scripts/refresh-data.mjs','--remote'], {stdio:'inherit'});
execFileSync(process.execPath, ['scripts/sync-forecasts.mjs','--remote'], {stdio:'inherit'});
execFileSync(process.execPath, ['scripts/generate-sitemap.mjs','--remote'], {stdio:'inherit'});
console.log('CageMetrix ratings, forecasts and sitemap ready.');
