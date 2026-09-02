const loading = document.querySelector('#fighter-loading');
const content = document.querySelector('#fighter-content');
const adjustedSection = document.querySelector('#adjusted-section');
const whySection = document.querySelector('#why-section');
const rawSection = document.querySelector('#raw-section');
const recentSection = document.querySelector('#recent-section');
const modelSection = document.querySelector('#model-section');

const metricConfig = [
  ['cmr', 'Ranked CMR'],
  ['technical_rating', 'Technical'],
  ['resume_rating', 'Résumé'],
  ['striking_offense', 'Striking offense'],
  ['striking_defense', 'Striking defense'],
  ['wrestling_offense', 'Wrestling offense'],
  ['wrestling_defense', 'Wrestling defense'],
  ['grappling', 'Grappling'],
  ['strength_of_schedule', 'Strength of schedule'],
  ['recent_form', 'Recent form']
];

function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}

function number(value, digits = 1) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
}

function pct(value, digits = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(digits)}%` : '—';
}

function ratioCopy(kind, ratio) {
  const r = Number(ratio);
  if (!Number.isFinite(r) || r <= 0) return null;
  if (kind === 'sig_offense_vs_expected') {
    const delta = Math.round(Math.abs(r - 1) * 100);
    return r >= 1
      ? [`+${delta}%`, `more significant-strike offense than these opponents typically allow`]
      : [`-${delta}%`, `less significant-strike offense than these opponents typically allow`];
  }
  if (kind === 'td_offense_vs_expected') {
    const delta = Math.round(Math.abs(r - 1) * 100);
    return r >= 1
      ? [`+${delta}%`, `more takedown production than these opponents typically allow`]
      : [`-${delta}%`, `less takedown production than these opponents typically allow`];
  }
  if (kind === 'sig_defense_vs_expected') {
    const suppression = Math.round((1 - (1 / r)) * 100);
    return suppression >= 0
      ? [`${suppression}%`, `less significant-strike offense allowed than expected from this opposition`]
      : [`+${Math.abs(suppression)}%`, `more significant-strike offense allowed than expected`];
  }
  if (kind === 'td_defense_vs_expected') {
    const suppression = Math.round((1 - (1 / r)) * 100);
    return suppression >= 0
      ? [`${suppression}%`, `less opponent takedown production allowed than expected`]
      : [`+${Math.abs(suppression)}%`, `more opponent takedown production allowed than expected`];
  }
  return null;
}

function renderMetricCards(rating, ranks) {
  const root = document.querySelector('#fighter-metrics');
  root.innerHTML = metricConfig.map(([key, label]) => {
    const value = rating?.[key];
    const rank = ranks?.[key];
    const rankText = Number.isFinite(Number(rank)) ? `#${Number(rank)}` : '—';
    return `<article class="fighter-metric-card">
      <span>${esc(label)}</span>
      <strong>${number(value)}</strong>
      <small>${rankText} in active division</small>
    </article>`;
  }).join('');
}

function renderExplanations(components) {
  const root = document.querySelector('#explanation-grid');
  const entries = [
    ['sig_offense_vs_expected', 'Adjusted striking offense'],
    ['sig_defense_vs_expected', 'Adjusted striking defense'],
    ['td_offense_vs_expected', 'Adjusted wrestling offense'],
    ['td_defense_vs_expected', 'Adjusted wrestling defense']
  ];
  root.innerHTML = entries.map(([key, label]) => {
    const copy = ratioCopy(key, components?.[key]);
    if (!copy) return '';
    return `<article class="explanation-card">
      <span>${esc(label)}</span>
      <strong>${esc(copy[0])}</strong>
      <p>${esc(copy[1])}.</p>
    </article>`;
  }).join('') || '<div class="ranking-loading">Opponent-adjustment detail is not available for this sample yet.</div>';
}

