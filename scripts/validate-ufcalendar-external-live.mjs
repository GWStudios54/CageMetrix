import { mkdirSync, writeFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { mirroredStats, nameKey } from './lib/recent-source.mjs';

const OUT_DIR = '.cache/ufcalendar-external-validation';
mkdirSync(OUT_DIR, { recursive: true });

const controls = [
  {
    promotion: 'PFL',
    fighters: ['Sabrinna de Sousa', 'Cheyanne Bowers'],
    url: 'https://www.ufcalendar.com/events/pfl-2026-05-02/sabrinna-de-sousa-vs-cheyanne-bowers',
    expectation: 'full_attempts'
  },
  {
    promotion: 'PFL',
    fighters: ['Matheus Scheffel', 'Juan Adams'],
    url: 'https://www.ufcalendar.com/events/pfl-pfl-8-2022-08-13/matheus-scheffel-vs-juan-adams',
    expectation: 'partial_attempts'
  },
  {
    promotion: 'KSW',
    fighters: ['Marcin Held', 'Roman Szymanski'],
    url: 'https://www.ufcalendar.com/events/ksw-ksw-95-2024-06-07/marcin-held-vs-roman-szymanski',
    expectation: 'landed_plus_grappling'
  },
  {
    promotion: 'ONE',
    fighters: ['Hector Almonacid', 'Pedro Dantas'],
    url: 'https://www.ufcalendar.com/events/one-fight-night-47-2026-09-05/hector-almonacid-vs-pedro-dantas',
    expectation: 'landed_plus_grappling'
  },
  {
    promotion: 'RIZIN',
    fighters: ['Yuki Motoya', 'Kyoma Akimoto'],
    url: 'https://www.ufcalendar.com/events/rizin-2024-12-31/yuki-motoya-vs-kyoma-akimoto',
    expectation: 'landed_plus_grappling'
  },
  {
    promotion: 'Cage Warriors',
    fighters: ['Aiden Lee', 'Alexander Lööf'],
    url: 'https://www.ufcalendar.com/events/cage-warriors-190-2025-06-27/aiden-lee-vs-alexander-loof',
    expectation: 'landed_plus_grappling'
  },
  {
    promotion: 'Bellator',
    fighters: ['Dalton Rosta', 'Aaron Jeffery'],
    url: 'https://www.ufcalendar.com/events/bellator-298-2023-08-11/dalton-rosta-vs-aar-jeffery'.replace('/aar-','/aaron-'),
    expectation: 'coverage_probe'
  }
];

const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
const pair = value => /^(\d+)\s*(?:\/|of)\s*(\d+)$/.exec(normalize(value));
const integer = value => /^\d+$/.test(normalize(value));
const clock = value => /^\d+:\d{2}$/.test(normalize(value));

async function fetchHtml(url) {
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'user-agent': 'CageMetrix source validation/1.0 (+read-only)'
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(20000)
      });
      if (response.ok) return { status: response.status, finalUrl: response.url, html: await response.text() };
      last = new Error(`HTTP ${response.status} for ${url}`);
      if (response.status === 404) return { status: 404, finalUrl: response.url, html: '' };
    } catch (error) {
      last = error;
    }
    await new Promise(resolve => setTimeout(resolve, 300 * 2 ** attempt));
  }
  throw last;
}

function rawFightTotals(html) {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const text = el => normalize(el?.textContent);
  const heading = [...doc.querySelectorAll('h2')].find(h => ['Fight stats', 'Fight totals'].includes(text(h)));
  if (!heading) {
    dom.window.close();
    return null;
  }
  const container = heading.parentElement;
  const grids = [...container.querySelectorAll('div.grid')]
    .filter(el => el.children.length === 3 && el.className.includes('grid-cols-[1fr_auto_1fr]'));
  const names = [text(grids[0]?.children[0]), text(grids[0]?.children[2])];
  const values = Object.fromEntries(grids.slice(1).map(el => [text(el.children[1]), [text(el.children[0]), text(el.children[2])]]));
  dom.window.close();
  return { names, values };
}

