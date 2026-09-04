function careerEsc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}

function resultClass(result) {
  if (result === 'W') return 'win';
  if (result === 'L') return 'loss';
  return 'draw';
}

function formatRound(row) {
  const parts = [];
  if (row.round_num) parts.push(`R${Number(row.round_num)}`);
  if (Number.isFinite(Number(row.time_finish_seconds)) && Number(row.time_finish_seconds) >= 0) {
    const seconds = Number(row.time_finish_seconds);
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
    parts.push(`${mins}:${secs}`);
  }
  return parts.join(' · ');
}

function renderCareerRow(row) {
  const isUfc = row.source_type === 'ufc';
  const result = row.result || (Number(row.won) === 1 ? 'W' : Number(row.won) === 0 ? 'L' : 'D');
  const organization = isUfc ? 'UFC' : (row.organization || 'Pre-UFC');
  const opponent = row.opponent_name || 'Opponent unavailable';
  const meta = [row.event_date, organization, row.weight_class].filter(Boolean).join(' · ');

  let outputStrong = '';
  let outputSmall = '';
  if (isUfc) {
    outputStrong = `${Number(row.sig_strikes_landed || 0)}–${Number(row.sig_strikes_absorbed || 0)}`;
    outputSmall = 'sig. strikes';
  } else {
    outputStrong = row.method_normalized || row.method_raw || 'Result';
    outputSmall = formatRound(row) || row.method_detail || (Number(row.is_major_org) === 1 ? 'major promotion' : 'verified pre-UFC bout');
  }

  const inner = `
    <span class="fight-result ${resultClass(result)}">${careerEsc(result)}</span>
    <span class="fight-opponent"><strong>${careerEsc(opponent)}</strong><small>${careerEsc(meta)}</small></span>
    <span class="fight-output"><strong>${careerEsc(outputStrong)}</strong><small>${careerEsc(outputSmall)}</small></span>`;

  if (isUfc && row.opponent_slug) {
    return `<a class="fight-row" href="/fighters/${encodeURIComponent(row.opponent_slug)}">${inner}</a>`;
  }
  return `<div class="fight-row">${inner}</div>`;
}

function waitForBaseProfile() {
  return new Promise(resolve => {
    const loading = document.querySelector('#fighter-loading');
    if (!loading || loading.hidden) return resolve();
    const observer = new MutationObserver(() => {
      if (loading.hidden) {
        observer.disconnect();
        resolve();
      }
    });
    observer.observe(loading, { attributes: true, attributeFilter: ['hidden'] });
    setTimeout(() => {
      observer.disconnect();
      resolve();
    }, 5000);
  });
}

async function loadCareerHistory() {
  const slug = decodeURIComponent(location.pathname.replace(/^\/fighters\//, '').replace(/\/$/, ''));
  if (!slug || slug.includes('/')) return;

  const response = await fetch(`/api/fighters/${encodeURIComponent(slug)}`, { headers: { accept: 'application/json' } });
  if (!response.ok) return;
  const payload = await response.json();
  const preUfc = payload.pre_ufc_bouts || [];
  if (!payload.show_pre_ufc_history || !preUfc.length) return;

  await waitForBaseProfile();
  const section = document.querySelector('#recent-section');
  const root = document.querySelector('#fight-list');
  if (!section || !root) return;

  const ufc = (payload.recent_bouts || []).map(row => ({ ...row, source_type: 'ufc', organization: 'UFC' }));
  const rows = [...ufc, ...preUfc].sort((a, b) => String(b.event_date || '').localeCompare(String(a.event_date || '')));

  const eyebrow = section.querySelector('.eyebrow');
  const heading = section.querySelector('h2');
  const copy = section.querySelector('.section-heading > p');
  if (eyebrow) eyebrow.textContent = 'CAREER FIGHT HISTORY';
  if (heading) heading.textContent = 'UFC + pre-UFC résumé';
  if (copy) copy.textContent = 'Verified pre-UFC bouts remain visible while the UFC sample is provisional. UFC bouts retain the richer technical-stat view.';

  root.innerHTML = rows.map(renderCareerRow).join('');
}

loadCareerHistory().catch(error => console.error('Unable to render career history', error));
