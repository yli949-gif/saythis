# Evaluation Plan — Idea Detection

## Metrics

Primary metric: **micro F1** across all idea instances. Micro F1 was chosen because it
reflects aggregate performance over all examples and is robust when per-category counts
are small. Macro F1 was considered and rejected for the headline number because several
ideas have very low support (< 20 instances), which makes macro F1 noisy.

Secondary reporting requirement (added 2026-08-10): **per-idea F1 together with support**,
so that weak categories are visible instead of being hidden by the aggregate.

## Protocol

- Evaluate on the frozen test split (`data/test_v2.jsonl`, 4,812 instances).
- Report results per run version (v2, v3, ...). The latest accepted results file is the
  highest version number in `results/`.
- Planned: average over **5 trials** with different seeds, reporting mean per-idea F1.
  Standard deviation reporting is still an open question.

## Known weak categories

Ideas with support below 30: Idea 7, Idea 12, Idea 14. These are the categories the
per-idea breakdown is meant to expose.

## Terminology

- "support" = number of gold instances of an idea in the test split.
- "trial" = one full evaluation run with a fixed random seed.
