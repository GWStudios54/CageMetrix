import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const migration=readFileSync(new URL('../migrations/0012_global_fight_warehouse.sql',import.meta.url),'utf8');
const importer=readFileSync(new URL('../scripts/global-warehouse/export_duckdb_to_d1.py',import.meta.url),'utf8');
const workflow=readFileSync(new URL('../.github/workflows/global-fight-warehouse.yml',import.meta.url),'utf8');

test('global warehouse migration is isolated from production prediction tables',()=>{
  const creates=[...migration.matchAll(/CREATE TABLE\s+([A-Za-z0-9_]+)/gi)].map(match=>match[1]);
  assert.ok(creates.length>=6);
  assert.ok(creates.every(name=>name.startsWith('warehouse_')),creates);
  assert.doesNotMatch(migration,/\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+)?(?:fighters|bouts|predictions|ratings_history)\b/i);
  assert.match(migration,/warehouse_fighter_links/);
  assert.match(migration,/match_method TEXT NOT NULL CHECK/);
});

test('warehouse importer preserves provenance and does not manufacture CageMetrix history',()=>{
  assert.match(importer,/SOURCE_KEY\s*=\s*"leandroiber_mma_global_v3"/);
  assert.match(importer,/sha256_file/);
  assert.match(importer,/source_version/);
  assert.match(importer,/Ambiguous matches remain NULL|ambiguous/i);
  assert.doesNotMatch(importer,/INSERT INTO (?:fighters|bouts|predictions|ratings_history)\b/i);
  assert.match(importer,/MAX_STATEMENT_BYTES\s*=\s*90_000/);
});

test('warehouse CI validates locally before any remote D1 import',()=>{
  const localMigration=workflow.indexOf('migrations apply cagemetrix --local');
  const localImport=workflow.indexOf('execute cagemetrix --local');
  const remoteMigration=workflow.indexOf('migrations apply cagemetrix --remote');
  const remoteImport=workflow.indexOf('execute cagemetrix --remote --file');
  assert.ok(localMigration>=0&&localImport>localMigration);
  assert.ok(remoteMigration>localImport&&remoteImport>remoteMigration);
  assert.match(workflow,/github\.event_name != 'pull_request'/);
  assert.match(workflow,/participant_identity_link_rate/);
});
