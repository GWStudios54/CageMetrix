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

Use Node 24 or later. `npm test` checks ranking pagination/search, stale-response handling, deep links, retry behavior and the fighter loading state. `npm run typecheck` checks Worker types, and `npm run build` creates a deployment dry run without changing the remote database.

Database maintenance runs explicitly through `npm run deploy`, before deployment. Starting `npm run dev` or running the dry build does not run production migrations or recalibration.

The rankings support `q`, `metric`, `weight_class`, and `page` in the page URL. The rankings API supports `q`, `offset`, and `limit`, and returns `meta.total` and each fighter's rank within the selected field. Search preserves that rank. One-bout samples are included with the model's provisional label.

Fighters use initials throughout the site. Photography is disabled until suitable licensed assets are supplied; see [PHOTO-SOURCES.md](docs/PHOTO-SOURCES.md).

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
