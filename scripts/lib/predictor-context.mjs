import {parseDelimited} from './csv.mjs';

const DAY = 86400000;
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export function dateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0,10) === value ? value : null;
}
export function birthDate(value) {
  if (dateOnly(value)) return value;
  const match = String(value || '').trim().match(/^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/);
  if (!match || !MONTHS.includes(match[1])) return null;
  return dateOnly(`${match[3]}-${String(MONTHS.indexOf(match[1])+1).padStart(2,'0')}-${match[2].padStart(2,'0')}`);
}
export function reachCentimeters(value) {
  const match = String(value || '').trim().match(/^(\d+(?:\.\d+)?)\s*"$/);
  const cm = match ? Number(match[1]) * 2.54 : null;
  return cm !== null && cm >= 100 && cm <= 250 ? cm : null;
}
export function normalizedStance(value) {
  const stance = String(value || '').trim().toLowerCase();
  return ['orthodox','southpaw','switch'].includes(stance) ? stance : null;
}

// Only stable biographical fields are read. Current career aggregates are never
// eligible inputs. A present-day profile is not a historical observation.
export function profileIndex(detailsText, source) {
  if (!source?.sha256 || !dateOnly(source.observed_on) || !source.url) throw new Error('Profile source provenance is required');
  const rows = new Map();
  for (const row of parseDelimited(detailsText, ',')) {
    const key = row.fighter_name?.trim().toLowerCase();
    if (!key || rows.has(key)) throw new Error(`Ambiguous profile name: ${key}`);
    rows.set(key, {dob:birthDate(row.DOB),reach_cm:reachCentimeters(row.Reach),stance:normalizedStance(row.Stance),source:{...source}});
  }
  return {
    get(identity) {
      // The sole upstream Bruno Silva row cannot establish which fighter's
      // biometrics it describes. Exclude both; no guessed identity joins.
      if (identity.name.toLowerCase() === 'bruno silva') return null;
      return rows.get(identity.name.trim().toLowerCase()) || null;
    }
  };
}

export function fighterContext(profile, lastUfcFight, eventDate, {policy='retrospective',informationCutoff=eventDate} = {}) {
  if (!dateOnly(eventDate)) throw new Error('A valid fight date is required');
  if (!dateOnly(informationCutoff) || informationCutoff > eventDate) throw new Error('Invalid information cutoff');
  if (!['retrospective','as_of'].includes(policy)) throw new Error('Unknown context policy');
  const observed = dateOnly(profile?.source?.observed_on);
  // Date-only evidence is conservatively usable from the following UTC day.
  const observedBefore = Boolean(observed && observed < informationCutoff);
  const useProfile = Boolean(profile && (policy === 'retrospective' || observedBefore));
  const dob = useProfile ? birthDate(profile.dob) : null;
  const age = dob ? (Date.parse(eventDate) - Date.parse(dob)) / (DAY * 365.25) : null;
  const ageYears = age !== null && age >= 16 && age <= 60 ? age : null;
  if (lastUfcFight != null && (!dateOnly(lastUfcFight) || lastUfcFight >= informationCutoff)) throw new Error('Previous UFC fight must precede the prediction date');
  const gap = lastUfcFight ? (Date.parse(eventDate)-Date.parse(lastUfcFight))/DAY : null;
  const reach = useProfile && Number.isFinite(profile.reach_cm) && profile.reach_cm >= 100 && profile.reach_cm <= 250 ? profile.reach_cm : null;
  return {
    event_date:eventDate, information_cutoff_date:informationCutoff, dob:ageYears === null ? null : dob, age_years:ageYears,
    last_ufc_fight_date:lastUfcFight || null, days_since_ufc_fight:gap,
    reach_cm:reach, stance:useProfile ? normalizedStance(profile.stance) : null,
    profile_source:profile?.source ? {...profile.source} : null,
    profile_observed_before_fight:observedBefore, policy,
    historical_profile_assumption:useProfile && !observedBefore,
    inactivity_scope:'Days since the last recorded UFC appearance, including draws and no contests; not all-promotion inactivity.'
  };
}

export const CONTEXT_GROUPS = Object.freeze({
  age:['age_years_diff','age_centered_square_diff','age_heavy_division_diff','age_womens_division_diff','age_missing_diff'],
  layoff:['log_ufc_layoff_diff','log_ufc_layoff_over_year_diff','ufc_layoff_missing_diff'],
  reach:['reach_cm_diff','reach_missing_diff'],
  stance:['southpaw_vs_orthodox','switch_stance_diff','stance_missing_diff']
});
export const CONTEXT_FEATURE_NAMES = Object.freeze(Object.values(CONTEXT_GROUPS).flat());
function numericPair(a,b,key,transform=value=>value) {
  const knownA=Number.isFinite(a[key]),knownB=Number.isFinite(b[key]);
  return {difference:knownA && knownB ? transform(a[key])-transform(b[key]) : 0,missing:Number(!knownA)-Number(!knownB)};
}
export function contextVector(a,b,weightClass) {
  const age=numericPair(a,b,'age_years');
  const ageSquare=numericPair(a,b,'age_years',v=>(v-30)**2);
  const gap=numericPair(a,b,'days_since_ufc_fight',v=>Math.log1p(v/30));
  const longGap=numericPair(a,b,'days_since_ufc_fight',v=>Math.log1p(Math.max(0,v-365)/365));
  const reach=numericPair(a,b,'reach_cm');
  const stanceA=normalizedStance(a.stance),stanceB=normalizedStance(b.stance);
  const stanceKnown=Boolean(stanceA && stanceB);
  const openStance=stanceKnown ? Number(stanceA==='southpaw' && stanceB==='orthodox')-Number(stanceB==='southpaw' && stanceA==='orthodox') : 0;
  const switchDiff=stanceKnown ? Number(stanceA==='switch')-Number(stanceB==='switch') : 0;
  return [age.difference,ageSquare.difference,['Light Heavyweight','Heavyweight'].includes(weightClass)?age.difference:0,
    String(weightClass).startsWith("Women's ")?age.difference:0,age.missing,gap.difference,longGap.difference,gap.missing,
    reach.difference,reach.missing,openStance,switchDiff,Number(!stanceA)-Number(!stanceB)];
}
