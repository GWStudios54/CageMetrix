interface FighterHistoryEnv {
  DB: D1Database;
}

interface FighterProfilePayload {
  fighter?: { id?: number; ufc_bouts?: number } | null;
  rating?: { provisional?: boolean } | null;
  pre_ufc_bouts?: unknown[];
  show_pre_ufc_history?: boolean;
  history_scope?: string;
}

interface PreUfcBoutRow {
  source_fight_id: string;
  event_date: string;
  organization: string | null;
  event_name: string | null;
  weight_class: string | null;
  is_major_org: number;
  method_raw: string | null;
  method_normalized: string | null;
  method_detail: string | null;
  round_num: number | null;
  time_finish_seconds: number | null;
  result: string;
  opponent_name: string | null;
}

export function shouldSurfacePreUfcHistory(payload: FighterProfilePayload): boolean {
  if (!payload?.fighter?.id) return false;
  if (Number(payload.fighter.ufc_bouts || 0) === 0) return true;
  if (!payload.rating) return true;
  return Boolean(payload.rating.provisional);
}

export async function augmentFighterProfileWithPreUfcHistory(
  response: Response,
  env: FighterHistoryEnv
): Promise<Response> {
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return response;

  const payload = await response.clone().json<FighterProfilePayload>();
  const fighterId = Number(payload?.fighter?.id || 0);
  const showPreUfc = shouldSurfacePreUfcHistory(payload);

  if (!fighterId || !showPreUfc) {
    payload.pre_ufc_bouts = [];
    payload.show_pre_ufc_history = false;
    payload.history_scope = 'ufc';
  } else {
    try {
      const rows = await env.DB.prepare(`
        SELECT
          h.source_fight_id,
          h.event_date,
          h.organization,
          h.event_name,
          h.weight_class,
          h.is_major_org,
          h.method_raw,
          h.method_normalized,
          h.method_detail,
          h.round_num,
          h.time_finish_seconds,
          h.result,
          h.opponent_name
        FROM ufc_warehouse_career_rows h
        JOIN mma_source_registry r
          ON r.source_key = h.source_key
         AND r.active_snapshot_id = h.snapshot_id
        WHERE h.fighter_id = ?1
        ORDER BY h.event_date DESC, h.source_fight_id DESC
        LIMIT 60
      `).bind(fighterId).all<PreUfcBoutRow>();

      payload.pre_ufc_bouts = (rows.results || []).map(row => ({
        ...row,
        source_type: 'pre_ufc',
        organization: row.organization || 'Pre-UFC',
      }));
      payload.show_pre_ufc_history = payload.pre_ufc_bouts.length > 0;
      payload.history_scope = payload.show_pre_ufc_history ? 'combined' : 'ufc';
    } catch (error) {
      console.error('Unable to load verified pre-UFC profile history', error);
      payload.pre_ufc_bouts = [];
      payload.show_pre_ufc_history = false;
      payload.history_scope = 'ufc';
    }
  }

  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(payload, null, 2), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
