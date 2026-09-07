interface ScoutAiBinding {
  run(model: string, input: unknown, options?: unknown): Promise<unknown>;
}

interface ScoutAiEnv {
  DB: D1Database;
  AI?: ScoutAiBinding;
  MODEL_VERSION: string;
}

type ScoutMetric =
  | 'cmr'
  | 'strength_of_schedule'
  | 'recent_form'
  | 'technical'
  | 'resume'
  | 'striking_offense'
  | 'striking_defense'
  | 'wrestling_offense'
  | 'wrestling_defense'
  | 'grappling'
  | 'pace'
  | 'finishing';

type ScoutIntent = 'fighter_profile' | 'compare_fighters' | 'rankings' | 'help';

interface ScoutPlan {
  intent: ScoutIntent;
  fighters: string[];
  division: string;
  metric: ScoutMetric;
  limit: number;
  active_only: boolean;
}

const MODEL = '@cf/meta/llama-3.1-8b-instruct-fast';
const RATING_MODEL_NAME = 'CageMetrix Opponent-Adjusted Rating';
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

const METRIC_SQL: Record<ScoutMetric, string> = {
  cmr: 'rh.cmr',
  strength_of_schedule: 'rh.strength_of_schedule',
  recent_form: 'rh.recent_form',
  technical: 'rh.technical_rating',
  resume: 'rh.resume_rating',
  striking_offense: 'rh.striking_offense',
  striking_defense: 'rh.striking_defense',
  wrestling_offense: 'rh.wrestling_offense',
  wrestling_defense: 'rh.wrestling_defense',
  grappling: 'rh.grappling',
  pace: 'rh.pace',
  finishing: 'rh.finishing',
};

const METRIC_LABEL: Record<ScoutMetric, string> = {
  cmr: 'Scout Rating',
  strength_of_schedule: 'strength of schedule',
  recent_form: 'recent form',
  technical: 'technical rating',
  resume: 'resume rating',
  striking_offense: 'striking offense',
  striking_defense: 'striking defense',
  wrestling_offense: 'wrestling offense',
  wrestling_defense: 'wrestling defense',
  grappling: 'grappling',
  pace: 'pace',
  finishing: 'finishing',
};

const DIVISIONS = new Map<string, string>([
  ['heavyweight', 'Heavyweight'],
  ['light heavyweight', 'Light Heavyweight'],
  ['light-heavyweight', 'Light Heavyweight'],
  ['middleweight', 'Middleweight'],
  ['welterweight', 'Welterweight'],
  ['lightweight', 'Lightweight'],
  ['featherweight', 'Featherweight'],
  ['bantamweight', 'Bantamweight'],
  ['flyweight', 'Flyweight'],
  ["women's bantamweight", "Women's Bantamweight"],
  ['womens bantamweight', "Women's Bantamweight"],
  ["women's flyweight", "Women's Flyweight"],
  ['womens flyweight', "Women's Flyweight"],
  ["women's strawweight", "Women's Strawweight"],
  ['womens strawweight', "Women's Strawweight"],
  ['strawweight', "Women's Strawweight"],
]);

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADERS });
}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeDivision(value: string): string {
  const key = String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return DIVISIONS.get(key) || '';
}

function clampLimit(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(10, Math.trunc(parsed))) : 5;
}

function safeMetric(value: unknown): ScoutMetric {
  const metric = String(value || 'cmr') as ScoutMetric;
  return metric in METRIC_SQL ? metric : 'cmr';
}

function extractAiPayload(value: unknown): any {
  const candidate = (value as any)?.response ?? value;
  if (typeof candidate === 'string') {
    try {
      return JSON.parse(candidate);
    } catch {
      return candidate;
    }
  }
  return candidate;
}

