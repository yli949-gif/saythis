# WISE — Idea Detection

WISE extracts and evaluates research "ideas" from long technical documents. The current
milestone is the **idea detection evaluation pipeline**: given a corpus of annotated
documents, detect idea spans and classify them into one of 15 idea categories
(Idea 1 … Idea 15), then report evaluation metrics.

## Project goal

Ship a reliable evaluation of the idea-detection model so the team can decide whether
to move to the extraction stage. The decision gate is per-idea F1 reported with support,
averaged over multiple trials.

## Team

- **David** — research lead, sets evaluation requirements.
- **Ella** — owns the evaluation pipeline (`src/evaluate.py`), runs experiments, reports results.
- **Marcus** — model training.

## Repository layout

- `docs/` — evaluation plan and design notes
- `experiments/` — experiment logs and notes
- `results/` — evaluation result CSVs (versioned: v2, v3, ...)
- `meeting_notes/` — team meeting notes
- `src/` — evaluation code
