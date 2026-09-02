const DAY = 86400000;

const RETIRED = new Map([
  ['jon jones', { source: 'UFC retirement announcement · 2025-06-21' }],
  ['stipe miocic', { source: 'UFC retirement · 2024-11-16' }]
]);

export function resolveRosterStatus(name, lastFight, sourceMaxDate) {
  const normalized = String(name || '').trim().toLowerCase();
  const override = RETIRED.get(normalized);
  if (override) return { status: 'retired', active: 0, source: override.source };

  if (!lastFight || !sourceMaxDate) return { status: 'inactive', active: 0, source: 'CageMetrix activity fallback' };
  const last = new Date(`${lastFight}T00:00:00Z`).valueOf();
  const asOf = new Date(`${sourceMaxDate}T00:00:00Z`).valueOf();
  const days = Math.max(0, (asOf - last) / DAY);

  if (days <= 548) return { status: 'active', active: 1, source: 'UFC bout activity ≤18 months' };
  return { status: 'inactive', active: 0, source: 'No UFC bout in >18 months' };
}
