import { JSDOM } from 'jsdom';
import { displayName } from './csv.mjs';

export const normalizeName = value => String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/ł/g,'l').replace(/đ/g,'d').replace(/ø/g,'o').replace(/[^a-z0-9]/g, '');
const aliases = new Map([['celiu','liuce'], ['cameronnelson','camnelson'], ['josemontanha','josevitor'], ['levirodriguesjr','levirodrigues'], ['zacharyreese','zachreese'], ['josemigueldelgado','josedelgado'], ['ezraelliott','ezraelliot'], ['michaelvenompage','michaelpage']]);
export const nameKey = name => aliases.get(normalizeName(name)) || normalizeName(name);
const text = el => el?.textContent.replace(/\s+/g, ' ').trim() || '';
const spacedText = el => {
  const leaves=[...el.querySelectorAll('*')].filter(node=>node.children.length===0).map(text).filter(Boolean);
  return leaves.length?leaves.join(' '):text(el);
};
const eventDate = url => String(url || '').match(/(20\d{2}-\d{2}-\d{2})(?:[/?#]|$)/)?.[1] || null;
const eventNameFromText = value => {
  const raw=String(value||'').replace(/\s+/g,' ').trim();
  return raw.match(/(UFC\s+(?:\d{3,4}|Fight Night)\s*:[\s\S]*?)(?=MMA\b|$)/i)?.[1]?.trim() || raw.match(/(UFC\s+(?:\d{3,4}|Fight Night)\b)/i)?.[1]?.trim() || '';
};

export function recentResultEvents(html, cutoff='0000-00-00') {
  const dom=new JSDOM(html,{url:'https://www.ufcalendar.com/results'}),doc=dom.window.document,candidates=[];
  const structured=[...doc.querySelectorAll('script[type="application/ld+json"]')].flatMap(el=>{try{return [JSON.parse(el.textContent)]}catch{return []}}).find(x=>x?.['@type']==='ItemList'&&Array.isArray(x.itemListElement));
  if(structured){
    for(const item of structured.itemListElement){
      const url=item?.url?new URL(item.url,'https://www.ufcalendar.com').href:null,name=String(item?.name||'').trim();
      if(url&&name)candidates.push({url,name});
    }
  }
  if(!candidates.length){
    for(const anchor of doc.querySelectorAll('a[href]')){
      let url;try{url=new URL(anchor.getAttribute('href'),'https://www.ufcalendar.com').href}catch{continue}
      if(!url.includes('/events/')||!eventDate(url))continue;
      const name=eventNameFromText(spacedText(anchor));
      if(name)candidates.push({url,name});
    }
  }
  dom.window.close();
  const supported=candidates.filter(e=>/^UFC (?:\d|Fight Night)/i.test(e.name)&&eventDate(e.url));
  if(!supported.length)throw new Error('No recent result archive');
  const unique=new Map(supported.map(e=>[e.url,e]));
  return [...unique.values()].filter(e=>eventDate(e.url)>cutoff).sort((a,b)=>eventDate(a.url).localeCompare(eventDate(b.url)));
}

export function officialBouts(html) {
  const dom = new JSDOM(html);
  const cards = [...dom.window.document.querySelectorAll('.c-listing-fight')];
  const bouts = cards.map(card => {
    const name = side => text(card.querySelector(`.c-listing-fight__corner-name--${side}`));
    const red = name('red'), blue = name('blue');
    const outcome = side => {
      const corner = card.querySelector(`.c-listing-fight__corner--${side}`);
      return corner?.querySelector('.c-listing-fight__outcome--win') ? 'W' : corner?.querySelector('.c-listing-fight__outcome--loss') ? 'L' : '';
    };
    const values = new Map([...card.querySelectorAll('.c-listing-fight__result')].map(el => [text(el.querySelector('.c-listing-fight__result-label')), text(el.querySelector('.c-listing-fight__result-text'))]));
    const sourceSlug = side => card.querySelector(`.c-listing-fight__corner-name--${side} a`)?.href.split('/').at(-1);
    return { red, blue, redSlug:sourceSlug('red'), blueSlug:sourceSlug('blue'), redResult: outcome('red'), blueResult: outcome('blue'), method: values.get('Method'), round: values.get('Round'), time: values.get('Time'), division: text(card.querySelector('.c-listing-fight__class-text')), officialId: card.dataset.fmid };
  }).filter(b => b.red && b.blue && b.method && b.round && b.time);
  dom.window.close();
  if (!bouts.length) throw new Error('Official UFC card has no completed results');
  return bouts;
}

export function mirroredStats(html) {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const heading = [...doc.querySelectorAll('h2')].find(h => text(h) === 'Fight stats');
  if (!heading) { dom.window.close(); return null; }
  const container = heading.parentElement;
  const grids = [...container.querySelectorAll('div.grid')].filter(el => el.children.length === 3 && el.className.includes('grid-cols-[1fr_auto_1fr]'));
  const names = [text(grids[0]?.children[0]), text(grids[0]?.children[2])];
  const values = new Map(grids.slice(1).map(el => [text(el.children[1]), [text(el.children[0]), text(el.children[2])]]));
  const required = ['Knockdowns', 'Significant strikes', 'Total strikes', 'Takedowns', 'Submission attempts', 'Control time'];
  for (const label of required) if (!values.has(label)) throw new Error(`Missing source statistic: ${label}`);
  const schema = [...doc.querySelectorAll('script[type="application/ld+json"]')].flatMap(el=>{try{return [JSON.parse(el.textContent)]}catch{return []}}).find(x => x['@type'] === 'SportsEvent');
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
    source_name: 'UFC / UFCalendar (UFCStats mirror)', source_url: event.boutUrl, official_source_url: event.officialUrl, official_bout_id: bout.officialId };
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
