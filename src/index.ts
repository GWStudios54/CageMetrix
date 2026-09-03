import { syncLiveResults, RESULT_POLL_SECONDS, PAGE_POLL_SECONDS } from './live-results.ts';

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  MODEL_VERSION: string;
}

const MODEL_NAME = "CageMetrix Opponent-Adjusted Rating";

const metricColumns: Record<string, string> = {
  cmr: "rh.cmr",
  striking_offense: "rh.striking_offense",
  striking_defense: "rh.striking_defense",
  wrestling_offense: "rh.wrestling_offense",
  wrestling_defense: "rh.wrestling_defense",
  grappling: "rh.grappling",
  pace: "rh.pace",
  finishing: "rh.finishing",
  strength_of_schedule: "rh.strength_of_schedule",
  recent_form: "rh.recent_form",
  technical: "rh.technical_rating",
  resume: "rh.resume_rating",
  confidence: "rh.confidence"
};

function json(data: unknown, init: ResponseInit = {}, cacheSeconds = 0): Response {
  const headers = new Headers(init.headers || {});
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", cacheSeconds > 0 ? `public, max-age=${cacheSeconds}` : "no-store");
  return new Response(JSON.stringify(data, null, 2), { ...init, headers });
}

async function edgeCached(request: Request, context: ExecutionContext, producer: () => Promise<Response>): Promise<Response> {
  const cache = (caches as CacheStorage & { default: Cache }).default;
  const cacheUrl = new URL(request.url);
  cacheUrl.searchParams.set('_cache_version', '0.3.0-live-1');
  const cacheKey = new Request(cacheUrl, request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const response = await producer();
  if (response.ok && !response.headers.get("cache-control")?.includes("no-store")) {
    context.waitUntil(cache.put(cacheKey, response.clone()));
  }
  return response;
}

function intParam(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseJson(value: unknown): any {
  if (typeof value !== "string" || !value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function currentModelIdSql(): string {
  return `(SELECT id FROM model_versions WHERE name = ? AND version = ? LIMIT 1)`;
}

function latestRatingSql(): string {
  return `rh.id = (SELECT newest.id FROM ratings_history newest
    WHERE newest.fighter_id = rh.fighter_id AND newest.model_version_id = rh.model_version_id
    ORDER BY newest.as_of_date DESC, newest.id DESC LIMIT 1)`;
}

async function dataStatus(env: Env) {
  const row = await env.DB.prepare("SELECT value FROM bootstrap_state WHERE key='data:latest'").first();
  const value = parseJson(row?.value);
  if (!value) return null;
  const ageDays = Math.max(0, Math.floor((Date.now() - Date.parse(`${value.source_max_date}T00:00:00Z`)) / 86400000));
  return { ...value, age_days: ageDays, stale: ageDays > 21 };
}

async function health(env: Env): Promise<Response> {
  // Deliberately lightweight. Full-table COUNT(*) calls on every landing-page load
  // were the single largest source of unnecessary D1 reads.
  const db = await env.DB.prepare("SELECT 1 AS ok").first();
  return json({
    ok: db?.ok === 1,
    service: "cagemetrix",
    model_version: env.MODEL_VERSION,
    data: await dataStatus(env),
    timestamp: new Date().toISOString()
  }, {}, 300);
}

async function listFighters(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const limit = intParam(url.searchParams.get("limit"), 50, 1, 200);
  const offset = intParam(url.searchParams.get("offset"), 0, 0, 1_000_000);
  const query = (url.searchParams.get("q") || "").trim();

  const statement = query
    ? env.DB.prepare(`
        SELECT id, slug, name, current_weight_class, nationality, active, roster_status, status_source, last_fight_date, ufc_bouts
        FROM fighters
        WHERE name LIKE ?1 OR slug LIKE ?1
        ORDER BY name COLLATE NOCASE
        LIMIT ?2 OFFSET ?3
      `).bind(`%${query}%`, limit, offset)
    : env.DB.prepare(`
        SELECT id, slug, name, current_weight_class, nationality, active, roster_status, status_source, last_fight_date, ufc_bouts
        FROM fighters
        ORDER BY name COLLATE NOCASE
        LIMIT ?1 OFFSET ?2
      `).bind(limit, offset);

  const result = await statement.all();
  return json({ data: result.results, meta: { limit, offset, query } });
}

async function getFighter(slug: string, env: Env): Promise<Response> {
  const fighter = await env.DB.prepare(`
    SELECT * FROM fighters WHERE slug = ?1 LIMIT 1
  `).bind(slug).first();

  if (!fighter) return json({ error: "fighter_not_found" }, { status: 404 });

  const fighterId = Number(fighter.id);
  const rating = await env.DB.prepare(`
    SELECT rh.*, mv.name AS model_name, mv.version AS model_version
    FROM ratings_history rh
    JOIN model_versions mv ON mv.id = rh.model_version_id
    WHERE rh.fighter_id = ?1
      AND rh.model_version_id = ${currentModelIdSql()}
    ORDER BY rh.as_of_date DESC, rh.id DESC
    LIMIT 1
  `).bind(fighterId, MODEL_NAME, env.MODEL_VERSION).first();

  const history = await env.DB.prepare(`
    SELECT rh.as_of_date, rh.weight_class, rh.cmr, rh.technical_rating, rh.resume_rating,
           rh.strength_of_schedule, rh.confidence, rh.components_json, mv.name AS model_name, mv.version AS model_version
    FROM ratings_history rh
    JOIN model_versions mv ON mv.id = rh.model_version_id
    WHERE rh.fighter_id = ?1
    ORDER BY rh.as_of_date DESC, rh.created_at DESC
    LIMIT 50
  `).bind(fighterId).all();

  const raw = await env.DB.prepare(`
    SELECT
      COUNT(*) AS bouts,
      ROUND(SUM(duration_seconds) / 60.0, 2) AS minutes,
      CASE WHEN SUM(duration_seconds) > 0 THEN 60.0 * SUM(sig_strikes_landed) / SUM(duration_seconds) END AS slpm,
      CASE WHEN SUM(duration_seconds) > 0 THEN 60.0 * SUM(sig_strikes_absorbed) / SUM(duration_seconds) END AS sapm,
      CASE WHEN SUM(sig_strikes_attempted) > 0 THEN 100.0 * SUM(sig_strikes_landed) / SUM(sig_strikes_attempted) END AS strike_accuracy,
      CASE WHEN SUM(sig_strikes_faced) > 0 THEN 100.0 * (1.0 - (1.0 * SUM(sig_strikes_absorbed) / SUM(sig_strikes_faced))) END AS strike_defense,
      CASE WHEN SUM(duration_seconds) > 0 THEN 900.0 * SUM(takedowns_landed) / SUM(duration_seconds) END AS td15,
      CASE WHEN SUM(takedowns_attempted) > 0 THEN 100.0 * SUM(takedowns_landed) / SUM(takedowns_attempted) END AS td_accuracy,
      CASE WHEN SUM(takedowns_faced) > 0 THEN 100.0 * (1.0 - (1.0 * SUM(takedowns_allowed) / SUM(takedowns_faced))) END AS td_defense,
      CASE WHEN SUM(duration_seconds) > 0 THEN 15.0 * SUM(control_seconds) / SUM(duration_seconds) END AS control_minutes_per_15
    FROM bout_totals
    WHERE fighter_id = ?1
  `).bind(fighterId).first();

  const recentBouts = await env.DB.prepare(`
    SELECT
      bt.event_date,
      bt.weight_class,
      bt.won,
      bt.result,
      bt.finish,
      bt.sig_strikes_landed,
      bt.sig_strikes_absorbed,
      bt.takedowns_landed,
      bt.takedowns_allowed,
      bt.control_seconds,
      opp.name AS opponent_name,
      opp.slug AS opponent_slug
    FROM bout_totals bt
    JOIN fighters opp ON opp.id = bt.opponent_id
    WHERE bt.fighter_id = ?1
    ORDER BY bt.event_date DESC, bt.id DESC
    LIMIT 10
  `).bind(fighterId).all();

  let ranks: Record<string, unknown> | null = null;
  if (rating && fighter.current_weight_class && Number(fighter.active) === 1) {
    ranks = await env.DB.prepare(`
      SELECT
        COUNT(*) AS field_size,
        1 + SUM(CASE WHEN rh.cmr > ?4 THEN 1 ELSE 0 END) AS cmr,
        1 + SUM(CASE WHEN rh.technical_rating > ?5 THEN 1 ELSE 0 END) AS technical_rating,
        1 + SUM(CASE WHEN rh.resume_rating > ?6 THEN 1 ELSE 0 END) AS resume_rating,
        1 + SUM(CASE WHEN rh.striking_offense > ?7 THEN 1 ELSE 0 END) AS striking_offense,
        1 + SUM(CASE WHEN rh.striking_defense > ?8 THEN 1 ELSE 0 END) AS striking_defense,
        1 + SUM(CASE WHEN rh.wrestling_offense > ?9 THEN 1 ELSE 0 END) AS wrestling_offense,
        1 + SUM(CASE WHEN rh.wrestling_defense > ?10 THEN 1 ELSE 0 END) AS wrestling_defense,
        1 + SUM(CASE WHEN rh.grappling > ?11 THEN 1 ELSE 0 END) AS grappling,
        1 + SUM(CASE WHEN rh.strength_of_schedule > ?12 THEN 1 ELSE 0 END) AS strength_of_schedule,
        1 + SUM(CASE WHEN rh.recent_form > ?13 THEN 1 ELSE 0 END) AS recent_form
      FROM fighters f
      JOIN ratings_history rh
        ON rh.fighter_id = f.id
       AND rh.model_version_id = (SELECT id FROM model_versions WHERE name = ?2 AND version = ?3 LIMIT 1)
      WHERE f.current_weight_class = ?1
        AND f.active = 1
        AND rh.sample_bouts >= 1
        AND ${latestRatingSql()}
    `).bind(
      fighter.current_weight_class,
      MODEL_NAME,
      env.MODEL_VERSION,
      rating.cmr,
      rating.technical_rating,
      rating.resume_rating,
      rating.striking_offense,
      rating.striking_defense,
      rating.wrestling_offense,
      rating.wrestling_defense,
      rating.grappling,
      rating.strength_of_schedule,
      rating.recent_form
    ).first();
  }

  const components = rating ? parseJson(rating.components_json) : null;
  const ratingPayload = rating ? {
    ...rating,
    components,
    performance_cmr: components?.performance_cmr ?? rating.cmr,
    provisional: Boolean(components?.provisional)
  } : null;

  return json({
    fighter,
    rating: ratingPayload,
    ranks,
    raw,
    recent_bouts: recentBouts.results,
    history: history.results.map((row: any) => ({ ...row, components: parseJson(row.components_json) }))
  }, {}, 300);
}

async function rankings(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const weightClass = (url.searchParams.get("weight_class") || "").trim();
  const activeOnly = url.searchParams.get("active") !== "false";
  const limit = intParam(url.searchParams.get("limit"), 50, 1, 200);
  const offset = intParam(url.searchParams.get("offset"), 0, 0, 1_000_000);
  const query = (url.searchParams.get("q") || "").trim().slice(0, 100);
  // One current-division bout is enough to appear, but small samples remain PROVISIONAL.
  const minBouts = intParam(url.searchParams.get("min_bouts"), 1, 0, 100);
  const metric = (url.searchParams.get("metric") || "cmr").trim();
  const sortColumn = metricColumns[metric];
  if (!sortColumn) {
    return json({ error: "invalid_metric", allowed: Object.keys(metricColumns) }, { status: 400 });
  }

  const clauses: string[] = ["rh.sample_bouts >= ?3", latestRatingSql()];
  const bindings: unknown[] = [MODEL_NAME, env.MODEL_VERSION, minBouts];

  if (weightClass) {
    clauses.push(`f.current_weight_class = ?${bindings.length + 1}`);
    bindings.push(weightClass);
  }

  if (activeOnly) clauses.push("f.active = 1");

  // Rank the whole selected field before searching, so finding a fighter does
  // not turn their divisional rank into #1. Treat LIKE wildcards literally.
  const searchClause = query
    ? `WHERE name LIKE ?${bindings.length + 1} ESCAPE '\\' OR slug LIKE ?${bindings.length + 1} ESCAPE '\\'`
    : "";
  if (query) bindings.push(`%${query.replace(/[\\%_]/g, "\\$&")}%`);
  bindings.push(limit, offset);

  const result = await env.DB.prepare(`
    WITH ranked AS (
    SELECT
      f.id,
      f.slug,
      f.name,
      f.current_weight_class,
      f.roster_status,
      f.last_fight_date,
      f.ufc_bouts,
      rh.cmr,
      rh.confidence,
      rh.sample_bouts,
      rh.sample_minutes,
      rh.components_json,
      rh.as_of_date,
      ${sortColumn} AS metric_value,
      ROW_NUMBER() OVER (ORDER BY ${sortColumn} DESC, rh.confidence DESC, f.name COLLATE NOCASE, f.id) AS rank
    FROM fighters f
    JOIN ratings_history rh
      ON rh.fighter_id = f.id
     AND rh.model_version_id = ${currentModelIdSql()}
    WHERE ${clauses.join(" AND ")}
    )
    SELECT *, COUNT(*) OVER () AS total
    FROM ranked
    ${searchClause}
    ORDER BY rank
    LIMIT ?${bindings.length - 1} OFFSET ?${bindings.length}
  `).bind(...bindings).all();

  const rows = result.results.map((row: any) => {
    const components = parseJson(row.components_json);
    const { components_json, total, ...clean } = row;
    return {
      ...clean,
      performance_cmr: components?.performance_cmr ?? row.cmr,
      provisional: Boolean(components?.provisional),
      sample_reliability: components?.sample_reliability ?? null
    };
  });

  return json({
    data: rows,
    meta: {
      metric, weight_class: weightClass || null, active_only: activeOnly,
      min_bouts: minBouts, limit, offset, query,
      total: Number(result.results[0]?.total || 0),
      data: await dataStatus(env),
      model_version: env.MODEL_VERSION
    }
  }, {}, 600);
}

async function divisions(env: Env): Promise<Response> {
  const result = await env.DB.prepare(`
    SELECT current_weight_class AS weight_class, COUNT(*) AS fighters
    FROM fighters
    WHERE active = 1 AND current_weight_class IS NOT NULL
    GROUP BY current_weight_class
    ORDER BY current_weight_class COLLATE NOCASE
  `).all();
  return json({ data: result.results }, {}, 1800);
}

async function forecasts(env: Env): Promise<Response> {
  const result = await env.DB.prepare(`
    SELECT p.id, p.created_at, p.locked_at, p.fighter_a_probability, p.fighter_b_probability,
      p.picked_fighter_id, p.sample_strength, p.notes, p.input_snapshot_key,
      e.name AS event_name, e.event_date, e.starts_at, e.slug AS event_slug, e.source_url,
      b.status, b.weight_class, b.bout_order, b.winner_id, b.result_method, b.updated_at AS result_updated_at,
      s.last_attempted_at AS results_checked_at,s.last_success_at AS results_success_at,s.error AS results_error,
      a.id AS fighter_a_id, a.name AS fighter_a_name, a.slug AS fighter_a_slug,
      z.id AS fighter_b_id, z.name AS fighter_b_name, z.slug AS fighter_b_slug,
      mv.version AS model_version,
      CASE WHEN b.status='completed' AND b.winner_id IS NOT NULL
        AND p.picked_fighter_id IS NOT NULL AND p.locked_at < e.starts_at
        THEN CASE WHEN p.picked_fighter_id=b.winner_id THEN 'correct' ELSE 'incorrect' END
        WHEN b.status='cancelled' THEN 'cancelled'
        WHEN b.status='completed' THEN 'void' ELSE 'pending' END AS grade
    FROM predictions p JOIN bouts b ON b.id=p.bout_id
    JOIN events e ON e.id=b.event_id JOIN model_versions mv ON mv.id=p.model_version_id
    JOIN fighters a ON a.id=b.fighter_a_id JOIN fighters z ON z.id=b.fighter_b_id
    LEFT JOIN event_result_sync s ON s.event_id=e.id
    WHERE mv.name='CageMetrix Win Probability' AND mv.version='0.1.0'
    ORDER BY e.event_date DESC, b.bout_order, p.id
  `).all();
  const rows = (result.results as any[]).map(row => ({ ...row,
    event_live: Date.now() >= Date.parse(row.starts_at)-30*60_000 && Date.now() <= Date.parse(row.starts_at)+12*3_600_000
  }));
  const pollerRow=await env.DB.prepare("SELECT value FROM bootstrap_state WHERE key='results:poller'").first();
  const graded = rows.filter(r => r.grade === 'correct' || r.grade === 'incorrect');
  const correct = graded.filter(r => r.grade === 'correct').length;
  const brier = graded.length ? graded.reduce((sum,r) => sum + (r.fighter_a_probability - Number(r.winner_id === r.fighter_a_id)) ** 2,0) / graded.length : null;
  return json({ data: rows, summary: {
    correct, incorrect: graded.length-correct, graded: graded.length,
    accuracy: graded.length ? correct/graded.length : null, brier,
    pending: rows.filter(r=>r.grade==='pending').length,
    void: rows.filter(r=>r.grade==='void'||r.grade==='cancelled').length,
    first_prediction_at: rows.map(r=>r.locked_at).sort()[0] || null,
    policy: 'Only predictions saved before the event starts are graded. Draws, no-contests, cancellations and 50/50 no-picks are excluded. Historical backtests are separate.'
  }, meta: { model_version:'0.1.0', data:await dataStatus(env), live_results: {
    poll_seconds:RESULT_POLL_SECONDS,page_refresh_seconds:PAGE_POLL_SECONDS,
    scheduler:parseJson(pollerRow?.value),source:'UFC official event cards'
  } } }, {}, 15);
}

async function fighterAsset(request: Request, env: Env, slug: string): Promise<Response> {
  const assetUrl = new URL(request.url);
  assetUrl.pathname = "/fighter.html";
  assetUrl.search = "";
  const response = await env.ASSETS.fetch(new Request(assetUrl.toString(), {
    method: "GET",
    headers: request.headers
  }));
  const fighter = await env.DB.prepare("SELECT slug, name, current_weight_class FROM fighters WHERE slug = ?1 LIMIT 1").bind(slug).first();
  if (!fighter) return new Response(response.body, { status: 404, headers: response.headers });
  const title = `${fighter.name} — CageMetrix`;
  const description = `${fighter.name}'s opponent-adjusted ${fighter.current_weight_class || "UFC"} ratings, performance breakdown and sample strength.`;
  const canonical = `https://cagemetrix.com/fighters/${encodeURIComponent(slug)}`;
  const escape = (value: string) => value.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
  return new HTMLRewriter()
    .on("title", { element(el) { el.setInnerContent(title); } })
    .on('meta[name="description"]', { element(el) { el.setAttribute("content", description); } })
    .on("head", { element(el) {
      el.append(`<link rel="canonical" href="${canonical}"><meta property="og:type" content="profile"><meta property="og:url" content="${canonical}"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta name="twitter:card" content="summary"><meta name="twitter:title" content="${escape(title)}"><meta name="twitter:description" content="${escape(description)}"><meta property="og:image" content="https://cagemetrix.com/og.png"><meta name="twitter:image" content="https://cagemetrix.com/og.png">`, { html: true });
    } })
    .transform(response);
}

export default {
  async scheduled(controller: ScheduledController, env: Env, context: ExecutionContext) {
    context.waitUntil(syncLiveResults(env,controller.scheduledTime));
  },
  async fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (request.method === "GET" && url.pathname === "/api/health") {
        return edgeCached(request, context, () => health(env));
      }

      if (request.method === "GET" && url.pathname === "/api/fighters") return listFighters(request, env);
      if (request.method === "GET" && url.pathname.startsWith("/api/fighters/")) {
        const slug = decodeURIComponent(url.pathname.slice("/api/fighters/".length));
        if (!slug || slug.includes("/")) return json({ error: "invalid_fighter_slug" }, { status: 400 });
        return edgeCached(request, context, () => getFighter(slug, env));
      }
      if (request.method === "GET" && url.pathname === "/api/rankings") {
        return edgeCached(request, context, () => rankings(request, env));
      }
      if (request.method === "GET" && url.pathname === "/api/divisions") {
        return edgeCached(request, context, () => divisions(env));
      }
      if (request.method === "GET" && url.pathname === "/api/forecasts") {
        return edgeCached(request, context, () => forecasts(env));
      }

      if (request.method === "GET" && url.pathname.startsWith("/fighters/")) {
        const slug = decodeURIComponent(url.pathname.slice("/fighters/".length).replace(/\/$/, ""));
        if (!slug || slug.includes("/")) return Response.redirect(new URL("/#rankings", request.url), 302);
        return fighterAsset(request, env, slug);
      }

      return json({ error: "not_found" }, { status: 404 });
    } catch (error) {
      console.error("CageMetrix API error", error);
      return json({ error: "internal_error" }, { status: 500 });
    }
  }
} satisfies ExportedHandler<Env>;
