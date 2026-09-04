import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {prepareDataset,datasetSql,hash} from '../scripts/lib/dataset.mjs';
import {warehouseSummarySnapshot} from '../scripts/lib/warehouse-prior.mjs';
const fixture='red_fighter_name;blue_fighter_name;event_date;event_name;bout_type;fight_outcome;method;round;time;time_format;red_fighter_sig_str;blue_fighter_sig_str;red_fighter_TD;blue_fighter_TD\nAlpha;Bravo;01/01/2020;Test;Flyweight Bout;red_win;Decision - Unanimous;3;5:00;3 Rnd (5-5-5);40 of 80;20 of 50;1 of 2;0 of 1';
test('refresh preserves fighter IDs, raw-row counts and immutable same-date revisions',()=>{
 const db=new DatabaseSync(':memory:');
 for(const file of readdirSync(new URL('../migrations/',import.meta.url)).sort())db.exec(readFileSync(new URL(`../migrations/${file}`,import.meta.url),'utf8'));
 db.exec("INSERT INTO fighters(id,slug,name) VALUES (91,'alpha','Alpha')");
 const data=prepareDataset(fixture,'fighter_name,Height\nAlpha,', '2026-09-03T00:00:00Z');
 db.exec(datasetSql(data));
 assert.equal(db.prepare("SELECT id FROM fighters WHERE slug='alpha'").get().id,91);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bout_totals').get().n,2);
 const previous=db.prepare('SELECT cmr FROM ratings_history WHERE fighter_id=91').get().cmr;
 const revised=prepareDataset(fixture.replace('40 of 80','60 of 80'),'fighter_name,Height\nAlpha,','2026-09-03T01:00:00Z');
 db.exec(datasetSql(revised));
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bout_totals').get().n,2);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ratings_history WHERE fighter_id=91').get().n,2);
 assert.equal(db.prepare('SELECT cmr FROM ratings_history WHERE fighter_id=91 AND snapshot_key=?').get(data.snapshotKey).cmr,previous);
 assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
 assert.throws(()=>prepareDataset(fixture.replace('01/01/2020','01/01/2090'),'fighter_name,Height\nAlpha,','2026-09-03T00:00:00Z'),/future/);
 db.close();
});

test('snapshot identity includes only canonical warehouse model inputs',()=>{
 const rows=[
  {fighter_id:2,pre_ufc_bouts:4,pre_ufc_wins:3,updated_at:'yesterday',source_key:'load-a',snapshot_id:'one'},
  {fighter_id:1,pre_ufc_bouts:8,pre_ufc_wins:6,updated_at:'today',source_key:'load-a',snapshot_id:'one'}
 ];
 const reordered=rows.slice().reverse().map(row=>({...row,updated_at:'tomorrow',source_key:'load-b',snapshot_id:'two'}));
 const fingerprint=value=>hash(JSON.stringify(warehouseSummarySnapshot(value)));
 assert.equal(fingerprint(rows),fingerprint(reordered));
 assert.notEqual(fingerprint(rows),fingerprint(rows.map((row,index)=>index?row:{...row,pre_ufc_wins:2})));
 const first=prepareDataset(fixture,'fighter_name,Height\nAlpha,','2026-09-03T00:00:00Z',{warehouseFingerprint:fingerprint(rows)});
 const changed=prepareDataset(fixture,'fighter_name,Height\nAlpha,','2026-09-03T00:00:00Z',{warehouseFingerprint:fingerprint(rows.map((row,index)=>index?row:{...row,pre_ufc_wins:2}))});
 assert.notEqual(first.snapshotKey,changed.snapshotKey);
 assert.equal(first.ufcSourceFingerprint,changed.ufcSourceFingerprint);
 assert.throws(()=>prepareDataset(fixture,'fighter_name,Height\nAlpha,','2026-09-03T00:00:00Z',{warehouseFingerprint:'bad'}),/warehouse fingerprint/);
});
