# CageMetrix methodology — CMR 0.3.0 / Predictor 0.1

CMR is a descriptive fighter rating. Future-fight win probabilities use a separate frozen matchup model, Predictor 0.1, built from CMR skill components plus Elo. The retrospective benchmark and live prediction counter are separate; historical tests never add wins to the live record.

## Sources and identities

Historical statistics come from [UFC DataLab](https://github.com/komaksym/UFC-DataLab), currently through June 27, 2026. The supplemental archive adds 102 bouts across eight main UFC cards through August 29. Every supplemental matchup, winner, method, round, time and division comes from its linked official UFC event card; detailed box scores come from UFCalendar's UFCStats mirror. Every row retains both URLs. Upcoming cards come from UFC.com.

DataLab does not publish athlete IDs. CageMetrix assigns persistent internal keys used throughout opponent adjustment, aggregates, Elo and database joins. Bruno “Bulldog” and “Blindado” Silva have separate identities, resolved by nickname or a reviewed official profile slug. Missing discriminators and name/slug collisions fail ingestion. The sole DataLab Bruno biometric row belongs to Blindado. Bulldog's height/reach use his official UFC profile; his DOB is unavailable. Internal keys are not presented as official UFC IDs. Other source identity errors remain possible.

## CMR

Men's and women's divisions are separate, including featherweight. Striking and takedown offense/defense compare each bout with the opponent's other bouts in that division, stabilized with a 45-minute division prior and a 0.25 smoothing constant. This is a single-pass retrospective adjustment, not a recursive latent-skill model.

Weights combine recency (3.5-year exponential time constant), duration and pre-bout opponent Elo. Short-fight exposures use a 30-second floor. Current-division bouts are retained plus the immediately previous division's bouts in the two years before the current stint. No-contests remain in raw history but are excluded from ratings, samples and Elo. DQs receive no finishing-skill bonus. Draws supply skill evidence but do not update Elo.

Components are standardized within the current division's available historical population: 50 + 15 standard deviations, clipped to 5–99. There is no explicit era, age or layoff model. Grappling, pace and finishing are direct measures, not fully opponent-adjusted skill estimates.

Technical performance: striking offense 30%, striking defense 22%, wrestling offense 16%, wrestling defense 16%, grappling 8%, pace 4%, finishing 4%. Performance CMR: technical 56%, normalized career Elo (“résumé”) 24%, strength of schedule 10%, last five retained results 10%, with deviations from 50 expanded by 1.45. These weights are hand-set. Displayed component scores are separately exposure-shrunk, so their weighted sum does not exactly reproduce performance CMR.

Sample strength is a 0–100 exposure index: 42% × (1 − exp(−minutes/45)) + 58% × (1 − exp(−bouts/5)), bounded to 0.08–0.99 before multiplying by 100. It is not an accuracy probability, confidence interval or measure of source quality. Ranked CMR shrinks performance toward 50 and subtracts sample penalties, including three points per missing bout below five. Samples below five bouts or 55 strength points are provisional.

## Predictor 0.1

Predictor 0.1 is a 24-feature regularized logistic model. Its inputs are pre-fight differences and matchup interactions derived from Elo, CMR, technical rating, résumé, striking offense and defense, wrestling offense and defense, grappling, pace, finishing, strength of schedule, recent form, sample strength, bout count and cage time. It also includes offense-versus-defense interaction features such as striking offense against the opponent's striking defense and wrestling offense against the opponent's wrestling defense. Betting odds are not used.

Every training matchup is mirrored so swapping Fighter A and Fighter B negates the feature vector and forces P(A,B) = 1 − P(B,A). Hyperparameter selection used fights before 2022 for fitting and 2022 for validation. The final coefficients were fitted once on 2018–2022 and are frozen for production. The public live record must not retune those coefficients.

The production coefficients live in `scripts/lib/predictor_v01.mjs`. Explanations shown with a prediction are sums of the model's actual feature contributions grouped into readable areas: competitive strength, overall technical profile, striking, wrestling/grappling, pace/finishing, recent form/schedule and UFC experience/sample. They are not free-form AI explanations.

The historical benchmark requires both fighters to have at least one prior rated UFC bout. If an upcoming fighter has no UFC rating yet, Predictor 0.1 cannot make a validated feature-vector prediction; that matchup uses the separately documented neutral-start Elo fallback with slope 0.006085080947128282 and carries a limited-history label. Fighters with fewer than five rated bouts also carry a limited-sample label, but still use Predictor 0.1 once both have a rating.

## Forecasts and the live counter

Predictions are saved before the earliest published card start, with their timestamp, model version, explicit pick, input snapshot hash, grouped feature drivers and explanation. A database trigger prevents prediction updates. Replacements get a new matchup; cancelled originals remain auditable.

The prior Elo-only live model is retained in the database under `CageMetrix Elo Baseline`. Predictor 0.1 reuses the existing public forecast API key so the fight-day result pipeline does not rewrite or relabel any saved Elo prediction.

The public counter grades only saved pre-start Predictor 0.1 predictions on completed decisive bouts. It reports correct, incorrect, pending, excluded, accuracy and Brier score. Draws, no-contests, cancellations, missing winners and 50/50 no-picks are excluded. Backtests never create live wins.

On fight day, a Cloudflare scheduled handler checks the public live JSON feed used by UFC's event page every two minutes, from 30 minutes before the prelims through 12 hours after their scheduled start. It grades each complete result only when the fight's feed status is `Final`, without waiting for the full card's statistics. `Live` or `Over` fights can contain unofficial winner fields and are never graded. Matching requires the official bout identifier and both fighters; incomplete, conflicting or missing source rows cannot create a winner. Pages without live feed settings fall back to completed HTML results, which can arrive later. Result changes and corrections retain their source URL in an audit table without changing saved predictions. Source failures retain the previous results and expose a freshness warning. Hourly checks cover the preceding week and the first 72 hours after the start; later statistical reconciliation uses the daily import.

Prediction and track-record pages refresh every 30 seconds while visible, with a 15-second forecast API cache. Timing depends on the official source's publication delay. This is a final-result feed, with no live odds or round-by-round scoring; detailed ratings still wait for verified statistics.

## Validation

`public/predictor-validation.json` contains the frozen Predictor 0.1 retrospective benchmark. Every historical feature vector was generated from ratings built strictly before the event date. The final model was fitted on 1,923 matched fights from 2018–2022 and evaluated on 1,516 matched fights from January 1, 2023 through August 29, 2026.

On that holdout, Predictor 0.1 recorded 63.19% pick accuracy, 0.22823 Brier score and 0.64854 log loss. Calibrated Elo recorded 54.72%, 0.24588 and 0.68482 respectively. The paired event-bootstrap 95% interval for Predictor-minus-Elo Brier was -0.02299 to -0.01264, entirely below zero. Among 683 fights where both fighters had at least five prior rated bouts, Predictor 0.1 accuracy was 62.37% versus 52.56% for Elo.

This is retrospective validation on today's corrected source, not a prospective claim. The separate live counter begins when Predictor 0.1 forecasts are saved before real future cards. Calibration and accuracy should be judged over a growing prospective sample, with misses preserved.

`public/model-validation.json` remains available for the earlier CMR-versus-Elo benchmark. That test showed CMR alone did not establish an overall forecasting advantage over Elo; Predictor 0.1 is a different model that uses the underlying skill components as matchup inputs rather than treating headline CMR as the prediction.

## Refresh and limitations

Daily GitHub Actions runs at 08:30 UTC verify complete recent cards, persist the supplemental event archive in D1, rebuild changed-source ratings and lock/grade forecasts. The existing Worker and D1 are sufficient; Workers AI is not used. Failed or regressing/incomplete feeds do not replace the last successful dataset.

New source hashes append immutable rating snapshots, including same-date corrections. APIs select one latest row per fighter/model. Legacy snapshots remain stored for audit. Fighter UPSERTs preserve IDs. A D1 export precedes changed-source imports; bounded SQL statements are submitted in one file import with publication metadata last. Workflow audit artifacts retain summaries and pre-refresh exports for seven days. An unchanged source refresh updates activity/check timestamps without rewriting ratings or predictions.

“Active” means a UFC bout within 18 months of refresh time plus explicit retirement overrides, not a fully verified contracted roster. The latest included date is visible. Predictor 0.1 omits injuries, short notice, camps, betting markets and other news factors. Those should remain separate until a future version demonstrates that a new input improves leakage-safe out-of-sample prediction.
