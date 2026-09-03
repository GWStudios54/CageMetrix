import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const read = path => readFileSync(new URL(`../public/${path}`, import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const row = (name, rank = 1) => ({ name, rank, slug: name.toLowerCase().replaceAll(' ', '-'), current_weight_class: 'Lightweight', metric_value: 70, confidence: 93, sample_bouts: 12, as_of_date: '2026-06-27' });
function harness(search = '') {
  const dom = new JSDOM(read('index.html'), { url: `https://cagemetrix.com/${search}`, runScripts: 'outside-only' });
  const { window } = dom;
  const requests = [];
  window.AbortController = AbortController;
  window.fetch = (url, options) => {
    if (url === '/api/divisions') return Promise.resolve({ ok: true, json: async () => ({ data: [{ weight_class: 'Lightweight' }] }) });
    if (url === '/api/health') return Promise.resolve({ ok: true, json: async () => ({ ok: true, model_version: '0.2.2' }) });
    return new Promise((resolve, reject) => requests.push({ url, options, resolve: (rows, total = rows.length) => resolve({ ok: true, json: async () => ({ data: rows, meta: { total, model_version: '0.2.2' } }) }), reject }));
  };
  window.fighterMedia = { ready: Promise.resolve(), portrait: () => '' };
  window.eval(read('app.js'));
  const el = selector => window.document.querySelector(selector);
  const change = (selector, value, event = 'change') => { el(selector).value = value; el(selector).dispatchEvent(new window.Event(event)); };
  return { dom, window, requests, el, change };
}
test('the latest filter selection wins when responses arrive out of order', async () => {
  const h = harness();
  await tick();
  h.change('#division-select', 'Lightweight');
  h.change('#metric-select', 'striking_offense');
  assert.equal(h.requests.length, 3);
  h.requests[2].resolve([row('Latest Fighter')]);
  await tick();
  h.requests[1].resolve([row('Stale Fighter')]);
  h.requests[0].reject(new Error('Late failure'));
  await tick();
  assert.match(h.el('#ranking-list').textContent, /Latest Fighter/);
  assert.doesNotMatch(h.el('#ranking-list').textContent, /Stale/);
  assert.match(h.el('#ranking-list').textContent, /Striking O/);
  assert.equal(h.el('#retry-rankings').hidden, true);
  assert.equal(h.el('#ranking-list').getAttribute('aria-busy'), 'false');
  h.dom.window.close();
});
test('search invalidates an in-flight response before debounce finishes', async () => {
  const h = harness();
  h.change('#fighter-search', 'Arman', 'input');
  h.requests[0].resolve([row('Old Fighter')]);
  await tick();
  assert.doesNotMatch(h.el('#ranking-list').textContent, /Old Fighter/);
  assert.equal(h.el('#ranking-list').getAttribute('aria-busy'), 'true');
  h.dom.window.close();
});
test('deep links restore filters, pagination and profile return context', async () => {
  const h = harness('?metric=striking_offense&weight_class=Lightweight&q=Fighter&page=2');
  assert.match(h.requests[0].url, /offset=25/);
  assert.match(h.requests[0].url, /min_bouts=1/);
  assert.match(h.requests[0].url, /q=Fighter/);
  h.requests[0].resolve([row('Fighter 26', 26)], 60);
  await tick();
  assert.equal(h.el('.rank-number').textContent, '26');
  assert.match(h.el('.ranking-row').href, /page=2/);
  assert.equal(h.el('#previous-page').disabled, false);
  assert.equal(h.el('#next-page').disabled, false);
  h.change('#metric-select', 'cmr');
  assert.match(h.requests.at(-1).url, /offset=0/);
  h.dom.window.close();
});
test('names are rendered as text, and a failed request can be retried', async () => {
  const h = harness();
  h.requests[0].reject(new Error('Offline'));
  await tick();
  assert.equal(h.el('#retry-rankings').hidden, false);
  h.el('#retry-rankings').click();
  h.requests[1].resolve([row('<img src=x onerror=alert(1)>')]);
  await tick();
  assert.equal(h.el('#ranking-list img'), null);
  assert.match(h.el('.rank-fighter strong').textContent, /<img/);
  h.dom.window.close();
});
test('loaded profiles hide the loader and retain null stats as unavailable', async () => {
  const dom = new JSDOM(read('fighter.html'), { url: 'https://cagemetrix.com/fighters/test?metric=technical&page=2', runScripts: 'outside-only' });
  const { window } = dom;
  const style = window.document.createElement('style');
  style.textContent = read('styles.css') + read('fighter.css') + read('explorer.css');
  window.document.head.appendChild(style);
  window.fighterMedia = { ready: Promise.resolve(), portrait: () => '', photo: () => null };
  window.fetch = async () => ({ ok: true, json: async () => ({ fighter: { name: 'Test Fighter', slug: 'test', active: 1 }, rating: { cmr: 70, sample_bouts: 12, confidence: 90 }, raw: { slpm: null }, recent_bouts: [] }) });
  window.eval(read('fighter.js'));
  await tick();
  const el = id => window.document.querySelector(id);
  assert.equal(el('#fighter-loading').hidden, true);
  assert.equal(window.getComputedStyle(el('#fighter-loading')).display, 'none');
  assert.equal(el('#fighter-content').hidden, false);
  assert.match(el('#raw-stats').textContent, /Sig\. landed \/ min—/);
  assert.match(el('#back-to-rankings').href, /metric=technical&page=2#rankings/);
  dom.window.close();
});
