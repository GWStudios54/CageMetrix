# CageMetrix global fight warehouse

The global fight warehouse is an **internal research dataset** used to improve future CageMetrix models. It is deliberately separate from the launch-forward public CageMetrix record.

## What it is for

The production UFC dataset is detailed but relatively small. The warehouse adds broad career history from outside the UFC so future models can learn things that are currently sparse or unavailable, especially:

- pre-UFC professional experience;
- opponent quality before UFC debut;
- cross-promotion résumé strength;
- layoffs and career activity;
- global Elo/Glicko-style ratings;
- organization and regional-strength effects;
- physical measurements and biographical context when available;
- detailed striking, takedown and control statistics where the upstream source actually provides them.

The first warehouse source is MMA Global Database v3 (`leandroiber/mmastats`). Its upstream provenance includes Sherdog Fight Finder, UFCStats, Wikipedia UFC champion lists and UFC statistical-leader pages. Source provenance and an exact snapshot SHA-256 are retained with each import.

## What it is not

Imported historical bouts are **not** CageMetrix predictions and must never be displayed as if CageMetrix tracked them at the time.

The warehouse does not create public historical fight pages, predictions, fan picks, contributor notes or scorecards. Those remain launch-forward CageMetrix records.

The warehouse also does not automatically replace the production `fighters`, `bouts`, `ratings_history` or `predictions` tables. Model research must opt into warehouse data explicitly.

## Storage model

The warehouse lives in prefixed D1 tables:

- `warehouse_sources` — provenance and latest imported source version;
- `warehouse_ingestion_runs` — immutable import/run metadata and quality report;
- `warehouse_fighters` — source-native fighter identities and measurements;
- `warehouse_bouts` — global professional fight history/results;
- `warehouse_bout_stats` — detailed technical statistics when available;
- `warehouse_fighter_links` — explicit links from source identities to CageMetrix canonical fighters.

All source-native rows keep the source key, source ID, exact source version and ingestion run that produced them.

## Identity rule

**Names alone do not establish identity.**

The importer may attach a source fighter ID to a bout participant only when the normalized participant name maps to exactly one fighter in that same source snapshot. Ambiguous names remain unresolved. Links from warehouse identities into CageMetrix's canonical fighter table are stored separately with a match method, confidence and verification status.

This prevents same-name fighters from being silently merged.

## Import and refresh

`.github/workflows/global-fight-warehouse.yml` validates the source and import on every warehouse-related PR. After the warehouse code is merged, it also runs weekly.

The workflow:

1. downloads the current public source snapshot;
2. verifies the expected DuckDB schema;
3. requires a minimum dataset size and organization count;
4. rejects duplicate source bout IDs;
5. converts the DuckDB snapshot into bounded D1 SQL statements;
6. applies the migration and full import to a local D1 database first;
7. uploads only the quality report as a GitHub Actions artifact;
8. on `main`, applies the same schema/import to remote D1 and verifies counts.

The generated raw SQL and third-party source database are transient CI files and are not committed to the CageMetrix repository.

## Provenance / public use

The source repository's software/license status does not by itself determine the reuse rights of every underlying factual dataset or scraped source. Keep the raw warehouse internal. If CageMetrix later exposes a fact derived from the warehouse publicly, preserve source attribution where appropriate and validate important records against a primary or otherwise authoritative source.

## Modeling rule

Warehouse-derived predictive features must be calculated **as of the fight being predicted**. Future fights, later measurements, future opponent results and later organization strength cannot leak backward into a historical training row.

The first intended derived features are global pre-fight résumé signals (global Elo/Glicko, pro experience, activity/layoff, pre-UFC record and opponent quality). No warehouse model automatically replaces production Predictor 0.1; candidates must be versioned, benchmarked and then confirmed prospectively.
