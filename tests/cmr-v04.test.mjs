import test from 'node:test';
import assert from 'node:assert/strict';
import { buildObservations, buildRatings } from '../scripts/lib/model_v04.mjs';

function bout(a, b, date, extra = {}) {
  return {
    red_fighter_name: a,
    blue_fighter_name: b,
    event_date: date,
    event_name: date,
    bout_type: 'Lightweight Bout',
    method: 'Decision - Unanimous',
    round: '3',
    time: '5:00',
    time_format: '3 Rnd (5-5-5)',
    fight_outcome: 'red_win',
    red_fighter_sig_str: '30 of 60',
    blue_fighter_sig_str: '25 of 60',
    red_fighter_TD: '0 of 0',
    blue_fighter_TD: '0 of 0',
    red_fighter_sub_att: '0',
    blue_fighter_sub_att: '0',
    red_fighter_KD: '0',
    blue_fighter_KD: '0',
    red_fighter_ctrl: '0:00',
    blue_fighter_ctrl: '0:00',
    ...extra
  };
}

function rating(rows, name) {
  return buildRatings(buildObservations(rows)).ratings.find(r => r.name === name);
}

test('no takedown attempt means no wrestling-offense evidence, not negative evidence', () => {
  const rows = [
    bout('Alpha', 'Bravo', '2024-01-01', { red_fighter_TD: '0 of 0' }),
    bout('Charlie', 'Delta', '2024-02-01', { red_fighter_TD: '4 of 5', blue_fighter_TD: '0 of 4' })
  ];
  const alpha = rating(rows, 'Alpha');
  assert.equal(alpha.components.td_offense_attempts_effective, 0);
  assert.equal(alpha.wrestlingOffense, 50);
  assert.equal(alpha.reliabilities.wrestlingOffense, 0);
});

test('no takedown faced means no wrestling-defense evidence, not elite defense', () => {
  const rows = [
    bout('Alpha', 'Bravo', '2024-01-01', { blue_fighter_TD: '0 of 0' }),
    bout('Charlie', 'Delta', '2024-02-01', { blue_fighter_TD: '3 of 5' })
  ];
  const alpha = rating(rows, 'Alpha');
  assert.equal(alpha.components.td_defense_attempts_faced_effective, 0);
  assert.equal(alpha.wrestlingDefense, 50);
  assert.equal(alpha.reliabilities.wrestlingDefense, 0);
});

test('actual failed takedown attempts create negative wrestling evidence', () => {
  const rows = [
    bout('Alpha', 'Bravo', '2024-01-01', { red_fighter_TD: '0 of 6' }),
    bout('Charlie', 'Delta', '2024-02-01', { red_fighter_TD: '5 of 6' }),
    bout('Echo', 'Foxtrot', '2024-03-01', { red_fighter_TD: '2 of 5' })
  ];
  const alpha = rating(rows, 'Alpha');
  assert.ok(alpha.components.td_offense_attempts_effective > 0);
  assert.ok(alpha.reliabilities.wrestlingOffense > 0);
  assert.ok(alpha.wrestlingOffense < 50);
});

test('no striking attempt means no striking-offense evidence', () => {
  const rows = [
    bout('Alpha', 'Bravo', '2024-01-01', { red_fighter_sig_str: '0 of 0' }),
    bout('Charlie', 'Delta', '2024-02-01')
  ];
  const alpha = rating(rows, 'Alpha');
  assert.equal(alpha.components.striking_offense_attempts_effective, 0);
  assert.equal(alpha.strikingOffense, 50);
  assert.equal(alpha.reliabilities.strikingOffense, 0);
});

test('pace uses only the fighter own activity, never opponent attempts', () => {
  const lowOpponent = [
    bout('Alpha', 'Bravo', '2024-01-01', {
      red_fighter_sig_str: '15 of 30',
      blue_fighter_sig_str: '10 of 20',
      red_fighter_TD: '1 of 2',
      blue_fighter_TD: '0 of 1'
    })
  ];
  const highOpponent = [
    bout('Alpha', 'Bravo', '2024-01-01', {
      red_fighter_sig_str: '15 of 30',
      blue_fighter_sig_str: '80 of 200',
      red_fighter_TD: '1 of 2',
      blue_fighter_TD: '0 of 12'
    })
  ];
  const a = rating(lowOpponent, 'Alpha');
  const b = rating(highOpponent, 'Alpha');
  assert.equal(a.components.own_pace_activity_raw, b.components.own_pace_activity_raw);
});

test('draws update Elo while no-contests contribute no rating sample', () => {
  const decisive = bout('Alpha', 'Bravo', '2024-01-01');
  const draw = bout('Alpha', 'Bravo', '2024-02-01', { fight_outcome: 'draw', method: 'Decision - Majority' });
  const alphaAfterWin = rating([decisive], 'Alpha');
  const alphaAfterDraw = rating([decisive, draw], 'Alpha');
  const bravoAfterWin = rating([decisive], 'Bravo');
  const bravoAfterDraw = rating([decisive, draw], 'Bravo');
  assert.ok(alphaAfterDraw.eloRaw < alphaAfterWin.eloRaw);
  assert.ok(bravoAfterDraw.eloRaw > bravoAfterWin.eloRaw);

  const nc = bout('Alpha', 'Charlie', '2024-03-01', { fight_outcome: 'no_contest', method: 'Overturned' });
  const alphaAfterNc = rating([decisive, nc], 'Alpha');
  assert.equal(alphaAfterNc.bouts, alphaAfterWin.bouts);
  assert.equal(alphaAfterNc.eloRaw, alphaAfterWin.eloRaw);
});

test('short knockdown fights do not explode finishing confidence', () => {
  const rows = [
    bout('Alpha', 'Bravo', '2024-01-01', {
      method: 'KO/TKO',
      round: '1',
      time: '0:10',
      red_fighter_sig_str: '1 of 1',
      blue_fighter_sig_str: '0 of 0',
      red_fighter_KD: '1'
    }),
    bout('Charlie', 'Delta', '2024-02-01')
  ];
  const alpha = rating(rows, 'Alpha');
  assert.ok(Number.isFinite(alpha.finishing));
  assert.ok(alpha.finishing >= 5 && alpha.finishing <= 99);
  assert.ok(alpha.reliabilities.finishing < 0.1);
  assert.ok(Math.abs(alpha.finishing - 50) < 5);
});

test('published CMR is reconstructable from the displayed top-level components', () => {
  const rows = [
    bout('Alpha', 'Bravo', '2024-01-01', { red_fighter_TD: '2 of 4', blue_fighter_TD: '0 of 2' }),
    bout('Alpha', 'Charlie', '2024-02-01', { red_fighter_sig_str: '55 of 100', blue_fighter_sig_str: '30 of 75' }),
    bout('Delta', 'Echo', '2024-03-01', { red_fighter_TD: '4 of 7', blue_fighter_TD: '1 of 3' })
  ];
  const alpha = rating(rows, 'Alpha');
  const reconstructed =
    0.56 * alpha.technical
    + 0.24 * alpha.resume
    + 0.10 * alpha.strengthOfSchedule
    + 0.10 * alpha.recentForm;
  assert.ok(Math.abs(alpha.cmr - reconstructed) < 1e-9);
  assert.ok(Math.abs(alpha.components.cmr_base - alpha.cmr) < 1e-5);
});
