export const SITEMAP_ORIGIN = 'https://mmascouts.com';

const xmlEscape = value => String(value).replace(/[&<>"']/g, ch => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;'
}[ch]));

const dateOnly = value => {
  const match = String(value ?? '').match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
};

function entry(loc, lastmod = null) {
  const lines = [`  <url>`, `    <loc>${xmlEscape(loc)}</loc>`];
  const date = dateOnly(lastmod);
  if (date) lines.push(`    <lastmod>${date}</lastmod>`);
  lines.push('  </url>');
  return lines.join('\n');
}

export function sitemapXml({ fighters = [], scoutFighters = [], events = [], promotions = [], agencies = [], camps = [], origin = SITEMAP_ORIGIN } = {}) {
  const base = origin.replace(/\/$/, '');
  const urls = [
    entry(`${base}/`),
    entry(`${base}/scout`),
    entry(`${base}/prospects`),
    entry(`${base}/events`),
    entry(`${base}/promotions`),
    entry(`${base}/camps`),
    entry(`${base}/wire`),
    entry(`${base}/talent`),
    entry(`${base}/management`),
    entry(`${base}/data-policy`),
    entry(`${base}/privacy`),
    ...agencies
      .filter(row => row?.slug)
      .map(row => entry(`${base}/management/${encodeURIComponent(row.slug)}`, row.verified_at || row.updated_at)),
    ...promotions
      .filter(row => row?.slug)
      .map(row => entry(`${base}/promotions/${encodeURIComponent(row.slug)}`, row.verified_at || row.updated_at)),
    ...camps
      .filter(row => row?.slug)
      .map(row => entry(`${base}/camps/${encodeURIComponent(row.slug)}`, row.verified_at || row.updated_at)),
    ...scoutFighters
      .filter(row => row?.profile_slug)
      .map(row => entry(`${base}/scout/fighters/${encodeURIComponent(row.profile_slug)}`, row.last_fight_date || row.updated_at)),
    ...events
      .filter(row => row?.slug)
      .map(row => entry(`${base}/events/${encodeURIComponent(row.slug)}`, row.event_date || row.updated_at)),
    ...fighters
      .filter(row => row?.slug)
      .map(row => entry(`${base}/fighters/${encodeURIComponent(row.slug)}`, row.last_fight_date || row.updated_at))
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}
