# Predictor 0.2 candidate protocol

Recorded before running the new experiments. This is a separate offline research candidate; Predictor 0.1 remains the production model. Do not merge a candidate into public forecasts on the strength of this benchmark alone.

## Data and chronology

- Pin the exact merged fight CSV and fighter-details CSV with SHA-256 hashes and a profile observation date. Reject results after the declared evaluation end.
- Recompute unchanged CMR 0.3.0 before every event date using strictly earlier fights. Exclude the entire current date, including other bouts on that card. Only decisive fights with two rated fighters train the candidate. Report unrated-fighter Elo fallback coverage separately and include it in all-bout evaluation.
- Age is fractional years on the fight date from DOB; invalid or implausible DOB becomes missing. The age basis is linear and a quadratic centered at 30, with linear interactions for women's divisions and men's light heavyweight/heavyweight. Thirty is a basis center, not an imposed peak age.
- Layoff means days since the last recorded UFC appearance, including draws and no contests, not absence from all combat sports. Use log(1 + days / 30) and log(1 + max(0, days − 365) / 365). Never use a fighter's current `last_fight_date` for historical rows.
- Reach is a pairwise centimeter difference. Stance uses directional southpaw-versus-orthodox and switch-stance indicators. Missing values yield zero pairwise contribution plus a directional missingness indicator, never a fabricated measurement. All features reverse sign when fighters swap.
- The available details file has current DOB, reach and stance without historical observation dates. Projecting DOB backward assumes the current birth date is correct. Reach and especially stance experiments also assume the current profile describes the historical matchup. These are retrospective assumptions, explicitly counted in outputs; they are not point-in-time verified data. Exclude ambiguous Bruno Silva profiles.
- Current career statistics in the details file are never read as features. Injuries, rumors and betting odds are not candidate inputs.

## Experiment selection

Fit a symmetric L2-regularized logistic model with no intercept, using the same optimizer as 0.1. Normalization is learned from training rows only. Refit the 24 unchanged rating features alongside these seven predefined alternatives: ratings only; age; layoff; age + layoff; age + layoff + reach; age + layoff + stance; all four groups.

Train on 2018–2021, choose regularization from 0.001, 0.01, 0.1 and 0.5 using 2022 log loss (Brier as tie-breaker), and select the experiment on that same validation criterion. Selection of both family and regularization makes 2022 a development set, not an unbiased performance estimate. Freeze this choice before scoring 2023 through 2026-08-29. Final coefficients fit 2018–2022 only (900 optimizer steps; tuning uses 600).

The 2023+ period has already been examined for Predictor 0.1. It is a reused historical comparison, not fresh confirmation of 0.2 and not a live accuracy record. Do not retune based on its output. If a new candidate is designed after inspecting these results, bump the candidate revision and document the reuse.

## Evaluation and promotion

Compare every experiment with frozen 0.1 on exactly the same fights. Report accuracy, Brier score, log loss, calibration bins, year/division breakdowns, missing-feature coverage, and a paired 95% Brier difference interval resampling event dates (2,000 deterministic bootstrap samples). Lower Brier/log loss is better; these measure overall probability quality, not calibration alone. Use all-fight metrics alongside the rated-only primary comparison.

No automatic production promotion. The selected candidate must improve Brier and log loss, with the paired Brier interval below zero, before being considered for prospective shadow evaluation. Still review yearly/divisional instability and profile provenance. Unknown historical stance/reach cannot be advertised as verified historical evidence. Freeze the artifact and collect independently locked, as-of source snapshots on future fights before deciding on production. Keep those records and accuracy counters separate from 0.1. A future shadow runner must collect source evidence before the lock, preserve replacement identities, and never write candidate records under the production model key.

References: [chronological model evaluation](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html), [probability calibration and proper scoring rules](https://scikit-learn.org/stable/modules/calibration.html), [existing profile dataset](https://github.com/komaksym/UFC-DataLab).
