# CageMetrix methodology — CMR 0.3.2 / Predictor 0.2.1

CMR is a descriptive fighter rating. Future-fight win probabilities use a separate frozen matchup model, Predictor 0.2.1, built from CMR skill components, Elo and verified pre-UFC résumé context. The retrospective benchmark and live prediction counter are separate; historical tests never add wins to the live record.

## Sources and identities

Historical statistics come from [UFC DataLab](https://github.com/komaksym/UFC-DataLab), currently through June 27, 2026. The supplemental archive adds 102 bouts across eight main UFC cards through August 29. Every supplemental matchup, winner, method, round, time and division comes from its linked official UFC event card; detailed box scores come from UFCalendar's UFCStats mirror. Every row retains both URLs. Upcoming cards come from UFC.com.

DataLab does not publish athlete IDs. CageMetrix assigns persistent internal keys used throughout opponent adjustment, aggregates, Elo and database joins. Bruno “Bulldog” and “Blindado” Silva have separate identities, resolved by nickname or a reviewed official profile slug. Missing discriminators and name/slug collisions fail ingestion. The sole DataLab Bruno biometric row belongs to Blindado. Bulldog's height/reach use his official UFC profile; his DOB is unavailable. Internal keys are not presented as official UFC IDs. Other source identity errors remain possible.

The pre-UFC warehouse is a separate provenance-preserving source layer. Its canonical materialization contains 13,874 completed bouts for 1,897 fighters after removing 1,941 duplicate representations and resolving zero conflicting outcomes. Model inputs use one deterministic per-fighter summary over each source registry's active snapshot. Raw warehouse rows and source provenance are retained. CMR and Predictor never synthesize regional technical statistics from result-only records.

## CMR

Men's and women's divisions are separate, including featherweight. Striking and takedown offense/defense compare each bout with the opponent's other bouts in that division, stabilized with a 45-minute division prior and a 0.25 smoothing constant. This is a single-pass retrospective adjustment, not a recursive latent-skill model.

Weights combine recency (3.5-year exponential time constant), duration and pre-bout opponent Elo. Short-fight exposures use a 30-second floor. Current-division bouts are retained plus the immediately previous division's bouts in the two years before the current stint. No-contests remain in raw history but are excluded from ratings, samples and Elo. DQs receive no finishing-skill bonus. Draws supply skill evidence but do not update Elo.

Components are standardized within the current division's available historical population: 50 + 15 standard deviations, clipped to 5–99. There is no explicit era, age or layoff model. Grappling, pace and finishing are direct measures, not fully opponent-adjusted skill estimates.

Technical performance: striking offense 30%, striking defense 22%, wrestling offense 16%, wrestling defense 16%, grappling 8%, pace 4%, finishing 4%. Performance CMR: technical 56%, normalized career Elo (“résumé”) 24%, strength of schedule 10%, last five retained results 10%, with deviations from 50 expanded by 1.45. These weights are hand-set. Displayed component scores are separately exposure-shrunk, so their weighted sum does not exactly reproduce performance CMR.

Sample strength is a 0–100 exposure index: 42% × (1 − exp(−minutes/45)) + 58% × (1 − exp(−bouts/5)), bounded to 0.08–0.99 before multiplying by 100. It is not an accuracy probability, confidence interval or measure of source quality. Ranked CMR shrinks performance toward 50 and subtracts sample penalties, including three points per missing bout below five. Samples below five bouts or 55 strength points are provisional.

CMR 0.3.2 preserves the UFC technical engine and weights from CMR 0.3.1. It adds a conservative pre-UFC entry prior based on canonical wins, losses, finishes, major-organization share, experience and debut layoff. Reliability shrinks regional evidence toward neutral. The prior's maximum weight is 0.65 and decays exponentially over four UFC bouts; technical fields and UFC evidence confidence remain UFC-only. The canonical warehouse summary has its own SHA-256 fingerprint in the model version, rating run, bootstrap state and rating snapshot identity, so a warehouse correction creates a new auditable snapshot even when the UFC source is unchanged.

## Predictor 0.2.1

Predictor 0.2.1 is a 33-feature regularized logistic model. It retains Predictor 0.1's 24 pre-fight UFC rating differences and matchup interactions, then adds nine canonical pre-UFC résumé features: coverage, bout count, win rate, finish rate, major-organization share, experience, debut layoff, prior score and prior reliability. Betting odds are not used.

Every training matchup is mirrored so swapping Fighter A and Fighter B negates the feature vector and forces P(A,B) = 1 − P(B,A). Hyperparameter selection used fights before 2022 for fitting and 2022 for validation. The final coefficients were fitted once on 2018–2022 and are frozen for production. The public live record must not retune those coefficients.

The frozen production coefficients live in `scripts/lib/predictor_v02.mjs`. Predictor 0.2.1 uses the same 33 feature definitions and lambda 0.003 as 0.2.0, refitted after canonical duplicate removal. Explanations shown with a prediction are sums of the model's actual feature contributions grouped into readable areas: competitive strength, overall technical profile, striking, wrestling/grappling, pace/finishing, recent form/schedule, UFC evidence and pre-UFC résumé. They are not free-form AI explanations.

The common historical benchmark requires Predictor 0.1 to have produced a real baseline probability; missing values are excluded rather than coerced to zero. Predictor 0.2.1 can use a conservative prior for a fighter with verified pre-UFC history. If a fighter has neither a UFC rating nor verified warehouse history, the matchup uses the documented neutral-start Elo fallback with slope 0.006085080947128282 and carries a limited-history label.

## Forecasts and the live counter

Predictions are saved before the earliest published card start, with their timestamp, model version, explicit pick, input snapshot hash, grouped feature drivers and explanation. A database trigger prevents prediction updates. Replacements get a new matchup; cancelled originals remain auditable.

The prior Elo-only live model is retained in the database under `CageMetrix Elo Baseline`. Predictor 0.1 and 0.2.0 predictions remain stored under their original versions and snapshots. Predictor 0.2.1 reuses the existing public forecast API key without rewriting any saved probability.

The public counter grades only saved pre-start production predictions on completed decisive bouts. It reports correct, incorrect, pending, excluded, accuracy and Brier score. Draws, no-contests, cancellations, missing winners and 50/50 no-picks are excluded. Backtests never create live wins.

On fight day, a Cloudflare scheduled handler checks the public live JSON feed used by UFC's event page every two minutes, from 30 minutes before the prelims through 12 hours after their scheduled start. It grades each complete result only when the fight's feed status is `Final`, without waiting for the full card's statistics. `Live` or `Over` fights can contain unofficial winner fields and are never graded. Matching requires the official bout identifier and both fighters; incomplete, conflicting or missing source rows cannot create a winner. Pages without live feed settings fall back to completed HTML results, which can arrive later. Result changes and corrections retain their source URL in an audit table without changing saved predictions. Source failures retain the previous results and expose a freshness warning. Hourly checks cover the preceding week and the first 72 hours after the start; later statistical reconciliation uses the daily import.

Prediction and track-record pages refresh every 30 seconds while visible, with a 15-second forecast API cache. Timing depends on the official source's publication delay. This is a final-result feed, with no live odds or round-by-round scoring; detailed ratings still wait for verified statistics.

## Validation

The Predictor 0.2.1 promotion benchmark builds every historical feature vector from ratings available strictly before the event date. Hyperparameter selection uses 2022 only; the final fit uses 2,302 bouts from 2018–2022. The corrected common holdout contains 1,446 fights from January 1, 2023 through June 27, 2026 where Predictor 0.1 produced a real baseline probability.

On the corrected common holdout, Predictor 0.1 recorded 62.79% accuracy, 0.228731 Brier score and 0.649529 log loss. Predictor 0.2.1 recorded 63.62%, 0.226996 and 0.645930 respectively. On the same set, the base CMR probability scored 52.84%, 0.267058 and 0.737624; the canonical-history CMR candidate scored 53.39%, 0.260330 and 0.719169. Both promotion gates require lower Brier score and log loss, while Predictor accuracy may not decline by more than 0.5 percentage points.

This is retrospective validation on today's corrected source, not a prospective claim. Calibration and accuracy should be judged over a growing prospective sample, with misses and superseded model versions preserved.

`public/model-validation.json` and `public/predictor-validation.json` remain available for earlier benchmarks. The promotion workflow generates the canonical-history benchmark, independent common-holdout validation and exact fitted coefficients as downloadable audit artifacts.

## Refresh and limitations

Daily GitHub Actions runs at 08:30 UTC verify complete recent cards, persist the supplemental event archive in D1, rebuild changed-source ratings and lock/grade forecasts. The existing Worker and D1 are sufficient; Workers AI is not used. Failed or regressing/incomplete feeds do not replace the last successful dataset.

New UFC or canonical-warehouse source hashes append immutable rating snapshots, including same-date corrections. APIs select one latest row per fighter/model. Legacy CMR 0.3.1 ratings and Predictor 0.2.0 predictions remain stored for audit. Fighter UPSERTs preserve IDs. A D1 export precedes changed-source imports; bounded SQL statements are submitted in one file import with publication metadata last. Promotion audit artifacts retain benchmarks, fitted coefficients, D1 verification, summaries and pre-refresh exports for 30 days. An unchanged combined source refresh updates activity/check timestamps without rewriting ratings or predictions.

“Active” means a UFC bout within 18 months of refresh time plus explicit retirement overrides, not a fully verified contracted roster. The latest included date is visible. Predictor 0.2.1 omits injuries, short notice, camps, betting markets and other news factors. Those should remain separate until a future version demonstrates that a new input improves leakage-safe out-of-sample prediction.
