# Experiment Notes

## 2026-08-05 — v2 run

Single trial, seed 42. Micro F1 = 0.79. Full per-idea results in
`results/evaluation_results_v2.csv`. Idea 7 came in at 0.71 but support is only 24,
so the number is unstable.

## 2026-08-12 — v3 run

Single trial, seed 43, after Marcus's checkpoint update. Micro F1 = 0.81.
Per-idea results in `results/evaluation_results_v3.csv`.

Idea 12 remains one of the least stable categories: F1 = 0.68 in v3, and across
informal reruns it fluctuated between 0.61 and 0.72. Likely cause: low support (28)
plus ambiguous boundary with Idea 9.

Idea 7 dropped from 0.71 (v2) to 0.68 (v3). Unclear if real regression or seed noise.

## Status

**Completed:**
- v2 and v3 single-trial evaluation runs
- Per-idea F1 + support columns added to the results CSVs
- Evaluation code parallelized (`max_workers=8`)

**Not done yet:**
- The 5-trial averaged run (agreed in the 2026-08-10 meeting) has NOT been run yet.
  Blocked on nothing — just needs ~6 hours of compute. Ella to run it.
- Mean/std aggregation script for multi-trial results (not written).
- Decision on whether to include standard deviation in the report.
