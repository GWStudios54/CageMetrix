# CageMetrix

**Opponent-adjusted MMA analytics.**

CageMetrix is a browser-first MMA analytics platform focused on answering one question:

> How did a fighter perform compared with how other fighters perform against the same opposition?

The initial product is UFC-first and is built around opponent-adjusted ratings, strength of schedule, transparent fighter rankings, and later bout predictions plus pre-fight context links.

## MVP

- Fighter database
- Historical bout and round statistics
- Opponent-adjusted ratings
- CageMetrix Rating (CMR)
- Divisional and category rankings
- Rating history and model versioning
- Prediction storage with immutable pre-fight snapshots
- Source/provenance tracking
- Cloudflare Workers + Static Assets + D1

## Local development

```bash
npm install
npm run db:migrate:local
npm run dev
```

The local site will be served by Wrangler. API routes live under `/api/*`.

## Cloudflare setup

Cloudflare recommends `wrangler.jsonc` for new Workers projects. CageMetrix uses Workers Static Assets instead of the deprecated Workers Sites setup.

Create the production D1 database once:

```bash
npx wrangler d1 create cagemetrix
```

Copy the returned database ID into `wrangler.jsonc`, replacing `REPLACE_WITH_D1_DATABASE_ID`, then apply migrations:

```bash
npm run db:migrate:remote
```

Deploy:

```bash
npm run deploy
```

After the Worker is live, attach `cagemetrix.com` as the custom domain in Cloudflare.

Production builds are connected to the `main` branch; pushes to `main` should trigger a Cloudflare Workers build automatically.

## Data model

The first migration contains the durable core schema:

- `fighters`
- `events`
- `bouts`
- `round_stats`
- `model_versions`
- `ratings_history`
- `predictions`
- `fight_context`
- `source_observations`

Raw factual data and CageMetrix-derived metrics are kept separate. Historical ratings and predictions are append-only snapshots so future model versions can be backtested honestly.

## Rating philosophy

A raw stat is never treated as context-free. CageMetrix is designed to compare observed performance against the performance normally allowed or produced by the same opposition, with weight-class/era normalization and uncertainty controls for small samples.

The exact rating model will evolve under explicit `model_versions`; historical outputs are never silently rewritten.
