(() => {
  const form = document.querySelector('#home-research-form');
  const input = document.querySelector('#home-research-input');
  const suggestions = document.querySelector('#home-fighter-suggestions');
  if (!form || !input || !suggestions) return;

  let timer;
  let controller;
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));

  function openScout(question) {
    const q = String(question || '').trim();
    if (!q) return;
    location.href = `/scout?q=${encodeURIComponent(q)}`;
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    openScout(input.value);
  });

  document.querySelectorAll('[data-home-question]').forEach(button => {
    button.addEventListener('click', () => openScout(button.dataset.homeQuestion));
  });

  document.querySelectorAll('[data-fill-question]').forEach(button => {
    button.addEventListener('click', () => {
      input.value = button.dataset.fillQuestion || '';
      input.focus();
      input.dispatchEvent(new Event('input'));
    });
  });

  function hideSuggestions() {
    suggestions.hidden = true;
    suggestions.innerHTML = '';
  }

  async function loadSuggestions() {
    const q = input.value.trim();
    if (q.length < 2) return hideSuggestions();
    controller?.abort();
    controller = new AbortController();
    try {
      const response = await fetch(`/api/fighters?q=${encodeURIComponent(q)}&limit=5`, {
        headers: { accept: 'application/json' },
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const rows = payload.data || [];
      if (!rows.length) return hideSuggestions();
      suggestions.innerHTML = rows.map(fighter => `<a class="home-fighter-result" href="/fighters/${encodeURIComponent(fighter.slug)}">
        <span><strong>${esc(fighter.name)}</strong><small>${esc(fighter.current_weight_class || 'Division unavailable')}${fighter.nationality ? ` · ${esc(fighter.nationality)}` : ''}</small></span>
        <b>Open report →</b>
      </a>`).join('');
      suggestions.hidden = false;
    } catch (error) {
      if (error.name !== 'AbortError') hideSuggestions();
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(loadSuggestions, 180);
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') hideSuggestions();
  });
  document.addEventListener('click', event => {
    if (!form.contains(event.target)) hideSuggestions();
  });
})();
