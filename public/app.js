const metricSelect = document.querySelector('#metric-select');
const divisionSelect = document.querySelector('#division-select');
const searchInput = document.querySelector('#fighter-search');
const clearSearch = document.querySelector('#clear-search');
const rankingList = document.querySelector('#ranking-list');
const resultsStatus = document.querySelector('#results-status');
const snapshotLabel = document.querySelector('#snapshot-label');
const previousButton = document.querySelector('#previous-page');
const nextButton = document.querySelector('#next-page');
const pageLabel = document.querySelector('#page-label');
const retryButton = document.querySelector('#retry-rankings');
const PAGE_SIZE = 25;
const metricLabels = {
  cmr: 'Scout Rating', striking_offense: 'Striking O', striking_defense: 'Striking D',
  wrestling_offense: 'Wrestling O', wrestling_defense: 'Wrestling D', grappling: 'Grappling',
  strength_of_schedule: 'SoS', technical: 'Technical', resume: 'Résumé', recent_form: 'Form'
};
const initialParams = new URLSearchParams(location.search);
const initialMetric = initialParams.get('metric');
if (Object.hasOwn(metricLabels, initialMetric)) metricSelect.value = initialMetric;
searchInput.value = (initialParams.get('q') || '').slice(0, 100);
let page = Math.min(40001, Math.max(1, Number.parseInt(initialParams.get('page'), 10) || 1));
let requestId = 0;
let controller;
let searchTimer;

