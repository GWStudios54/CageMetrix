# CageMetrix

Fight-specific pages, immutable pre-fight input snapshots, contributor publishing and validation are documented in [Fight details](docs/FIGHT-DETAILS.md).

Predictor 0.2 is a separate [offline research candidate](docs/PREDICTOR-0.2.md). Predictor 0.1 remains live; the candidate includes age, layoff, reach and stance experiments with a pinned chronological evaluation and no automatic promotion.

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

Use Node 24 or later. `npm test` checks ranking pagination/search, stale-response handling, deep links, retry behavior and the fighter loading state. `npm run typecheck` checks Worker types, and `npm run build` creates a deployment dry run without changing the remote database.

Database maintenance runs explicitly through `npm run deploy`, before deployment. Starting `npm run dev` or running the dry build does not run production migrations or recalibration.

The rankings support `q`, `metric`, `weight_class`, and `page` in the page URL. The rankings API supports `q`, `offset`, and `limit`, and returns `meta.total` and each fighter's rank within the selected field. Search preserves that rank. One-bout samples are included with the model's provisional label.

Fighters use initials throughout the site. Photography is disabled until suitable licensed assets are supplied; see [PHOTO-SOURCES.md](docs/PHOTO-SOURCES.md).

Fight-day results use a Cloudflare scheduled handler every two minutes. It reads the public JSON live feed used by UFC's event page, discovering its event ID from the page settings. Checks run from 30 minutes before the card starts through 12 hours after the start, with hourly preflight checks during the preceding week and hourly reconciliation through 72 hours afterward. Only `Final` fights with complete outcomes and matching bout and fighter identities update accuracy; `Live`, `Over`, partial or missing rows stay pending. Pages without live feed settings use completed HTML results as a slower fallback; a failing configured feed preserves the previous results. Result changes retain their source URL in `bout_result_observations`, and source health is stored in `event_result_sync`. A new source implementation receives an immediate preflight on its first scheduled run.

Prediction and track-record pages refresh every 30 seconds while visible. The forecast API caches for 15 seconds. Timing depends on the official source publishing the result. Pre-fight probabilities remain immutable; the separate daily GitHub workflow still handles complete statistical imports and rating recalculation.

## Cloudflare setup

Cloudflare recommends `wrangler.jsonc` for new Workers projects. CageMetrix uses Workers Static Assets instead of the deprecated Workers Sites setup.

Create the production D1 database once:

```bash
npx wrangler d1 create cagemetrix
```

Copy the returned database ID into `wrangler.jsonc`, then apply migrations:

```bash
npm run db:migrate:remote
```

Manual deployment remains available with:

```bash
npm run deploy
```

Production deployment is handled by GitHub Actions. Every push to `main` runs `.github/workflows/deploy.yml`, installs the repository's Wrangler 4 dependency, and deploys the Worker using the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets.

The production Worker serves `cagemetrix.com` and `www.cagemetrix.com` through the custom-domain routes defined in `wrangler.jsonc`.

## Data model

The durable schema includes:

- `fighters`
- `events`
- `bouts`
- `round_stats`
- `model_versions`
- `ratings_history`
- `predictions`
- `fight_context`
- `source_observations`
- `bout_totals`
- `bootstrap_state`

Raw factual data and CageMetrix-derived metrics are kept separate. Historical ratings and predictions are versioned snapshots so future model versions can be backtested honestly.

## Rating philosophy

A raw stat is never treated as context-free. CageMetrix is designed to compare observed performance against the performance normally allowed or produced by the same opposition, with weight-class/era normalization and uncertainty controls for small samples.

The exact rating model evolves under explicit `model_versions`; historical outputs are never silently rewritten.
