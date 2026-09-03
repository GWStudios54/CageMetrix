# CageMetrix methodology — CMR 0.3.0 / forecasts 0.1.0

CMR is a descriptive rating. Win probabilities use a separate, result-based Elo model. The retrospective benchmark and live prediction counter are separate; neither model has an established prospective record yet.

## Sources and identities

Historical statistics come from [UFC DataLab](https://github.com/komaksym/UFC-DataLab), currently through June 27, 2026. The supplemental archive adds 102 bouts across eight main UFC cards through August 29. Every supplemental matchup, winner, method, round, time and division comes from its linked official UFC event card; detailed box scores come from UFCalendar's UFCStats mirror. Every row retains both URLs. Upcoming cards come from UFC.com.

DataLab does not publish athlete IDs. CageMetrix assigns persistent internal keys used throughout opponent adjustment, aggregates, Elo and database joins. Bruno “Bulldog” and “Blindado” Silva have separate identities, resolved by nickname or a reviewed official profile slug. Missing discriminators and name/slug collisions fail ingestion. The sole DataLab Bruno biometric row belongs to Blindado. Bulldog's height/reach use his official UFC profile; his DOB is unavailable. Internal keys are not presented as official UFC IDs. Other source identity errors remain possible.

## CMR

Men's and women's divisions are separate, including featherweight. Striking and takedown offense/defense compare each bout with the opponent's other bouts in that division, stabilized with a 45-minute division prior and a 0.25 smoothing constant. This is a single-pass retrospective adjustment, not the recursive latent-skill model proposed in the original design.

Weights combine recency (3.5-year exponential time constant), duration and pre-bout opponent Elo. Short-fight exposures use a 30-second floor. Current-division bouts are retained plus the immediately previous division's bouts in the two years before the current stint. No-contests remain in raw history but are excluded from ratings, samples and Elo. DQs receive no finishing-skill bonus. Draws supply skill evidence but do not update Elo.

Components are standardized within the current division's available historical population: 50 + 15 standard deviations, clipped to 5–99. There is no explicit era, age or layoff model. Grappling, pace and finishing are direct measures, not fully opponent-adjusted skill estimates.

Technical performance: striking offense 30%, striking defense 22%, wrestling offense 16%, wrestling defense 16%, grappling 8%, pace 4%, finishing 4%. Performance CMR: technical 56%, normalized career Elo (“résumé”) 24%, strength of schedule 10%, last five retained results 10%, with deviations from 50 expanded by 1.45. These weights are hand-set. Displayed component scores are separately exposure-shrunk, so their weighted sum does not exactly reproduce performance CMR.

Sample strength is a 0–100 exposure index: 42% × (1 − exp(−minutes/45)) + 58% × (1 − exp(−bouts/5)), bounded to 0.08–0.99 before multiplying by 100. It is not an accuracy probability, confidence interval or measure of source quality. Ranked CMR shrinks performance toward 50 and subtracts sample penalties, including three points per missing bout below five. Samples below five bouts or 55 strength points are provisional.

## Forecasts and the live counter

Elo begins at 1500. Decisive results update with K=28, multiplied by 1.15 for KO/TKO/submission finishes. Probability A = logistic(0.006085080947128282 × (Elo A − Elo B)). The conversion slope was fitted on 2018–2022 only. Debutants use neutral Elo and carry a limited-history label; their accuracy is not established by the matched-fighter benchmark.

Predictions are saved before the earliest published card start, with their timestamp, model version, explicit pick and input snapshot hash. A database trigger prevents overwrites. This version uses the first saved forecast for each matchup. Replacements get a new matchup; cancelled originals remain auditable.

The public counter grades only saved pre-start predictions on completed decisive bouts. It reports correct, incorrect, pending, excluded, accuracy and Brier score. Draws, no-contests, cancellations, missing winners and 50/50 no-picks are excluded. Backtests never create live wins.

On fight day, a Cloudflare scheduled handler checks official UFC cards every two minutes, from 30 minutes before the prelims through 12 hours after their scheduled start. It grades each explicit final result without waiting for the full card's statistics. Matching requires the official bout identifier and both fighters; incomplete, conflicting or missing source rows cannot create a winner. Result changes and corrections are recorded in an audit table without changing saved predictions. Source failures retain the previous results and expose a freshness warning. Hourly checks cover the preceding week and the first 72 hours after the start; later statistical reconciliation uses the daily import.

Prediction and track-record pages refresh every 30 seconds while visible, with a 15-second forecast API cache. Timing depends on the official source's publication delay. This is a final-result feed, with no live odds or round-by-round scoring; detailed ratings still wait for verified statistics.

## Validation

`npm run model:validate` rebuilds the entire model before each event date using strictly earlier bouts, including opponent/population baselines, division assignment and Elo. Probability slopes are fitted on 2018–2022 and frozen for evaluation from 2023 onward. Both fighters must have a prior rated bout. Coverage, an established-fighter subgroup and yearly results are reported.

`public/model-validation.json` contains 1,516 matched evaluation bouts through August 29, 2026: CMR 52.6% accuracy / 0.2479 Brier; calibrated Elo 54.7% / 0.2459. The paired event-bootstrap 95% interval for CMR minus Elo Brier spans zero. This does not establish a CMR forecasting advantage. The test uses today's corrected source, not archived as-published feeds, and is not a prospective accuracy claim.

## Refresh and limitations

Daily GitHub Actions runs at 08:30 UTC verify complete recent cards, persist the supplemental event archive in D1, rebuild changed-source ratings and lock/grade forecasts. The existing Worker and D1 are sufficient; Workers AI is not used. Failed or regressing/incomplete feeds do not replace the last successful dataset.

New source hashes append immutable snapshots, including same-date corrections. APIs select one latest row per fighter/model. Legacy snapshots remain stored for audit. Fighter UPSERTs preserve IDs. A D1 export precedes changed-source imports; bounded SQL statements are submitted in one file import with publication metadata last. Workflow audit artifacts retain summaries and pre-refresh exports for seven days. An unchanged source refresh updates activity/check timestamps without rewriting ratings or predictions.

“Active” means a UFC bout within 18 months of refresh time plus explicit retirement overrides, not a fully verified contracted roster. The latest included date is visible. Forecasts omit injuries, short notice, camps, betting markets and other news factors.
