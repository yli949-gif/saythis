"""Idea-detection evaluation pipeline. Owner: Ella."""
import argparse, json
from concurrent.futures import ProcessPoolExecutor
from sklearn.metrics import f1_score

MAX_WORKERS = 8  # parallel document scoring


def load_gold(path: str):
    """Load gold annotations from the frozen test split."""
    with open(path) as f:
        return [json.loads(line) for line in f]


def micro_f1(gold, pred):
    """Headline metric: micro F1 across all idea instances.

    Chosen over macro F1 because low-support ideas (7, 12, 14)
    make macro noisy. See docs/evaluation_plan.md.
    """
    return f1_score(gold, pred, average="micro")


def per_idea_f1(gold, pred, labels):
    """Per-idea F1 + support, reported alongside micro F1 (decision 2026-08-10)."""
    scores = f1_score(gold, pred, average=None, labels=labels)
    support = {l: sum(1 for g in gold if g == l) for l in labels}
    return {l: {"f1": s, "support": support[l]} for l, s in zip(labels, scores)}


def run_trial(seed: int, args):
    """One full evaluation run with a fixed random seed."""
    ...


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--trials", type=int, default=1)  # TODO: default to 5 once agreed
    p.add_argument("--max-workers", type=int, default=MAX_WORKERS)
    args = p.parse_args()
    with ProcessPoolExecutor(max_workers=args.max_workers) as ex:
        ...
