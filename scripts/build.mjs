import { execFileSync } from 'node:child_process';

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';

// Normal application deploys must stay cheap. The large UFC bout/fighter seed is
// intentionally NOT run here; it is a separate maintenance task.
console.log('Applying pending CageMetrix D1 migrations…');
execFileSync(command, ['wrangler', 'd1', 'migrations', 'apply', 'cagemetrix', '--remote'], {
  stdio: 'inherit',
  env: process.env
});

// v0.2.1 is a small, idempotent ratings-only recalibration (~one row per rated
// fighter). Once its state marker exists, this performs only the marker check.
console.log('Checking CageMetrix v0.2.1 rating calibration…');
await import('./recalibrate_v021.mjs');

console.log('CageMetrix application build complete. Full dataset refresh skipped by design.');