function fallbackPlan(question: string): ScoutPlan {
  const lower = question.toLowerCase();
  let metric: ScoutMetric = 'cmr';
  if (/strength of schedule|toughest schedule|hardest schedule|opponent quality/.test(lower)) metric = 'strength_of_schedule';
  else if (/recent form|hottest|form/.test(lower)) metric = 'recent_form';
  else if (/wrestling defense|takedown defense/.test(lower)) metric = 'wrestling_defense';
  else if (/wrestling|takedown/.test(lower)) metric = 'wrestling_offense';
  else if (/striking defense/.test(lower)) metric = 'striking_defense';
  else if (/striking/.test(lower)) metric = 'striking_offense';
  else if (/grappl/.test(lower)) metric = 'grappling';
  else if (/resume|résumé/.test(lower)) metric = 'resume';
  else if (/finish/.test(lower)) metric = 'finishing';

  const division = [...DIVISIONS.entries()].find(([key]) => lower.includes(key))?.[1] || '';
  const rankingIntent = /best|top|rank|highest|strongest|toughest|hardest/.test(lower);
  return {
    intent: rankingIntent ? 'rankings' : 'help',
    fighters: [],
    division,
    metric,
    limit: 5,
    active_only: true,
  };
}

async function planQuestion(question: string, env: ScoutAiEnv): Promise<ScoutPlan> {
  if (!env.AI) return fallbackPlan(question);

  try {
    const result = await env.AI.run(MODEL, {
      messages: [
        {
          role: 'system',
          content:
            'You are the query planner for MMA Scouts. Convert the user question into a small safe research plan. ' +
            'Use fighter names only when the user actually names them. Never invent fighters. ' +
            'fighter_profile is for one named fighter, compare_fighters is for two named fighters, rankings is for top/best/rank questions, and help is for anything outside the supported MVP. ' +
            'Use an empty string when no division is specified.',
        },
        { role: 'user', content: question },
      ],
      temperature: 0,
      max_tokens: 220,
      response_format: {
        type: 'json_schema',
        json_schema: {
          type: 'object',
          properties: {
            intent: { type: 'string', enum: ['fighter_profile', 'compare_fighters', 'rankings', 'help'] },
            fighters: { type: 'array', items: { type: 'string' }, maxItems: 2 },
            division: { type: 'string' },
            metric: {
              type: 'string',
              enum: [
                'cmr', 'strength_of_schedule', 'recent_form', 'technical', 'resume',
                'striking_offense', 'striking_defense', 'wrestling_offense',
                'wrestling_defense', 'grappling', 'pace', 'finishing',
              ],
            },
            limit: { type: 'integer', minimum: 1, maximum: 10 },
            active_only: { type: 'boolean' },
          },
          required: ['intent', 'fighters', 'division', 'metric', 'limit', 'active_only'],
        },
      },
    });

    const raw = extractAiPayload(result);
    if (!raw || typeof raw !== 'object') return fallbackPlan(question);
    const intent: ScoutIntent = ['fighter_profile', 'compare_fighters', 'rankings', 'help'].includes(raw.intent)
      ? raw.intent
      : 'help';
    const fighters = Array.isArray(raw.fighters)
      ? raw.fighters.map((v: unknown) => String(v || '').trim()).filter(Boolean).slice(0, 2)
      : [];

    return {
      intent,
      fighters,
      division: normalizeDivision(String(raw.division || '')),
      metric: safeMetric(raw.metric),
      limit: clampLimit(raw.limit),
      active_only: raw.active_only !== false,
    };
  } catch (error) {
    console.error('Scout AI planner failed', error);
    return fallbackPlan(question);
  }
}

async function resolveFighter(candidate: string, env: ScoutAiEnv): Promise<any | null> {
  const name = String(candidate || '').trim();
  if (!name) return null;
  const slug = slugify(name);

  const exact = await env.DB.prepare(`
    SELECT id, slug, name, dob, height_cm, reach_cm, stance, nationality,
           current_weight_class, active, roster_status, last_fight_date, ufc_bouts
    FROM fighters
    WHERE lower(name) = lower(?1) OR slug = ?2
    ORDER BY CASE WHEN lower(name) = lower(?1) THEN 0 ELSE 1 END, name COLLATE NOCASE
    LIMIT 1
  `).bind(name, slug).first();
  if (exact) return exact;

  return env.DB.prepare(`
    SELECT id, slug, name, dob, height_cm, reach_cm, stance, nationality,
           current_weight_class, active, roster_status, last_fight_date, ufc_bouts
    FROM fighters
    WHERE lower(name) LIKE lower(?1) OR slug LIKE ?2
    ORDER BY active DESC, ufc_bouts DESC, name COLLATE NOCASE
    LIMIT 1
  `).bind(`%${name}%`, `%${slug}%`).first();
}

