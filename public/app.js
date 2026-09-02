const label = document.querySelector('#status-label');
const dbLabel = document.querySelector('#database-label');
const dot = document.querySelector('#status-dot');
const metricSelect = document.querySelector('#metric-select');
const divisionSelect = document.querySelector('#division-select');
const rankingList = document.querySelector('#ranking-list');

const metricLabels = {
  cmr: 'CMR',
  striking_offense: 'Striking O',
  striking_defense: 'Striking D',
  wrestling_offense: 'Wrestling O',
  wrestling_defense: 'Wrestling D',
  grappling: 'Grappling',
  strength_of_schedule: 'SoS',
  technical: 'Technical',
  resume: 'Résumé',
  recent_form: 'Form'
};

async function getJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function checkHealth() {
  try {
    const data = await getJson('/api/health');
    label.textContent = data.ok ? `CageMetrix API online · model v${data.model_version || '?'}` : 'API reachable · database not ready';
    dot.classList.add(data.ok ? 'ok' : 'bad');
    dbLabel.textContent = data.ok
      ? 'Opponent-adjusted UFC ratings database'
      : 'CageMetrix model foundation';
  } catch {
    label.textContent = 'API setup pending';
    dot.classList.add('bad');
  }
}

async function loadDivisions() {
  try {
    const payload = await getJson('/api/divisions');
    for (const item of payload.data || []) {
      const option = document.createElement('option');
      option.value = item.weight_class;
      option.textContent = `${item.weight_class} (${item.fighters})`;
      divisionSelect.appendChild(option);
    }
  } catch {
    // Rankings can still load without the division selector.
  }
}

function renderRankings(rows, metric) {
  if (!rows.length) {
    rankingList.innerHTML = '<div class="ranking-loading">No rated fighters match this filter yet.</div>';
    return;
  }
  rankingList.innerHTML = rows.slice(0, 25).map((fighter, index) => {
    const score = Number(fighter.metric_value ?? fighter.cmr ?? 0).toFixed(1);
    const confidence = Math.round(Number(fighter.confidence || 0));
    const provisional = Boolean(fighter.provisional);
    const performance = Number(fighter.performance_cmr);
    const sampleText = `${fighter.sample_bouts || 0} rated bouts · ${confidence}% confidence`;
    const provisionalText = provisional && Number.isFinite(performance)
      ? ` · PROVISIONAL · performance CMR ${performance.toFixed(1)}`
      : '';
    return `<a class="ranking-row" href="/fighters/${encodeURIComponent(fighter.slug)}">
      <span class="rank-number">${index + 1}</span>
      <span class="rank-fighter"><strong>${fighter.name}</strong><small>${fighter.current_weight_class || 'Unknown'} · ${sampleText}${provisionalText}</small></span>
      <span class="rank-confidence">${provisional ? 'PROV.' : `${confidence}% conf.`}</span>
      <span class="rank-score"><small>${metricLabels[metric] || metric}</small><strong>${score}</strong></span>
    </a>`;
  }).join('');
}

async function loadRankings() {
  const metric = metricSelect.value;
  const division = divisionSelect.value;
  rankingList.innerHTML = '<div class="ranking-loading">Recalculating the board…</div>';
  const params = new URLSearchParams({ metric, limit: '25', min_bouts: '2' });
  if (division) params.set('weight_class', division);
  try {
    const payload = await getJson(`/api/rankings?${params}`);
    renderRankings(payload.data || [], metric);
  } catch {
    rankingList.innerHTML = '<div class="ranking-loading">Ratings are still being populated. Check back after the current deployment finishes.</div>';
  }
}

metricSelect.addEventListener('change', loadRankings);
divisionSelect.addEventListener('change', loadRankings);

Promise.allSettled([checkHealth(), loadDivisions()]).then(loadRankings);
