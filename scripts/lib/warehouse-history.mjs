export function normalizeWarehouseName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function sqlValue(value) {
  if (value === null || value === undefined || value === '') return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function confidenceForIdentity(nativeFighter, warehouseFighter) {
  const nativeDob = String(nativeFighter?.dob || '').slice(0, 10);
  const warehouseDob = String(warehouseFighter?.dob || '').slice(0, 10);
  if (nativeDob && warehouseDob && nativeDob === warehouseDob) return 0.995;
  return 0.95;
}
