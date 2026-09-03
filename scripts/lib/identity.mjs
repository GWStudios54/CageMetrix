import { displayName, slugify } from './csv.mjs';

// DataLab does not publish fighter IDs. These are persistent CageMetrix keys,
// not invented UFC IDs. Ambiguous names require a reviewed source discriminator.
export function fighterIdentity(row, side) {
  const name = displayName(row[`${side}_fighter_name`]);
  if (!name) throw new Error(`Missing ${side} fighter name`);
  const nickname = String(row[`${side}_fighter_nickname`] || '').trim().toLowerCase();
  let slug = slugify(name);
  let sourceUrl = null;
  if (name.toLowerCase() === 'bruno silva') {
    if (!['bulldog', 'blindado'].includes(nickname)) {
      throw new Error(`Ambiguous Bruno Silva identity (${row.event_date}); expected Bulldog or Blindado`);
    }
    slug = nickname === 'blindado' ? 'bruno-silva-blindado' : 'bruno-silva';
    sourceUrl = `https://www.ufc.com/athlete/${slug}`;
  }
  return { id: `cagemetrix:${slug}`, name, slug, nickname, sourceUrl };
}

export function assertIdentityConsistency(pairs) {
  const identities = new Map();
  const bouts = new Set();
  for (const { red, blue } of pairs) {
    if (red.fighterId === blue.fighterId) throw new Error(`Self-bout: ${red.fighterId}`);
    // Early tournaments sometimes repeated the same matchup on the same night.
    const boutKey = `${red.eventDate}:${red.row.event_name}:${[red.fighterId, blue.fighterId].sort().join(':')}:${red.row.method}:${red.row.round}:${red.row.time}`;
    if (bouts.has(boutKey)) throw new Error(`Duplicate source bout: ${boutKey}`);
    bouts.add(boutKey);
    for (const obs of [red, blue]) {
      const prior = identities.get(obs.fighterId);
      if (prior && prior.name !== obs.name) throw new Error(`Identity slug collision: ${prior.name} / ${obs.name}`);
      identities.set(obs.fighterId, obs.identity);
    }
  }
  return identities;
}
