import {createHash} from 'node:crypto';

// Wikimedia's own API etiquette requires a descriptive User-Agent identifying the tool and a contact
// point; a generic UA gets throttled harder. https://meta.wikimedia.org/wiki/User-Agent_policy
export const WIKIPEDIA_USER_AGENT='MMAScoutsAmateurRecordResearch/1.0 (+https://mmascouts.com/; contact: research@mmascouts.com)';
export const WIKIPEDIA_API='https://en.wikipedia.org/w/api.php';

export function wikipediaLookupUrl(fighterName){
  const params=new URLSearchParams({action:'query',titles:fighterName,redirects:'1',prop:'revisions',rvprop:'content',rvslots:'main',format:'json'});
  return `${WIKIPEDIA_API}?${params.toString()}`;
}

// Real Template:Infobox martial artist parameter names, verified against the template's own
// documentation (Template:Infobox martial artist/doc) and a real article (Ian Machado Garry's
// infobox: am_win=6, am_kowin=5, am_subwin=1, am_loss=1). Wins/losses come straight from am_win/
// am_loss -- there is no need to sum the KO/submission/decision breakdown fields ourselves.
function infoboxField(wikitext,name){
  const match=wikitext.match(new RegExp(`\\|\\s*${name}\\s*=\\s*([^\\n|]*)`,'i'));
  if(!match)return null;
  const value=match[1].replace(/<!--.*?-->/g,'').trim();
  return value||null;
}
function infoboxNumber(wikitext,name){
  const raw=infoboxField(wikitext,name);if(raw==null)return 0;
  const n=Number.parseInt(raw.replace(/[^\d-]/g,''),10);
  return Number.isFinite(n)&&n>=0?n:0;
}

export function hasMartialArtistInfobox(wikitext){return /\{\{\s*Infobox martial artist/i.test(wikitext);}
export function hasAmateurRecord(wikitext){
  return infoboxField(wikitext,'am_win')!=null||infoboxField(wikitext,'am_loss')!=null||infoboxField(wikitext,'am_draw')!=null||infoboxField(wikitext,'am_nc')!=null;
}

export function extractAmateurRecord(wikitext){
  return {
    wins:infoboxNumber(wikitext,'am_win'),
    losses:infoboxNumber(wikitext,'am_loss'),
    draws:infoboxNumber(wikitext,'am_draw'),
    noContests:infoboxNumber(wikitext,'am_nc')
  };
}

// {{birth date and age|df=yes|1997|11|17}} or {{birth date and age|1997|11|17}} or
// {{birth date|1997|11|17}} -- all real, common forms. Matched against the whole wikitext rather
// than through infoboxField, because that helper stops at the first "|" and a birth-date template
// call is itself full of pipe-separated parameters -- it would otherwise truncate to nothing before
// reaching the actual year/month/day.
export function extractBirthDate(wikitext){
  const match=String(wikitext||'').match(/\{\{\s*birth date(?:\s+and\s+age)?\s*\|(?:df=(?:yes|y|no|n)\|)?(\d{4})\|(\d{1,2})\|(\d{1,2})/i);
  if(!match)return null;
  const [,year,month,day]=match;
  return `${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`;
}

export function extractBirthPlace(wikitext){
  const raw=infoboxField(wikitext,'birth_place');if(!raw)return null;
  return raw.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g,'$2').replace(/<[^>]+>/g,'').trim()||null;
}

export function candidateKey(sourceUrl,sourceKey,sourceFighterId){
  return createHash('sha256').update(`${sourceUrl}\n${sourceKey}\n${sourceFighterId}`).digest('hex');
}

// Wikipedia is a name-search + disambiguation source, not an exact-substring match against a fixed
// vocabulary the way camps/coaches/injuries are -- a name match alone never implies it's the same
// person. Corroborate against an independent fact already on file (date of birth first, since it's
// the most specific) before treating a candidate as ordinary 'pending' review.
export function identityBasis(wikiBirthDate,ourDob){
  if(!wikiBirthDate||!ourDob)return 'no_independent_fact_on_file';
  const wiki=String(wikiBirthDate).slice(0,10),ours=String(ourDob).slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(wiki)||!/^\d{4}-\d{2}-\d{2}$/.test(ours))return 'no_independent_fact_on_file';
  return wiki===ours?'birth_date_exact_match':'mismatch';
}

export function amateurRecordCandidate(profile,pageTitle,pageUrl,wikitext){
  if(!hasMartialArtistInfobox(wikitext)||!hasAmateurRecord(wikitext))return null;
  const record=extractAmateurRecord(wikitext);
  if(record.wins+record.losses+record.draws+record.noContests<=0)return null;
  const wikiBirthDate=extractBirthDate(wikitext),basis=identityBasis(wikiBirthDate,profile.dob);
  if(basis==='mismatch')return null;
  const birthPlace=extractBirthPlace(wikitext);
  return {
    candidateKey:candidateKey(pageUrl,profile.source_key,profile.source_fighter_id),
    sourceUrl:pageUrl,
    sourceTitle:pageTitle,
    fighterName:profile.fighter_name,
    normalizedName:profile.normalized_name,
    sourceKey:profile.source_key,
    sourceFighterId:profile.source_fighter_id,
    detectedWins:record.wins,
    detectedLosses:record.losses,
    detectedDraws:record.draws,
    detectedNoContests:record.noContests,
    wikiBirthDate,
    ourDob:profile.dob||null,
    identityBasis:basis,
    detectedSummary:`Amateur MMA record ${record.wins}-${record.losses}${record.draws?`-${record.draws}`:''}${record.noContests?` (${record.noContests} NC)`:''} per Wikipedia infobox.${birthPlace?` Birthplace: ${birthPlace}.`:''}`,
    extractionMethod:'infobox_martial_artist_v1',
    reviewStatus:basis==='birth_date_exact_match'?'pending':'needs_identity'
  };
}