function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}
async function getJson(url, signal) {
  const response = await fetch(url, { signal, headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
async function checkHealth() {
  const label = document.querySelector('#status-label');
  const dot = document.querySelector('#status-dot');
  try {
    const data = await getJson('/api/health');
    label.textContent = data.ok ? `MMA Scouts online · model v${data.model_version || '?'}` : 'Research engine reachable · database not ready';
    dot.classList.add(data.ok ? 'ok' : 'bad');
    document.querySelector('#database-label').textContent = 'Opponent-adjusted MMA research database';
  } catch {
    label.textContent = 'Research engine status unavailable';
    dot.classList.add('bad');
  }
}
function addDivision(name) {
  const option = document.createElement('option');
  option.value = name;
  option.textContent = name;
  divisionSelect.appendChild(option);
  if (name === initialParams.get('weight_class')) divisionSelect.value = name;
}
async function loadDivisions() {
  const savedDivision = initialParams.get('weight_class');
  if (savedDivision) addDivision(savedDivision);
  try {
    const payload = await getJson('/api/divisions');
    for (const item of payload.data || []) {
      if (item.weight_class !== savedDivision) addDivision(item.weight_class);
    }
  } catch {
    document.querySelector('#division-status').hidden = false;
  }
}
function rankingUrl() {
  const params = new URLSearchParams();
  if (metricSelect.value !== 'cmr') params.set('metric', metricSelect.value);
  if (divisionSelect.value) params.set('weight_class', divisionSelect.value);
  if (searchInput.value.trim()) params.set('q', searchInput.value.trim());
  if (page > 1) params.set('page', String(page));
  return params.size ? `?${params}` : '';
}
function renderRankings(rows, metric, returnQuery) {
  if (!rows.length) {
    rankingList.innerHTML = '<div class="ranking-loading">No rated fighters found. Try another name or division.</div>';
    return;
  }
  rankingList.innerHTML = rows.map(fighter => {
    const value = fighter.metric_value ?? fighter.cmr;
    const score = value == null ? '—' : Number(value).toFixed(1);
    const confidence = Math.round(Number(fighter.confidence || 0));
    return `<a class="ranking-row" href="/fighters/${encodeURIComponent(fighter.slug)}${esc(returnQuery)}">
      <span class="rank-number">${Number(fighter.rank)}</span>
      ${fighterMedia.portrait(fighter)}
      <span class="rank-fighter"><strong>${esc(fighter.name)}</strong><small>${esc(fighter.current_weight_class || 'Unknown')} · ${Number(fighter.sample_bouts || 0)} rated bouts<span class="mobile-confidence"> · Sample ${confidence}/100${fighter.provisional ? ' · Provisional' : ''}</span></small></span>
      <span class="rank-confidence">${confidence}/100<small>${fighter.provisional ? 'Provisional' : 'Established'}</small></span>
      <span class="rank-score"><small>${metricLabels[metric]}</small><strong>${score}</strong></span>
    </a>`;
  }).join('');
}
function markLoading() {
  controller?.abort();
  requestId += 1;
  rankingList.setAttribute('aria-busy', 'true');
  rankingList.innerHTML = '<div class="ranking-loading">Loading Scout Rankings…</div>';
  resultsStatus.textContent = 'Loading rankings…';
  snapshotLabel.textContent = '';
  pageLabel.textContent = '';
  retryButton.hidden = true;
  previousButton.disabled = true;
  nextButton.disabled = true;
  clearSearch.hidden = !searchInput.value;
}
async function loadRankings() {
  clearTimeout(searchTimer);
  markLoading();
  const id = requestId;
  controller = new AbortController();
  const metric = metricSelect.value;
  const returnQuery = rankingUrl();
  history.replaceState(null, '', `/${returnQuery}${location.hash}`);
  const params = new URLSearchParams({ metric, limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE), min_bouts: '1' });
  if (divisionSelect.value) params.set('weight_class', divisionSelect.value);
  if (searchInput.value.trim()) params.set('q', searchInput.value.trim());
  try {
    const [payload] = await Promise.all([getJson(`/api/rankings?${params}`, controller.signal), fighterMedia.ready]);
    if (id !== requestId) return;
    const rows = payload.data || [];
    const total = Number(payload.meta?.total || 0);
    renderRankings(rows, metric, returnQuery);
    const start = (page - 1) * PAGE_SIZE + 1;
    resultsStatus.textContent = rows.length
      ? `${start}–${start + rows.length - 1} of ${total} rated fighters${searchInput.value.trim() ? ' matching your search' : ''}`
      : (page > 1 ? 'No results on this page. Use Previous to go back.' : 'No matching rated fighters');
    pageLabel.textContent = `Page ${page} of ${Math.max(1, page, Math.ceil(total / PAGE_SIZE))}`;
    previousButton.disabled = page <= 1;
    nextButton.disabled = page * PAGE_SIZE >= total;
    const dates = rows.map(row => row.as_of_date?.slice(0, 10)).filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
    const snapshot = dates.length ? (dates[0] === dates.at(-1) ? dates[0] : `${dates[0]} to ${dates.at(-1)}`) : 'unavailable';
    snapshotLabel.textContent = `Data through ${payload.meta?.data?.source_max_date || snapshot} · Model v${payload.meta?.model_version || '?'}${payload.meta?.data?.stale ? ' · Newer events may be missing' : ''}`;
  } catch (error) {
    if (id !== requestId || error.name === 'AbortError') return;
    rankingList.innerHTML = '<div class="ranking-loading">We couldn’t load the rankings. Your filters are saved. Try again.</div>';
    resultsStatus.textContent = 'Rankings unavailable';
    retryButton.hidden = false;
    previousButton.disabled = page <= 1;
  } finally {
    if (id === requestId) rankingList.setAttribute('aria-busy', 'false');
  }
}
function changeFilters() { page = 1; loadRankings(); }
metricSelect.addEventListener('change', changeFilters);
divisionSelect.addEventListener('change', changeFilters);
searchInput.addEventListener('input', () => {
  page = 1;
  clearTimeout(searchTimer);
  markLoading();
  searchTimer = setTimeout(loadRankings, 250);
});
clearSearch.addEventListener('click', () => {
  searchInput.value = '';
  searchInput.focus();
  changeFilters();
});
previousButton.addEventListener('click', () => { page = Math.max(1, page - 1); loadRankings(); });
nextButton.addEventListener('click', () => { page += 1; loadRankings(); });
retryButton.addEventListener('click', loadRankings);
checkHealth();
loadDivisions();
loadRankings();
