# Predictor 0.2: first research candidate

Status: **offline candidate, not approved for production**. The age-enhanced experiment won the predefined 2022 validation criterion. Its historical improvement over frozen 0.1 is small and uncertain. The live site, CMR, existing predictions and result poller remain unchanged.

## Results

Both models were evaluated on the same 1,516 decisive fights with two rated fighters, from 2023-01-01 through 2026-08-29. The candidate was selected using 2022 log loss and trained on 1,923 rated fights from 2018–2022. The [protocol](PREDICTOR-0.2-PROTOCOL.md) was written before these experiments ran.

| Model / experiment | Accuracy | Brier ↓ | Log loss ↓ |
| --- | ---: | ---: | ---: |
| Frozen Predictor 0.1 | 63.19% | 0.228227 | 0.648540 |
| **Selected 0.2: age** | **63.26%** | **0.226146** | **0.645289** |
| Layoff | 64.12% | 0.227097 | 0.646090 |
| Age + layoff | 63.59% | 0.225408 | 0.643500 |
| Age + layoff + reach | 63.26% | 0.226925 | 0.645967 |
| Age + layoff + stance | 63.19% | 0.225691 | 0.644099 |
| All four groups | 63.46% | 0.226983 | 0.646054 |

The selected model's Brier difference is −0.002081, with an event-date bootstrap 95% interval of **−0.005468 to +0.001071**. The interval includes no improvement. Its accuracy gain is just one additional correct pick across 1,516 fights. Brier and log loss improve in three of four evaluation years; both worsen in 2024. On all 1,891 evaluated fights, including 375 unchanged Elo fallbacks, accuracy is 62.51% versus 62.45% for 0.1.

Age + layoff scored better on the reused historical evaluation, and layoff alone had a negative Brier difference interval. Those are exploratory results; neither won the predefined validation selection. We have not switched candidates after looking at these outcomes. The validation log-loss difference between age and age + layoff + stance is only about 0.000012, so it should not be presented as strong evidence that age alone is universally best. Intervals for the seven exploratory comparisons are not adjusted for multiple comparisons.

## What is implemented

- Chronological rating rebuilds with unchanged CMR 0.3.0, strict exclusion of the current card, seven feature experiments and training-only scaling.
- Age on fight day, nonlinear age effects and division interactions; UFC layoff history including draws and no contests; reach differences and directional stance matchups.
- Explicit missing values and ambiguous-name exclusions. Current career totals from the profile file are never used.
- A separate model artifact with full-precision coefficients and source/code hashes; per-year/division results, calibration bins, coverage and paired uncertainty estimates.
- A candidate snapshot constructor that retains full rating/context inputs, model coefficients and actual feature contributions. It rejects source evidence or rating dates after the lock and detaches its inputs from later mutations. This is an offline building block; it does not create a D1 record or run a shadow scheduler.
- Tests covering leakage, fighter swaps, fallback behavior, invalid evidence, feature explanations and preservation of production code.

## Limitations and next step

The 2023+ period was already examined for 0.1. These results are a reused retrospective benchmark, not a fresh holdout and not the live accuracy counter. Fighter/date clustering is not a complete treatment of dependencies between fighters who appear on several cards.

The source only supplies current profiles. Both fighters have known ages in 1,026/1,891 evaluation fights (54.3%), reach in 959 (50.7%) and stance in 983 (52.0%). Missingness is substantial and changes over time. Historical DOB is projected from today's value; reach and stance are not independently verified for the old fight date. No injury estimates are included.

The selected candidate fails the predefined historical promotion screen. Keep 0.1 live. The next useful development step is improving factual profile coverage with identity-verified sources and recorded observation dates, then designing a separately versioned prospective comparison. Changes after seeing this benchmark require a new candidate revision and an explicit record of evaluation reuse. This branch adds no production migrations, API changes, public candidate probabilities, scheduler or automatic promotion.

## Reproduction

Use Node 24+ and the exact two source files identified in [sources.json](research/predictor-v02/sources.json). The preparation command downloads UFC DataLab revision `3268146c05211de9deab8b9b4c0bb4a954815f0b`, merges this checkout's existing supplement in dry-run mode, restores the original profile capture's final empty CRLF, and verifies both exact hashes. It never accesses D1. Use the audited checkout; a later source-supplement change must fail the hash check. The research ZIP accompanying this work also contains the exact inputs, scripts and detailed audit output for offline reproduction.

```sh
npm run predictor:v02:prepare
npm run predictor:v02:validate -- --stats .cache/predictor-v02-inputs/stats.csv --details .cache/predictor-v02-inputs/details.csv --profiles-observed-on 2026-09-03 --expected-sources docs/research/predictor-v02/sources.json --output .cache/predictor-v02-reproduced
```

The command writes local files only and refuses mismatched source/code fingerprints. Omit `--expected-sources` only for a deliberately new research run. Selection, model fitting, bootstrap sampling and output probabilities are deterministic. Outputs include the frozen selection, model artifact, detailed report and per-fight JSONL with original context and feature vectors. History caches require matching input and code hashes plus a rows checksum.

Review the [full report](research/predictor-v02/report.json), [validation selection](research/predictor-v02/selection.json) and [candidate artifact](../scripts/data/predictor-v02-candidate.json). These artifacts are research files and are never imported by the production forecast pipeline.
