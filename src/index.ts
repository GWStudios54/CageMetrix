interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  MODEL_VERSION: string;
}

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: { ...jsonHeaders, ...(init.headers || {}) }
  });
}

function intParam(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

async function listFighters(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const limit = intParam(url.searchParams.get("limit"), 50, 1, 200);
  const offset = intParam(url.searchParams.get("offset"), 0, 0, 1_000_000);
  const query = (url.searchParams.get("q") || "").trim();

  const statement = query
    ? env.DB.prepare(`
        SELECT id, slug, name, current_weight_class, nationality, active
        FROM fighters
        WHERE name LIKE ?1 OR slug LIKE ?1
        ORDER BY name COLLATE NOCASE
        LIMIT ?2 OFFSET ?3
      `).bind(`%${query}%`, limit, offset)
    : env.DB.prepare(`
        SELECT id, slug, name, current_weight_class, nationality, active
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

  const rating = await env.DB.prepare(`
    SELECT lr.*, mv.name AS model_name, mv.version AS model_version
    FROM latest_ratings lr
    JOIN model_versions mv ON mv.id = lr.model_version_id
    WHERE lr.fighter_id = ?1
    LIMIT 1
  `).bind(fighter.id).first();

  return json({ fighter, rating });
}

async function rankings(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const weightClass = (url.searchParams.get("weight_class") || "").trim();
  const activeOnly = url.searchParams.get("active") !== "false";
  const limit = intParam(url.searchParams.get("limit"), 50, 1, 200);

  const clauses: string[] = [];
  const bindings: unknown[] = [];

  if (weightClass) {
    clauses.push(`f.current_weight_class = ?${bindings.length + 1}`);
    bindings.push(weightClass);
  }

  if (activeOnly) clauses.push("f.active = 1");

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  bindings.push(limit);

  const result = await env.DB.prepare(`
    SELECT
      f.id,
      f.slug,
      f.name,
      f.current_weight_class,
      lr.cmr,
      lr.striking_offense,
      lr.striking_defense,
      lr.wrestling_offense,
      lr.wrestling_defense,
      lr.grappling,
      lr.durability,
      lr.pace,
      lr.finishing,
      lr.strength_of_schedule,
      lr.recent_form,
      lr.confidence,
      lr.as_of_date
    FROM latest_ratings lr
    JOIN fighters f ON f.id = lr.fighter_id
    ${where}
    ORDER BY lr.cmr DESC, lr.confidence DESC, f.name COLLATE NOCASE
    LIMIT ?${bindings.length}
  `).bind(...bindings).all();

  return json({
    data: result.results,
    meta: { weight_class: weightClass || null, active_only: activeOnly, limit }
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (request.method === "GET" && url.pathname === "/api/health") {
        const db = await env.DB.prepare("SELECT 1 AS ok").first();
        return json({
          ok: db?.ok === 1,
          service: "cagemetrix",
          model_version: env.MODEL_VERSION,
          timestamp: new Date().toISOString()
        });
      }

      if (request.method === "GET" && url.pathname === "/api/fighters") {
        return listFighters(request, env);
      }

      if (request.method === "GET" && url.pathname.startsWith("/api/fighters/")) {
        const slug = decodeURIComponent(url.pathname.slice("/api/fighters/".length));
        if (!slug || slug.includes("/")) return json({ error: "invalid_fighter_slug" }, { status: 400 });
        return getFighter(slug, env);
      }

      if (request.method === "GET" && url.pathname === "/api/rankings") {
        return rankings(request, env);
      }

      return json({ error: "not_found" }, { status: 404 });
    } catch (error) {
      console.error("CageMetrix API error", error);
      return json({ error: "internal_error" }, { status: 500 });
    }
  }
} satisfies ExportedHandler<Env>;