function fieldStatus(raw) {
  if (!raw) return { core: false, fullCmr: false, observedSigAttempts: false, observedTotalAttempts: false, observedTdAttempts: false };
  const values = raw.values;
  const both = (label, predicate) => Array.isArray(values[label]) && values[label].length === 2 && values[label].every(predicate);
  const observedSigAttempts = both('Significant strikes', value => Boolean(pair(value)));
  const observedTotalAttempts = both('Total strikes', value => Boolean(pair(value)));
  const observedTdAttempts = both('Takedowns', value => Boolean(pair(value)));
  const sigLanded = both('Significant strikes', value => Boolean(pair(value)) || integer(value));
  const td = both('Takedowns', value => Boolean(pair(value)) || integer(value));
  const ctrl = both('Control time', clock);
  const kd = !values['Knockdowns'] || both('Knockdowns', integer);
  const sub = !values['Submission attempts'] || both('Submission attempts', integer);
  return {
    core: sigLanded && td && ctrl && kd && sub,
    fullCmr: observedSigAttempts && observedTdAttempts && ctrl && kd && sub,
    observedSigAttempts,
    observedTotalAttempts,
    observedTdAttempts,
    hasKnockdowns: Boolean(values['Knockdowns']),
    hasSubmissionAttempts: Boolean(values['Submission attempts']),
    hasControlTime: Boolean(values['Control time'])
  };
}

const report = {
  generated_at: new Date().toISOString(),
  controls: [],
  http_200: 0,
  identity_verified: 0,
  pages_with_fight_totals: 0,
  core_technical_pages: 0,
  full_cmr_pages: 0,
  mirrored_parser_successes: 0,
  promotions_with_core_technical: [],
  promotions_with_full_cmr: []
};
const corePromotions = new Set();
const fullPromotions = new Set();

for (const control of controls) {
  const result = {
    promotion: control.promotion,
    fighters: control.fighters,
    url: control.url,
    expectation: control.expectation,
    status: null,
    final_url: null,
    identity_verified: false,
    has_fight_totals: false,
    core_technical: false,
    full_cmr: false,
    observed_sig_attempts: false,
    observed_total_attempts: false,
    observed_td_attempts: false,
    mirrored_parser: null,
    raw_values: null,
    error: null
  };
  try {
    const fetched = await fetchHtml(control.url);
    result.status = fetched.status;
    result.final_url = fetched.finalUrl;
    if (fetched.status !== 200) {
      report.controls.push(result);
      console.log(`${control.promotion}: HTTP ${fetched.status} ${control.fighters.join(' vs ')}`);
      continue;
    }
    report.http_200 += 1;
    const bodyKey = nameKey(fetched.html);
    result.identity_verified = control.fighters.every(name => bodyKey.includes(nameKey(name)));
    if (result.identity_verified) report.identity_verified += 1;

    const raw = rawFightTotals(fetched.html);
    result.has_fight_totals = Boolean(raw);
    if (raw) {
      report.pages_with_fight_totals += 1;
      const status = fieldStatus(raw);
      Object.assign(result, {
        core_technical: status.core,
        full_cmr: status.fullCmr,
        observed_sig_attempts: status.observedSigAttempts,
        observed_total_attempts: status.observedTotalAttempts,
        observed_td_attempts: status.observedTdAttempts,
        raw_values: raw.values
      });
      if (status.core) { report.core_technical_pages += 1; corePromotions.add(control.promotion); }
      if (status.fullCmr) { report.full_cmr_pages += 1; fullPromotions.add(control.promotion); }
    }

    try {
      const parsed = mirroredStats(fetched.html);
      result.mirrored_parser = parsed ? {
        names: parsed.names,
        values: Object.fromEntries(parsed.values)
      } : null;
      if (parsed) report.mirrored_parser_successes += 1;
    } catch (error) {
      result.mirrored_parser = { error: String(error?.message || error) };
    }
  } catch (error) {
    result.error = String(error?.stack || error);
  }
  report.controls.push(result);
  console.log(`${control.promotion}: ${result.status} totals=${result.has_fight_totals} core=${result.core_technical} fullCMR=${result.full_cmr} sigAttempts=${result.observed_sig_attempts}`);
}

report.promotions_with_core_technical = [...corePromotions].sort();
report.promotions_with_full_cmr = [...fullPromotions].sort();
report.control_success_rate = report.core_technical_pages / controls.length;
writeFileSync(`${OUT_DIR}/report.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));

if (report.identity_verified < 5) throw new Error(`UFCalendar identity validation too weak: ${report.identity_verified}/${controls.length}`);
if (report.core_technical_pages < 4) throw new Error(`UFCalendar multi-promotion technical coverage too weak: ${report.core_technical_pages}/${controls.length}`);