function ageFromDob(dob: unknown): number | null {
  if (typeof dob !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(dob)) return null;
  const born = new Date(`${dob.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(born.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - born.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < born.getUTCMonth() ||
    (now.getUTCMonth() === born.getUTCMonth() && now.getUTCDate() < born.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

async function loadFighterEvidence(fighter: any, env: ScoutAiEnv): Promise<any> {
  const fighterId = Number(fighter.id);
  const rating = await env.DB.prepare(`
    SELECT rh.as_of_date, rh.weight_class, rh.cmr, rh.technical_rating, rh.resume_rating,
           rh.striking_offense, rh.striking_defense, rh.wrestling_offense, rh.wrestling_defense,
           rh.grappling, rh.pace, rh.finishing, rh.strength_of_schedule, rh.recent_form,
           rh.confidence, rh.sample_bouts, rh.sample_minutes
    FROM ratings_history rh
    JOIN model_versions mv ON mv.id = rh.model_version_id
    WHERE rh.fighter_id = ?1 AND mv.name = ?2 AND mv.version = ?3
    ORDER BY rh.as_of_date DESC, rh.id DESC
    LIMIT 1
  `).bind(fighterId, RATING_MODEL_NAME, env.MODEL_VERSION).first();

  const raw = await env.DB.prepare(`
    SELECT COUNT(*) AS bouts,
      ROUND(SUM(duration_seconds) / 60.0, 2) AS minutes,
      CASE WHEN SUM(duration_seconds) > 0 THEN ROUND(60.0 * SUM(sig_strikes_landed) / SUM(duration_seconds), 2) END AS slpm,
      CASE WHEN SUM(duration_seconds) > 0 THEN ROUND(60.0 * SUM(sig_strikes_absorbed) / SUM(duration_seconds), 2) END AS sapm,
      CASE WHEN SUM(sig_strikes_attempted) > 0 THEN ROUND(100.0 * SUM(sig_strikes_landed) / SUM(sig_strikes_attempted), 1) END AS strike_accuracy,
      CASE WHEN SUM(sig_strikes_faced) > 0 THEN ROUND(100.0 * (1.0 - (1.0 * SUM(sig_strikes_absorbed) / SUM(sig_strikes_faced))), 1) END AS strike_defense,
      CASE WHEN SUM(duration_seconds) > 0 THEN ROUND(900.0 * SUM(takedowns_landed) / SUM(duration_seconds), 2) END AS td15,
      CASE WHEN SUM(takedowns_attempted) > 0 THEN ROUND(100.0 * SUM(takedowns_landed) / SUM(takedowns_attempted), 1) END AS td_accuracy,
      CASE WHEN SUM(takedowns_faced) > 0 THEN ROUND(100.0 * (1.0 - (1.0 * SUM(takedowns_allowed) / SUM(takedowns_faced))), 1) END AS td_defense
    FROM bout_totals
    WHERE fighter_id = ?1
  `).bind(fighterId).first();

  const recent = await env.DB.prepare(`
    SELECT bt.event_date, bt.weight_class, bt.won, bt.result, bt.finish,
           bt.sig_strikes_landed, bt.sig_strikes_absorbed,
           bt.takedowns_landed, bt.takedowns_allowed, bt.control_seconds,
           opp.name AS opponent_name, opp.slug AS opponent_slug
    FROM bout_totals bt
    JOIN fighters opp ON opp.id = bt.opponent_id
    WHERE bt.fighter_id = ?1
    ORDER BY bt.event_date DESC, bt.id DESC
    LIMIT 8
  `).bind(fighterId).all();

  let preUfc: unknown[] = [];
  try {
    const rows = await env.DB.prepare(`
      SELECT h.event_date, h.organization, h.event_name, h.weight_class,
             h.method_normalized, h.result, h.opponent_name
      FROM ufc_warehouse_career_rows h
      JOIN mma_source_registry r
        ON r.source_key = h.source_key AND r.active_snapshot_id = h.snapshot_id
      WHERE h.fighter_id = ?1
      ORDER BY h.event_date DESC, h.source_fight_id DESC
      LIMIT 12
    `).bind(fighterId).all();
    preUfc = rows.results || [];
  } catch (error) {
    console.error('Scout AI pre-UFC evidence unavailable', error);
  }

  return {
    fighter: { ...fighter, age: ageFromDob(fighter.dob) },
    rating,
    official_ufc_aggregate: raw,
    recent_ufc_bouts: recent.results || [],
    pre_ufc_history: preUfc,
  };
}

async function loadRankings(plan: ScoutPlan, env: ScoutAiEnv): Promise<any[]> {
  const sortColumn = METRIC_SQL[plan.metric];
  const clauses = [
    'mv.name = ?1',
    'mv.version = ?2',
    `rh.id = (SELECT newest.id FROM ratings_history newest
      WHERE newest.fighter_id = rh.fighter_id AND newest.model_version_id = rh.model_version_id
      ORDER BY newest.as_of_date DESC, newest.id DESC LIMIT 1)`,
    'rh.sample_bouts >= 1',
  ];
  const bindings: unknown[] = [RATING_MODEL_NAME, env.MODEL_VERSION];
  if (plan.active_only) clauses.push('f.active = 1');
  if (plan.division) {
    bindings.push(plan.division);
    clauses.push(`f.current_weight_class = ?${bindings.length}`);
  }
  bindings.push(plan.limit);

  const rows = await env.DB.prepare(`
    SELECT f.slug, f.name, f.dob, f.current_weight_class, f.ufc_bouts,
           rh.cmr, rh.technical_rating, rh.resume_rating, rh.strength_of_schedule,
           rh.recent_form, rh.striking_offense, rh.striking_defense,
           rh.wrestling_offense, rh.wrestling_defense, rh.grappling, rh.pace,
           rh.finishing, rh.confidence, rh.sample_bouts, rh.as_of_date,
           ${sortColumn} AS metric_value
    FROM fighters f
    JOIN ratings_history rh ON rh.fighter_id = f.id
    JOIN model_versions mv ON mv.id = rh.model_version_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY ${sortColumn} DESC, rh.confidence DESC, f.name COLLATE NOCASE
    LIMIT ?${bindings.length}
  `).bind(...bindings).all();

  return (rows.results || []).map((row: any, index: number) => ({
    rank: index + 1,
    ...row,
    age: ageFromDob(row.dob),
  }));
}

async function upcomingMatchup(aId: number, bId: number, env: ScoutAiEnv): Promise<any | null> {
  try {
    return await env.DB.prepare(`
      SELECT b.id AS bout_id, b.weight_class, e.name AS event_name, e.event_date,
             p.fighter_a_probability, p.fighter_b_probability, p.sample_strength, p.notes,
             fa.id AS fighter_a_id, fa.name AS fighter_a_name,
             fb.id AS fighter_b_id, fb.name AS fighter_b_name
      FROM bouts b
      JOIN events e ON e.id = b.event_id
      JOIN fighters fa ON fa.id = b.fighter_a_id
      JOIN fighters fb ON fb.id = b.fighter_b_id
      LEFT JOIN predictions p ON p.bout_id = b.id
      WHERE b.status = 'scheduled'
        AND ((b.fighter_a_id = ?1 AND b.fighter_b_id = ?2) OR (b.fighter_a_id = ?2 AND b.fighter_b_id = ?1))
      ORDER BY e.event_date ASC, p.created_at DESC
      LIMIT 1
    `).bind(aId, bId).first();
  } catch {
    return null;
  }
}

async function gatherEvidence(plan: ScoutPlan, env: ScoutAiEnv): Promise<{ evidence: any; sources: any[]; error?: string }> {
  if (plan.intent === 'rankings') {
    const rows = await loadRankings(plan, env);
    return {
      evidence: {
        kind: 'rankings',
        metric: plan.metric,
        metric_label: METRIC_LABEL[plan.metric],
        division: plan.division || 'All active UFC divisions',
        rows,
      },
      sources: rows.map((row: any) => ({ label: row.name, href: `/fighters/${row.slug}` })),
    };
  }

  if (plan.intent === 'fighter_profile' || plan.intent === 'compare_fighters') {
    const requested = plan.fighters.slice(0, plan.intent === 'compare_fighters' ? 2 : 1);
    if (requested.length < (plan.intent === 'compare_fighters' ? 2 : 1)) {
      return { evidence: null, sources: [], error: 'I need the fighter name to research that question.' };
    }

    const resolved = [];
    for (const name of requested) {
      const fighter = await resolveFighter(name, env);
      if (!fighter) return { evidence: null, sources: [], error: `I could not match “${name}” to a fighter in the current database.` };
      resolved.push(fighter);
    }

    const fighters = [];
    for (const fighter of resolved) fighters.push(await loadFighterEvidence(fighter, env));
    const matchup = resolved.length === 2
      ? await upcomingMatchup(Number(resolved[0].id), Number(resolved[1].id), env)
      : null;

    return {
      evidence: {
        kind: resolved.length === 2 ? 'fighter_comparison' : 'fighter_profile',
        fighters,
        upcoming_matchup: matchup,
      },
      sources: resolved.map((fighter: any) => ({ label: fighter.name, href: `/fighters/${fighter.slug}` })),
    };
  }

  return {
    evidence: null,
    sources: [],
    error:
      'Scout AI Preview currently handles named fighter research, two-fighter comparisons, and ranking questions. Try “Compare Max Holloway and Alexander Volkanovski” or “Who has the strongest schedule at lightweight?”',
  };
}

async function synthesize(question: string, evidence: any, env: ScoutAiEnv): Promise<any> {
  if (!env.AI) {
    return {
      answer: 'Scout AI is not connected to an AI binding in this environment yet.',
      confidence: 'low',
      caveats: ['The structured MMA evidence was retrieved successfully, but natural-language synthesis is unavailable.'],
    };
  }

  const result = await env.AI.run(MODEL, {
    messages: [
      {
        role: 'system',
        content:
          'You are Scout AI, the research assistant for MMA Scouts. Answer ONLY from the supplied structured evidence. ' +
          'Never invent a fight, opponent, statistic, ranking, injury, result, or biographical fact. ' +
          'If the evidence cannot establish something, say so plainly. Distinguish official UFC aggregate statistics from MMA Scouts opponent-adjusted ratings. ' +
          'Do not claim that a rating is an official UFC ranking. If an upcoming model probability is present, describe it as the site model, not a certainty. ' +
          'Write a concise analyst-style answer for an MMA fan. No markdown tables. Avoid betting advice.',
      },
      {
        role: 'user',
        content: `Question: ${question}\n\nStructured evidence:\n${JSON.stringify(evidence)}`,
      },
    ],
    temperature: 0.2,
    max_tokens: 650,
    response_format: {
      type: 'json_schema',
      json_schema: {
        type: 'object',
        properties: {
          answer: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          caveats: { type: 'array', items: { type: 'string' }, maxItems: 4 },
        },
        required: ['answer', 'confidence', 'caveats'],
      },
    },
  });

  const payload = extractAiPayload(result);
  if (payload && typeof payload === 'object' && typeof payload.answer === 'string') return payload;
  return {
    answer: typeof payload === 'string' ? payload : 'Scout AI could not format an answer from the retrieved evidence.',
    confidence: 'low',
    caveats: ['The evidence retrieval completed, but the language model response was incomplete.'],
  };
}

export async function scoutAsk(request: Request, env: ScoutAiEnv): Promise<Response> {
  if (request.method !== 'POST') return response({ error: 'method_not_allowed' }, 405);

  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return response({ error: 'invalid_json' }, 400);
  }

  const question = String(payload?.question || '').replace(/\s+/g, ' ').trim();
  if (question.length < 3) return response({ error: 'question_too_short' }, 400);
  if (question.length > 500) return response({ error: 'question_too_long', max_chars: 500 }, 400);

  const plan = await planQuestion(question, env);
  const gathered = await gatherEvidence(plan, env);
  if (gathered.error) {
    return response({
      question,
      answer: gathered.error,
      confidence: 'low',
      caveats: [],
      sources: gathered.sources,
      meta: { intent: plan.intent, preview: true, model: env.AI ? MODEL : null },
    });
  }

  try {
    const answer = await synthesize(question, gathered.evidence, env);
    return response({
      question,
      ...answer,
      sources: gathered.sources,
      meta: {
        intent: plan.intent,
        metric: plan.metric,
        division: plan.division || null,
        preview: true,
        model: env.AI ? MODEL : null,
        evidence_kind: gathered.evidence?.kind || null,
      },
    });
  } catch (error) {
    console.error('Scout AI synthesis failed', error);
    return response({
      error: 'scout_ai_unavailable',
      message: 'The research data was retrieved, but Scout AI could not complete the answer.',
    }, 503);
  }
}
