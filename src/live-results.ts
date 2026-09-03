export const RESULT_POLL_SECONDS = 120;
export const PAGE_POLL_SECONDS = 30;
const HOUR = 3_600_000;

export type OfficialBout = {
  officialId: string; red: string; blue: string; redSlug: string; blueSlug: string;
  redOutcome: string; blueOutcome: string; methods: string[]; rounds: string[]; times: string[];
  sourceStatus: string;
};
type StoredBout = {
  id: number; source_key: string; fighter_a_id: number; fighter_b_id: number;
  fighter_a_name: string; fighter_b_name: string; fighter_a_slug: string; fighter_b_slug: string;
  status: string; winner_id: number | null; result_method: string | null;
  result_round: number | null; result_time_seconds: number | null;
};
const tidy = (value: string) => value.replace(/\s+/g, ' ').trim();
const key = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/ł/g,'l').replace(/đ/g,'d').replace(/ø/g,'o').replace(/[^a-z0-9]/g,'');
const aliases: Record<string,string> = { celiu:'liuce', cameronnelson:'camnelson', josemontanha:'josevitor', levirodriguesjr:'levirodrigues', zacharyreese:'zachreese', josemigueldelgado:'josedelgado', ezraelliott:'ezraelliot', michaelvenompage:'michaelpage' };
const nameKey = (value: string) => aliases[key(value)] || key(value);

// HTMLRewriter reads text and profile links only; it never requests page images.
export async function readOfficialCard(response: Response): Promise<OfficialBout[]> {
  const bouts: OfficialBout[] = [];
  let current: OfficialBout | undefined;
  const parser = new HTMLRewriter().on('.c-listing-fight', { element(el) {
    current = { officialId:el.getAttribute('data-fmid') || '', sourceStatus:el.getAttribute('data-status') || '', red:'', blue:'', redSlug:'', blueSlug:'', redOutcome:'', blueOutcome:'', methods:[], rounds:[], times:[] };
    bouts.push(current);
    el.onEndTag(() => { current = undefined; });
  } });
  function collect(selector: string, accept: (bout: OfficialBout, value: string) => void) {
    let target: OfficialBout | undefined, value = '';
    parser.on(selector, {
      element(el) { target=current; value=''; el.onEndTag(() => { if(target)accept(target,tidy(value)); }); },
      text(chunk) { value += chunk.text; }
    });
  }
  for (const side of ['red','blue'] as const) {
    collect(`.c-listing-fight__corner-name--${side}`, (bout,value) => { bout[side]=value; });
    collect(`.c-listing-fight__corner--${side} .c-listing-fight__outcome-wrapper`, (bout,value) => { bout[`${side}Outcome`]=value.toLowerCase(); });
    parser.on(`.c-listing-fight__corner-name--${side} a`, { element(el) {
      if(!current)return;
      const url = new URL(el.getAttribute('href') || '', 'https://www.ufc.com');
      if(url.hostname==='www.ufc.com' && url.pathname.startsWith('/athlete/')) current[`${side}Slug`]=url.pathname.split('/').filter(Boolean).at(-1) || '';
    } });
  }
  for (const [selector,field] of [['method','methods'],['round','rounds'],['time','times']] as const) {
    collect(`.c-listing-fight__result-text.${selector}`, (bout,value) => { if(value)bout[field].push(value); });
  }
  await parser.transform(response).arrayBuffer();
  if(!bouts.length || bouts.some(b=>!/^\d+$/.test(b.officialId) || !b.red || !b.blue) || new Set(bouts.map(b=>b.officialId)).size!==bouts.length) throw new Error('Official card format unavailable');
  return bouts;
}

function sameFighter(name: string, sourceSlug: string, storedName: string, storedSlug: string) {
  if(sourceSlug===storedSlug)return true;
  // The same display name belongs to two UFC fighters; never guess this identity.
  if(nameKey(name)==='brunosilva' || nameKey(storedName)==='brunosilva')return false;
  return nameKey(name)===nameKey(storedName);
}

export function confirmedResult(source: OfficialBout, stored: StoredBout) {
  if(stored.source_key.split(':')[1]!==source.officialId)return null;
  const redIsA=sameFighter(source.red,source.redSlug,stored.fighter_a_name,stored.fighter_a_slug) && sameFighter(source.blue,source.blueSlug,stored.fighter_b_name,stored.fighter_b_slug);
  const redIsB=sameFighter(source.red,source.redSlug,stored.fighter_b_name,stored.fighter_b_slug) && sameFighter(source.blue,source.blueSlug,stored.fighter_a_name,stored.fighter_a_slug);
  if(redIsA===redIsB)return null;
  const method=[...new Set(source.methods)].length===1?source.methods[0]:'';
  if(/^(cancelled|canceled)$/i.test(source.sourceStatus) || /^(cancelled|canceled)$/i.test(method))return {status:'cancelled',winner_id:null,result_method:'Cancelled',result_round:null,result_time_seconds:null};
  const round=[...new Set(source.rounds)].length===1?Number(source.rounds[0]):0;
  const time=[...new Set(source.times)].length===1?source.times[0]:'';
  if(!method || !Number.isInteger(round) || round<1 || round>5 || !/^[0-5]:[0-5]\d$/.test(time))return null;
  const seconds=Number(time.split(':')[0])*60+Number(time.split(':')[1]);
  if(seconds>300)return null;
  const outcomes=[source.redOutcome,source.blueOutcome];
  let winner: number | null;
  if(/\b(draw|no contest|overturned)\b/i.test(method) || /^(nc|n\/c)$/i.test(method)) winner=null;
  else if(outcomes.every(v=>v==='draw') || outcomes.every(v=>['nc','no contest'].includes(v))) winner=null;
  else if(outcomes[0]==='win' && outcomes[1]==='loss') winner=redIsA?stored.fighter_a_id:stored.fighter_b_id;
  else if(outcomes[0]==='loss' && outcomes[1]==='win') winner=redIsA?stored.fighter_b_id:stored.fighter_a_id;
  else return null; // A clock, score, missing opponent or partial winner flag is not final.
  return {status:'completed',winner_id:winner,result_method:method,result_round:round,result_time_seconds:seconds};
}

