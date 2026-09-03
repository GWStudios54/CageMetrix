const fighterMedia = (() => {
  let photos = {};
  const escape = text => String(text ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const ready = fetch('/headshots.json').then(response => {
    if (!response.ok) throw new Error('Headshots unavailable');
    return response.json();
  }).then(data => { photos = data; }).catch(() => {});
  document.addEventListener('error', event => {
    if (event.target.matches?.('.portrait img')) event.target.hidden = true;
  }, true);
  function photo(slug) { return photos[slug]; }
  function portrait(fighter, large = false) {
    const record = photo(fighter.slug);
    const initials = String(fighter.name || '?').trim().split(/\s+/).map(part => part[0]).slice(0, 2).join('');
    const allowed = record && /^https:\/\/(?:www\.)?ufc\.com\/images\//.test(record.url);
    return `<span class="portrait${large ? ' portrait-large' : ''}" aria-hidden="true"><span class="portrait-initials">${escape(initials)}</span>${allowed ? `<img src="${escape(record.url)}" alt="" width="${large ? 156 : 52}" height="${large ? 170 : 58}" loading="${large ? 'eager' : 'lazy'}" decoding="async" referrerpolicy="no-referrer" />` : ''}</span>`;
  }
  return { ready, portrait, photo };
})();
