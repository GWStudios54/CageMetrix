# CMR 0.4 candidate

CMR 0.4 is an isolated candidate. Production remains CMR 0.3 + Predictor 0.1 until this candidate passes behavioral review and leakage-safe validation.

## Core rule

**No opportunity means no skill evidence.** A fighter who does not attempt a takedown is not graded as if the attempt failed, and a fighter who does not face a takedown is not credited with a successful defense. The same principle applies to striking opportunities.

## Technical rating

- Striking offense: 28%
- Striking defense: 24%
- Wrestling offense: 16%
- Wrestling defense: 16%
- Grappling: 10%
- Finishing threat: 6%

Pace remains a published style/activity metric but is not part of Technical.

Each skill uses its own evidence reliability. Significant-strike attempts support striking offense; attempts faced support striking defense; takedown attempts support wrestling offense; takedowns faced support wrestling defense; actual grappling engagement supports grappling; finishing evidence is conditioned on landed strikes and grappling exposure.

## Top-level CMR

- Technical: 56%
- Resume: 24%
- Strength of schedule: 10%
- Recent form: 10%

The final CMR is calculated directly from the displayed reliability-adjusted components. There is no separate hidden uncertainty penalty.

## Other changes

- Pace uses only the fighter's own activity.
- Draws update Elo as 0.5 outcomes; no-contests do not update Elo.
- Elo no longer receives a finish multiplier.
- Recent form uses actual calendar decay and performance versus Elo expectation.
- Previous-division evidence inside the two-year transfer window is discounted to 80%.
- Strength of schedule is measured separately instead of also multiplying technical performance by opponent Elo.
- Short finishes cannot create extreme per-15 finishing rates; finishing evidence is opportunity-conditioned and heavily reliability-shrunk.

## Predictor 0.2 candidate

Predictor 0.1 stays frozen with CMR 0.3. The candidate Predictor 0.2 is trained from scratch on CMR 0.4 features. It adds skill-specific evidence interactions while retaining pace as a matchup-style feature.

Hyperparameter selection uses 2022 only. Final fitting uses 2018-2022. The 2023+ period remains untouched until final evaluation.

No candidate is promoted automatically based on one metric. Review probability calibration, Brier score, log loss, accuracy, behavior on sparse evidence, and current-rating sanity before freezing a production version.