export function resultCheckDue(startsAt: string, lastAttempt: string | null, nowMs: number) {
  const age=nowMs-Date.parse(startsAt);
  if(!Number.isFinite(age) || age < -7*24*HOUR || age > 72*HOUR)return false;
  const interval=age>=-HOUR/2 && age<=12*HOUR?RESULT_POLL_SECONDS*1000:HOUR;
  return !lastAttempt || nowMs-Date.parse(lastAttempt)>=interval-1000;
}

export async function syncLiveResults(env: {DB:D1Database}, nowMs=Date.now(), fetchCard: typeof fetch=fetch) {
  const now=new Date(nowMs).toISOString();
  const events=await env.DB.prepare(`SELECT e.id,e.starts_at,e.source_url,s.last_attempted_at FROM events e
    LEFT JOIN event_result_sync s ON s.event_id=e.id
    WHERE e.starts_at BETWEEN ? AND ? AND e.source_url IS NOT NULL ORDER BY e.starts_at LIMIT 10`)
    .bind(new Date(nowMs-72*HOUR).toISOString(),new Date(nowMs+7*24*HOUR).toISOString()).all<{id:number;starts_at:string;source_url:string;last_attempted_at:string|null}>();
  let checked=0, changed=0, failures=0;
  for(const event of events.results) {
    if(!resultCheckDue(event.starts_at,event.last_attempted_at,nowMs))continue;
    checked++;
    try {
      let url=new URL(event.source_url);
      if(url.origin!=='https://www.ufc.com' || !url.pathname.startsWith('/event/'))throw new Error('Unrecognized official source');
      let response:Response | undefined;
      const signal=AbortSignal.timeout(20000);
      for(let hop=0;hop<4;hop++) {
        response=await fetchCard(url.toString(),{headers:{accept:'text/html','cache-control':'no-cache'},redirect:'manual',signal,cf:{cacheTtl:0}});
        if(response.status<300 || response.status>=400)break;
        const location=response.headers.get('location');
        if(!location)throw new Error('Official source redirect unavailable');
        url=new URL(location,url);
        if(url.origin!=='https://www.ufc.com' || !url.pathname.startsWith('/event/'))throw new Error('Unrecognized official redirect');
      }
      if(!response)throw new Error('Official source unavailable');
      if(!response.ok)throw new Error(`Official source returned HTTP ${response.status}`);
      const card=await readOfficialCard(response);
      const stored=await env.DB.prepare(`SELECT b.*,a.name AS fighter_a_name,a.slug AS fighter_a_slug,z.name AS fighter_b_name,z.slug AS fighter_b_slug
        FROM bouts b JOIN fighters a ON a.id=b.fighter_a_id JOIN fighters z ON z.id=b.fighter_b_id WHERE b.event_id=? AND b.source_key IS NOT NULL`).bind(event.id).all<StoredBout>();
      const writes:D1PreparedStatement[]=[];
      let eventChanges=0;
      if(nowMs>=Date.parse(event.starts_at))for(const bout of stored.results) {
        const source=card.find(r=>r.officialId===bout.source_key.split(':')[1]);
        if(!source)continue; // Missing rows on a partial live page never imply cancellation.
        const result=confirmedResult(source,bout);
        if(!result || Object.entries(result).every(([key,value])=>bout[key as keyof StoredBout]===value))continue;
        writes.push(env.DB.prepare(`INSERT INTO bout_result_observations(bout_id,observed_at,source_url,result_json) VALUES(?,?,?,?)`).bind(bout.id,now,event.source_url,JSON.stringify(result)));
        writes.push(env.DB.prepare(`UPDATE bouts SET status=?,winner_id=?,result_method=?,result_round=?,result_time_seconds=?,updated_at=? WHERE id=?`)
          .bind(result.status,result.winner_id,result.result_method,result.result_round,result.result_time_seconds,now,bout.id));
        eventChanges++;
      }
      writes.push(env.DB.prepare(`INSERT INTO event_result_sync(event_id,last_attempted_at,last_success_at,last_changed_at,error) VALUES(?,?,?,?,NULL)
        ON CONFLICT(event_id) DO UPDATE SET last_attempted_at=excluded.last_attempted_at,last_success_at=excluded.last_success_at,
        last_changed_at=COALESCE(excluded.last_changed_at,event_result_sync.last_changed_at),error=NULL`).bind(event.id,now,now,eventChanges?now:null));
      // Result changes, their audit records and the successful check timestamp commit together.
      await env.DB.batch(writes);
      changed+=eventChanges;
    } catch(error) {
      failures++;
      const message=error instanceof Error?error.message:'Official source unavailable';
      console.error('Live result check failed',event.id,message);
      await env.DB.prepare(`INSERT INTO event_result_sync(event_id,last_attempted_at,error) VALUES(?,?,?)
        ON CONFLICT(event_id) DO UPDATE SET last_attempted_at=excluded.last_attempted_at,error=excluded.error`).bind(event.id,now,message).run();
    }
  }
  const status={ran_at:now,checked,changed,failures};
  await env.DB.prepare(`INSERT INTO bootstrap_state(key,value) VALUES('results:poller',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(JSON.stringify(status)).run();
  return status;
}
