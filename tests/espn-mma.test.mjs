import test from 'node:test';
import assert from 'node:assert/strict';
import {
  espnBoutNameKey,
  fightDurationSeconds,
  normalizeEspnName,
  parseEspnTechnicalStats,
  promotionSlugForOrganization,
  sameEspnName,
  targetFingerprint,
  withinDays
} from '../scripts/lib/espn-mma.mjs';

test('ESPN MMA name matching is conservative but accent/suffix tolerant', () => {
  assert.equal(normalizeEspnName('José Aldo Jr.'), 'jose aldo');
  assert.equal(normalizeEspnName('Łukasz Brzeski'), 'lukasz brzeski');
  assert.equal(sameEspnName('José Aldo Jr.', 'Jose Aldo'), true);
  assert.equal(sameEspnName('Michael Page', 'Michael Venom Page'), false);
  assert.equal(espnBoutNameKey('A Fighter', 'B Fighter'), espnBoutNameKey('B Fighter', 'A Fighter'));
});

test('promotion matching maps reviewed aliases and rejects UFC', () => {
  const available = new Set(['bellator','pfl','one-championship','lfa','ksw','cage-warriors']);
  assert.equal(promotionSlugForOrganization('Bellator MMA', available), 'bellator');
  assert.equal(promotionSlugForOrganization('Professional Fighters League', available), 'pfl');
  assert.equal(promotionSlugForOrganization('ONE Championship', available), 'one-championship');
  assert.equal(promotionSlugForOrganization('Legacy Fighting Alliance', available), 'lfa');
  assert.equal(promotionSlugForOrganization('UFC', available), null);
  assert.equal(promotionSlugForOrganization("Dana White's Contender Series", available), null);
});

test('ESPN technical statistics normalize required CMR fields', () => {
  const payload = { splits: { categories: [
    { stats: [
      { name: 'significantStrikesLanded', value: 42 },
      { name: 'significantStrikesAttempted', value: 91 },
      { name: 'totalStrikesLanded', value: 70 },
      { name: 'totalStrikesAttempted', value: 123 },
      { name: 'takedownsLanded', value: 3 },
      { name: 'takedownsAttempted', value: 7 },
      { name: 'submissionsAttempted', value: 1 },
      { name: 'controlTime', displayValue: '4:17' },
      { name: 'knockdowns', value: 2 }
    ] }
  ] } };
  assert.deepEqual(parseEspnTechnicalStats(payload), {
    knockdowns: 2,
    sigStrLanded: 42,
    sigStrAttempted: 91,
    totalStrLanded: 70,
    totalStrAttempted: 123,
    tdLanded: 3,
    tdAttempted: 7,
    subAttempts: 1,
    ctrlSeconds: 257,
    complete: true
  });
});

test('invalid landed/attempted relationships are rejected', () => {
  const payload = { splits: { categories: [{ stats: [
    { name: 'significantStrikesLanded', value: 12 },
    { name: 'significantStrikesAttempted', value: 10 },
    { name: 'takedownsLanded', value: 0 },
    { name: 'takedownsAttempted', value: 1 },
    { name: 'controlTime', displayValue: '0:10' }
  ] }] } };
  assert.equal(parseEspnTechnicalStats(payload).complete, false);
});

test('fight timing/date matching has strict bounds', () => {
  assert.equal(fightDurationSeconds(3, 120), 720);
  assert.equal(fightDurationSeconds(0, 120), null);
  assert.equal(withinDays('2026-09-05','2026-09-06',1), true);
  assert.equal(withinDays('2026-09-05','2026-09-07',1), false);
});

test('target fingerprints are order independent and identity sensitive', () => {
  const a = { fighter_id: 1, source_fight_id: 'x', event_date: '2025-01-01', fighter_name: 'A', opponent_name: 'B' };
  const b = { fighter_id: 2, source_fight_id: 'y', event_date: '2025-02-01', fighter_name: 'C', opponent_name: 'D' };
  assert.equal(targetFingerprint([a,b]), targetFingerprint([b,a]));
  assert.notEqual(targetFingerprint([a]), targetFingerprint([{...a, opponent_name:'Z'}]));
});
