const fighterMedia = (() => {
  const escape = text => String(text ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const ready = Promise.resolve();
  function portrait(fighter, large = false) {
    const initials = String(fighter.name || '?').trim().split(/\s+/).map(part => part[0]).slice(0, 2).join('');
    return `<span class="portrait${large ? ' portrait-large' : ''}" aria-hidden="true"><span class="portrait-initials">${escape(initials)}</span></span>`;
  }
  return { ready, portrait };
})();
