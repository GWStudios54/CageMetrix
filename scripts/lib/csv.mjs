export function parseDelimited(text, delimiter = ';') {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  const header = rows.shift() || [];
  return rows.filter(r => r.some(Boolean)).map(values => Object.fromEntries(header.map((h, i) => [h, values[i] ?? ''])));
}

export function parsePair(value) {
  const m = String(value || '').match(/(\d+)\s+of\s+(\d+)/i);
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
}

export function parseClock(value) {
  const m = String(value || '').match(/(\d+):(\d+)/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

export function parseDate(value) {
  const m = String(value || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(value);
  return Number.isNaN(d.valueOf()) ? null : d.toISOString().slice(0, 10);
}

export function parseHeightCm(value) {
  const m = String(value || '').match(/(\d+)'\s*(\d+)?/);
  return m ? ((Number(m[1]) * 12) + Number(m[2] || 0)) * 2.54 : null;
}

export function parseReachCm(value) {
  const m = String(value || '').match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) * 2.54 : null;
}

export function slugify(name) {
  return String(name).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function displayName(name) {
  const s = String(name || '').trim();
  if (!s || /[a-z]/.test(s)) return s;
  return s.toLowerCase().replace(/(^|[\s'’-])([a-z])/g, (_, p, c) => p + c.toUpperCase()).replace(/\bMc([a-z])/g, (_, c) => `Mc${c.toUpperCase()}`);
}
