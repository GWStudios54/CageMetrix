import { spawnSync } from 'node:child_process';

const result = spawnSync('python', ['scripts/refresh-ufc-history.py', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
