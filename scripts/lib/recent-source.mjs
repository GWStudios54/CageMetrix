import { JSDOM } from 'jsdom';
import { displayName } from './csv.mjs';

export const normalizeName = value => String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/ł/g,'l').replace(/đ/g,'d').replace(/ø/g,'o').replace(/[^a-z0-9]/g, '');
const aliases = new Map([['celiu','liuce'], ['cameronnelson','camnelson'], ['josemontanha','josevitor'], ['levirodriguesjr','levirodrigues'], ['zacharyreese','zachreese'], ['josemigueldelgado','josedelgado'], ['ezraelliott','ezraelliot'], ['michaelvenompage','michaelpage']]);
export const nameKey = name => aliases.get(normalizeName(name)) || normalizeName(name);
const text = el => el?.textContent.replace(/\s+/g, ' ').trim() || '';
const DATE_RE=/^20\d{2}-\d{2}-\d{2}$/;
const MONTHS=['january','february','march','april','may','june','july','august','september','october','november','december'];
const slug = value => String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/ł/gi,'l').replace(/đ/gi,'d').replace(/ø/gi,'o').toLowerCase().replace(/[’']/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const LIVE_FEED_HOST='d29dxerjsp82wz.cloudfront.net';

export function resultSourcesForEvent(name,date){
  const eventName=String(name||'').replace(/\s+/g,' ').trim();
  if(!DATE_RE.test(String(date||'')))return null;
  const [year,month,day]=String(date).split('-');
  const numbered=eventName.match(/^UFC\s+(\d{3,4})(?:\b|:)/i);
  if(numbered){
    const number=numbered[1];
    return {name:eventName,date:String(date),statisticsUrl:`https://www.ufcalendar.com/events/ufc-${number}-${date}`,officialUrl:`https://www.ufc.com/event/ufc-${number}`};
  }
  if(/^UFC\s+Fight Night\b/i.test(eventName)){
    const monthName=MONTHS[Number(month)-1];
    if(!monthName)return null;
    return {name:eventName,date:String(date),statisticsUrl:`https://www.ufcalendar.com/events/ufc-fight-night-${date}`,officialUrl:`https://www.ufc.com/event/ufc-fight-night-${monthName}-${day}-${year}`};
  }
  return null;
}

export function boutSourceUrls(eventUrl,bout){
  const red=slug(bout?.redSlug||bout?.red),blue=slug(bout?.blueSlug||bout?.blue);
  if(!eventUrl||!red||!blue)return [];
  const base=String(eventUrl).replace(/\/$/,'');
  return [...new Set([`${base}/${red}-vs-${blue}`,`${base}/${blue}-vs-${red}`])];
}

export function officialFeedEventId(url){
  try{
    const parsed=new URL(String(url));
    if(parsed.protocol!=='https:'||parsed.hostname!==LIVE_FEED_HOST)return null;
    return parsed.pathname.match(/^\/api\/v3\/event\/live\/(\d+)\.json$/)?.[1]||null;
  }catch{return null;}
}

export function eventIdFromOfficialPage(html){
  const dom=new JSDOM(String(html||''));
  const raw=dom.window.document.querySelector('script[data-drupal-selector="drupal-settings-json"]')?.textContent||'';
  dom.window.close();
  try{
    const value=JSON.parse(raw)?.eventLiveStats?.event_fmid;
    return /^\d+$/.test(String(value))?String(value):null;
  }catch{return null;}
}

const normalizeStatValue=value=>String(value||'').trim().replace(/^(\d+)\s*\/\s*(\d+)$/,'$1 of $2');
const fighterName=fighter=>`${fighter?.Name?.FirstName||''} ${fighter?.Name?.LastName||''}`.replace(/\s+/g,' ').trim();
const integerStat=(line,key,label)=>{
  const value=line?.[key];
  if(!Number.isInteger(value)||value<0)throw new Error(`Missing or invalid UFC LiveStats ${label}: ${value}`);
  return value;
};

export function officialFightStats(payload,expectedFightId){
  const fight=payload?.LiveFightDetail;
  if(String(fight?.FightId)!==String(expectedFightId))throw new Error(`UFC LiveStats fight mismatch: expected ${expectedFightId}`);
  if(!Array.isArray(fight?.Fighters)||fight.Fighters.length!==2)throw new Error('UFC LiveStats fight does not contain exactly two fighters');
  const red=fight.Fighters.find(f=>f?.Corner==='Red'),blue=fight.Fighters.find(f=>f?.Corner==='Blue');
  if(!red||!blue||!fighterName(red)||!fighterName(blue))throw new Error('UFC LiveStats fighter identity unavailable');
  if(!Array.isArray(fight.FightStats)||fight.FightStats.length<2)throw new Error('UFC LiveStats fight totals unavailable');
  const ordered=[red,blue];
  const lines=ordered.map(f=>fight.FightStats.find(line=>String(line?.FighterId)===String(f.FighterId)));
  if(lines.some(line=>!line))throw new Error('UFC LiveStats totals do not match fight competitors');
  const pairs=(landed,attempted,label)=>lines.map(line=>{
    const l=integerStat(line,landed,`${label} landed`),a=integerStat(line,attempted,`${label} attempted`);
    if(l>a)throw new Error(`Invalid UFC LiveStats ${label}: ${l}/${a}`);
    return `${l} of ${a}`;
  });
  const control=lines.map(line=>{
    const value=String(line?.ControlTime||'').trim();
    if(!/^\d+:[0-5]\d$/.test(value))throw new Error(`Invalid UFC LiveStats control time: ${value}`);
    return value;
  });
  const values=new Map([
    ['Knockdowns',lines.map(line=>String(integerStat(line,'Knockdowns','knockdowns')))],
    ['Significant strikes',pairs('SigStrikesLanded','SigStrikesAttempted','significant strikes')],
    ['Total strikes',pairs('TotalStrikesLanded','TotalStrikesAttempted','total strikes')],
    ['Takedowns',pairs('TakedownsLanded','TakedownsAttempted','takedowns')],
    ['Submission attempts',lines.map(line=>String(integerStat(line,'SubmissionsAttempted','submission attempts')))],
    ['Control time',control]
  ]);
  const outcome=value=>String(value?.Outcome?.Outcome||'').trim().toLowerCase();
  const redOutcome=outcome(red),blueOutcome=outcome(blue);
  const winner=redOutcome==='win'&&blueOutcome==='loss'?fighterName(red):blueOutcome==='win'&&redOutcome==='loss'?fighterName(blue):null;
  if(!winner)throw new Error(`UFC LiveStats does not contain a decisive final outcome for ${fighterName(red)} vs ${fighterName(blue)}`);
  return {names:[fighterName(red),fighterName(blue)],values,winner};
}

export function mirroredStats(html) {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const heading = [...doc.querySelectorAll('h2')].find(h => ['Fight stats','Fight totals'].includes(text(h)));
  if (!heading) { dom.window.close(); return null; }
  const container = heading.parentElement;
  const grids = [...container.querySelectorAll('div.grid')].filter(el => el.children.length === 3 && el.className.includes('grid-cols-[1fr_auto_1fr]'));
  const names = [text(grids[0]?.children[0]), text(grids[0]?.children[2])];
  const values = new Map(grids.slice(1).map(el => [text(el.children[1]), [normalizeStatValue(text(el.children[0])), normalizeStatValue(text(el.children[2]))]]));
  const required = ['Knockdowns', 'Significant strikes', 'Total strikes', 'Takedowns', 'Submission attempts', 'Control time'];
  for (const label of required) if (!values.has(label)) throw new Error(`Missing source statistic: ${label}`);
  const schema = [...doc.querySelectorAll('script[type="application/ld+json"]')].flatMap(el=>{try{return [JSON.parse(el.textContent)]}catch{return []}}).find(x => x?.['@type'] === 'SportsEvent');
  dom.window.close();
  return { names, values, winner: schema?.winner?.name };
}

export function sourceRow(bout, stats, event, existingNames) {
  const positions = [bout.red, bout.blue].map(name => stats.names.findIndex(n => nameKey(n) === nameKey(name)));
  if (positions.some(i => i < 0) || positions[0] === positions[1]) throw new Error(`Fighter mismatch: ${bout.red}/${bout.blue} vs ${stats.names.join('/')}`);
  const winner = bout.redResult === 'W' ? bout.red : bout.blueResult === 'W' ? bout.blue : null;
  if (!winner || nameKey(stats.winner) !== nameKey(winner)) throw new Error(`Unverified or conflicting result: ${bout.red}/${bout.blue}`);
  const row = { event_date: event.date, event_name: event.name, bout_type: bout.division, method: bout.method,
    round: bout.round, time: bout.time, time_format: `5 Rnd (5-5-5-5-5)`, fight_outcome: bout.redResult === 'W' ? 'red_win' : 'blue_win',
    source_name: event.sourceName || 'UFC LiveStats', source_url: event.boutUrl, official_source_url: event.officialUrl, official_bout_id: bout.officialId };
  for (const [i, side] of ['red','blue'].entries()) {
    const name = bout[side];
    row[`${side}_fighter_name`] = existingNames.get(nameKey(name)) || displayName(name);
    row[`${side}_fighter_result`] = bout[`${side}Result`];
    if (nameKey(row[`${side}_fighter_name`]) === 'brunosilva') {
      const nickname = {'bruno-silva':'Bulldog','bruno-silva-blindado':'Blindado'}[bout[`${side}Slug`]];
      if (!nickname) throw new Error('Recent Bruno Silva bout needs reviewed identity');
      row[`${side}_fighter_nickname`] = nickname;
    }
    for (const [label, suffix] of [['Knockdowns','KD'],['Significant strikes','sig_str'],['Total strikes','total_str'],['Takedowns','TD'],['Submission attempts','sub_att'],['Control time','ctrl']]) {
      const value = stats.values.get(label)[positions[i]];
      const valid = ['sig_str','total_str','TD'].includes(suffix) ? /^\d+ of \d+$/.test(value) : suffix === 'ctrl' ? /^\d+:\d{2}$/.test(value) : /^\d+$/.test(value);
      if (!valid) throw new Error(`Incomplete ${label} for ${name}: ${value}`);
      row[`${side}_fighter_${suffix}`] = value;
    }
  }
  return row;
}
