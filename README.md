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
