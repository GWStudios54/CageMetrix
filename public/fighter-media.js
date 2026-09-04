const fighterMedia = (() => {
  const escape = text => String(text ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const media = new Map();
  const slugify = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  function addCreditsLink() {
    const footer = document.querySelector('footer');
    if (!footer || footer.querySelector('[data-photo-credits]')) return;
    const link = document.createElement('a');
    link.href = '/photo-credits.html';
    link.dataset.photoCredits = 'true';
    link.textContent = 'Photo credits';
    link.className = 'photo-credits-link';
    footer.appendChild(link);
  }

  const ready = fetch('/headshots.json?v=ufc-paris-1', { headers: { accept: 'application/json' } })
    .then(response => response.ok ? response.json() : {})
    .then(rows => {
      for (const [slug, item] of Object.entries(rows || {})) {
        if (item && item.url && item.source_url && item.license) media.set(slug, item);
      }
      if (media.size) addCreditsLink();
    })
    .catch(() => {});

  document.addEventListener('error', event => {
    const target = event.target;
    if (target instanceof HTMLImageElement && target.classList.contains('portrait-photo')) target.remove();
  }, true);

  function portrait(fighter, large = false) {
    const initials = String(fighter.name || '?').trim().split(/\s+/).map(part => part[0]).slice(0, 2).join('');
    const slug = fighter.slug || slugify(fighter.name);
    const item = media.get(slug);
    const className = `portrait${large ? ' portrait-large' : ''}`;
    if (!item) return `<span class="${className}" aria-hidden="true"><span class="portrait-initials">${escape(initials)}</span></span>`;
    const credit = `Photo: ${item.author || item.source || 'Wikimedia Commons'} · ${item.license} · ${item.source || 'Wikimedia Commons'}`;
    return `<span class="${className}" aria-hidden="true" title="${escape(credit)}" data-photo-source="${escape(item.source_url)}" data-photo-license="${escape(item.license)}"><span class="portrait-initials">${escape(initials)}</span><img class="portrait-photo" src="${escape(item.url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></span>`;
  }

  function get(fighter) {
    const slug = fighter?.slug || slugify(fighter?.name);
    return media.get(slug) || null;
  }

  return { ready, portrait, get };
})();
