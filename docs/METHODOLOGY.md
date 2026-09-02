# CageMetrix Methodology — v0.1 Design

This document describes the intended first rating model. It is a design target, not a claim that the model is already validated.

## Core principle

For every measurable skill, CageMetrix asks:

> How did the fighter perform relative to what the same opponents normally produce or allow?

A raw rate is therefore an input, not the final rating.

## 1. Pre-fight snapshots only

Any rating used to evaluate or predict a bout must be calculated from information available before that bout. Historical snapshots are immutable. This prevents future information from leaking into backtests.

## 2. Opponent baselines

For each fighter/opponent pair, compute expected performance from the opponent's other relevant bouts. Examples:

- expected significant strikes landed per minute
- expected significant strikes absorbed per minute
- expected striking accuracy allowed
- expected takedown success allowed
- expected takedown rate produced
- expected control share
- expected submission-attempt rate

Observed performance is compared with that baseline. A fighter who holds an elite wrestler far below the wrestler's normal takedown output should receive more defensive credit than a fighter posting the same raw takedown-defense percentage against weak wrestlers.

## 3. Recursive opponent adjustment

Opponent quality is itself opponent-adjusted. Initial estimates can begin with population/weight-class baselines and then iterate until ratings stabilize.

The implementation should be versioned so changes to weighting, convergence rules, shrinkage, or normalization create a new model version instead of rewriting old results.

## 4. Division and era normalization

Pace and style differ by weight class and era. Raw heavyweight pace should not be interpreted identically to flyweight pace. Component scores are normalized within an appropriate competitive population before being translated to the public 0–100 scale.

## 5. Small-sample control

New fighters are shrunk toward the relevant population mean until sufficient evidence accumulates. Public ratings always carry a confidence score based on bout count, minutes observed, opponent diversity and recency.

## 6. Separate skill from résumé

The model should preserve distinct concepts:

- **Technical rating:** opponent-adjusted measured performance
- **Competitive rating:** result-based rating such as Elo/Glicko-style strength
- **Résumé rating:** quality and depth of proven wins/opposition
- **Strength of schedule:** quality of opposition faced
- **Recent form:** recency-weighted performance trend

The public CageMetrix Rating (CMR) combines these only after each component has been independently validated.

## 7. Initial public components

Target public 0–100 components:

- Striking Offense
- Striking Defense
- Wrestling Offense
- Wrestling Defense
- Grappling
- Durability
- Pace/Cardio
- Finishing Threat
- Strength of Schedule
- Recent Form
- Sample Confidence
- CageMetrix Rating (CMR)

## 8. Prediction model

Bout predictions are a later layer. Inputs may include pre-fight CMR/component differences, style interactions, age, reach, layoff, weight-class movement, five-round experience and other validated variables.

The site should publish probability calibration and Brier score in addition to simple pick accuracy.

## 9. Fight context

News/context flags — injury, illness, short notice, camp change, weight issues, travel/visa problems, long layoffs and similar incidents — remain separate from the statistical model at first. A context variable should not change the prediction until historical evidence shows that it improves out-of-sample prediction.

## 10. Transparency

Every published rating must identify its model version and as-of date. Every published prediction is locked before the bout begins. Model upgrades never retroactively alter the prediction record of an older model.