function renderRaw(raw) {
  const root = document.querySelector('#raw-stats');
  const items = [
    ['Sig. landed / min', number(raw?.slpm, 2)],
    ['Sig. absorbed / min', number(raw?.sapm, 2)],
    ['Strike accuracy', pct(raw?.strike_accuracy, 0)],
    ['Strike defense', pct(raw?.strike_defense, 0)],
    ['Takedowns / 15', number(raw?.td15, 2)],
    ['Takedown accuracy', pct(raw?.td_accuracy, 0)],
    ['Takedown defense', pct(raw?.td_defense, 0)],
    ['Control / 15', `${number(raw?.control_minutes_per_15, 2)} min`]
  ];
  root.innerHTML = items.map(([label, value]) => `<div class="raw-stat"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');
}

function renderRecent(rows) {
  const root = document.querySelector('#fight-list');
  if (!rows?.length) {
    root.innerHTML = '<div class="ranking-loading">Fight-level history is still being populated for this fighter.</div>';
    return;
  }
  root.innerHTML = rows.map(row => {
    const result = Number(row.won) === 1 ? 'W' : Number(row.won) === 0 ? 'L' : 'D';
    const resultClass = result === 'W' ? 'win' : result === 'L' ? 'loss' : 'draw';
    return `<a class="fight-row" href="/fighters/${encodeURIComponent(row.opponent_slug)}">
      <span class="fight-result ${resultClass}">${result}</span>
      <span class="fight-opponent"><strong>${esc(row.opponent_name)}</strong><small>${esc(row.event_date)} · ${esc(row.weight_class)}</small></span>
      <span class="fight-output"><strong>${Number(row.sig_strikes_landed || 0)}–${Number(row.sig_strikes_absorbed || 0)}</strong><small>sig. strikes</small></span>
    </a>`;
  }).join('');
}

async function load() {
  const slug = decodeURIComponent(location.pathname.replace(/^\/fighters\//, '').replace(/\/$/, ''));
  if (!slug || slug.includes('/')) throw new Error('Invalid fighter path');
  const response = await fetch(`/api/fighters/${encodeURIComponent(slug)}`, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  const { fighter, rating, ranks, raw, recent_bouts: recentBouts } = payload;
  if (!fighter || !rating) throw new Error('Rating not available');

  document.title = `${fighter.name} — CageMetrix`;
  document.querySelector('#fighter-name').textContent = fighter.name;
  document.querySelector('#fighter-division').textContent = fighter.current_weight_class || 'CAGEMETRIX FIGHTER PROFILE';
  document.querySelector('#fighter-cmr').textContent = number(rating.cmr);

  const status = String(fighter.roster_status || (Number(fighter.active) === 1 ? 'active' : 'inactive')).toUpperCase();
  if (Number(fighter.active) === 1 && ranks?.cmr) {
    document.querySelector('#fighter-rank').textContent = `#${ranks.cmr} of ${ranks.field_size} active ${fighter.current_weight_class || ''}${rating.provisional ? ' · provisional' : ''}`;
  } else {
    document.querySelector('#fighter-rank').textContent = `${status} · not included in active rankings`;
  }

  const meta = [];
  meta.push(status);
  if (fighter.stance) meta.push(fighter.stance);
  if (fighter.height_cm) meta.push(`${number(Number(fighter.height_cm) / 2.54, 0)} in height`);
  if (fighter.reach_cm) meta.push(`${number(Number(fighter.reach_cm) / 2.54, 0)} in reach`);
  if (fighter.last_fight_date) meta.push(`last UFC bout ${fighter.last_fight_date}`);
  if (rating.provisional && Number.isFinite(Number(rating.performance_cmr))) meta.push(`performance CMR ${number(rating.performance_cmr)}`);
  document.querySelector('#fighter-meta').textContent = meta.join(' · ');

  renderMetricCards(rating, ranks);
  renderExplanations(rating.components || {});
  renderRaw(raw || {});
  renderRecent(recentBouts || []);

  const sample = document.querySelector('#sample-card');
  const provisionalCopy = rating.provisional
    ? `<p><strong>PROVISIONAL.</strong> Performance CMR ${number(rating.performance_cmr)} is shown separately; ranked CMR ${number(rating.cmr)} includes uncertainty shrinkage.</p>`
    : '<p>Established sample. Ranked CMR and underlying performance are no longer materially separated by uncertainty.</p>';
  sample.innerHTML = `<div class="confidence-number">${Math.round(Number(rating.confidence || 0))}%</div>
    <strong>Model confidence</strong>
    <p>${Number(rating.sample_bouts || 0)} current-division UFC bouts · ${number(rating.sample_minutes, 1)} minutes in the rated sample.</p>
    ${provisionalCopy}
    <div class="confidence-track"><span style="width:${Math.max(0, Math.min(100, Number(rating.confidence || 0)))}%"></span></div>`;

  document.querySelector('#model-label').textContent = `${rating.model_name || 'CageMetrix'} · v${rating.model_version || '0.2.0'}`;

  loading.hidden = true;
  [content, adjustedSection, whySection, rawSection, recentSection, modelSection].forEach(el => { el.hidden = false; });
}

load().catch(error => {
  console.error(error);
  loading.innerHTML = `<strong>Fighter profile unavailable.</strong><br><span class="muted">The rating may still be populating, or this fighter is not in the current UFC dataset.</span><br><br><a class="button secondary" href="/#rankings">Back to rankings</a>`;
});
