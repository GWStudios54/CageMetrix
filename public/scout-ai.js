(() => {
  const form = document.querySelector('#scout-ai-form');
  const input = document.querySelector('#scout-ai-question');
  const submit = document.querySelector('#scout-ai-submit');
  const result = document.querySelector('#scout-ai-result');
  const answer = document.querySelector('#scout-ai-answer');
  const meta = document.querySelector('#scout-ai-meta');
  const caveats = document.querySelector('#scout-ai-caveats');
  const sources = document.querySelector('#scout-ai-sources');
  const samples = [...document.querySelectorAll('[data-scout-question]')];

  if (!form || !input || !submit || !result || !answer || !meta || !caveats || !sources) return;

  const setBusy = busy => {
    submit.disabled = busy;
    input.disabled = busy;
    submit.textContent = busy ? 'Scouting…' : 'Ask Scout AI';
    form.setAttribute('aria-busy', busy ? 'true' : 'false');
  };

  const resetResult = () => {
    answer.textContent = '';
    meta.textContent = '';
    caveats.replaceChildren();
    sources.replaceChildren();
  };

  const renderList = (target, items, className) => {
    target.replaceChildren();
    for (const item of items || []) {
      const li = document.createElement('li');
      li.className = className;
      li.textContent = item;
      target.append(li);
    }
  };

  const renderSources = items => {
    sources.replaceChildren();
    for (const source of items || []) {
      if (!source?.href || !source?.label) continue;
      const a = document.createElement('a');
      a.href = source.href;
      a.textContent = source.label;
      a.className = 'scout-source';
      sources.append(a);
    }
  };

  async function ask(question) {
    const cleaned = String(question || '').replace(/\s+/g, ' ').trim();
    if (cleaned.length < 3) return;

    resetResult();
    result.hidden = false;
    answer.textContent = 'Pulling the relevant MMA data…';
    setBusy(true);

    try {
      const response = await fetch('/api/scout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: cleaned }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message || payload?.error || 'Scout AI is unavailable.');

      answer.textContent = payload.answer || 'No answer returned.';
      const confidence = payload.confidence ? ` · ${payload.confidence} confidence` : '';
      const intent = payload.meta?.intent ? payload.meta.intent.replaceAll('_', ' ') : 'research';
      meta.textContent = `Scout AI preview · ${intent}${confidence}`;
      renderList(caveats, payload.caveats, 'scout-caveat');
      renderSources(payload.sources);
    } catch (error) {
      answer.textContent = error instanceof Error ? error.message : 'Scout AI is unavailable.';
      meta.textContent = 'Preview error';
    } finally {
      setBusy(false);
    }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    ask(input.value);
  });

  for (const sample of samples) {
    sample.addEventListener('click', () => {
      const question = sample.getAttribute('data-scout-question') || '';
      input.value = question;
      ask(question);
    });
  }
})();
