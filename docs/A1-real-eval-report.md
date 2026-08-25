# Milestone A1 — Real-Provider Evaluation Report

Run environment: **user's Mac** (cloud sandbox blocks api.openai.com), Node 25.8, provider `openai`
(triage `gpt-4o-mini`, generation `gpt-4o`, embeddings `text-embedding-3-small`).
Result: **10/10 fixtures + privacy gate PASS. Intelligence latency avg 3.38 s, max 4.29 s.**
Zero mock-skipped assertions — every check ran for real. Full raw data: `eval/report-openai.json`.

Legend for evidence lists: `C`=conversation, `M`=Project Memory (with source file), `F`=file chunk (hybrid FTS5+vec rank). ★ = cited by the model in its answer.

---

## Fixture 01 — direct technical question (DoD 1)

**Context:** David: "Okay, quick check on the eval setup before we move on."
**Trigger:** David: "Ella, why did you use micro F1 here?"
**Triage:** `copilot`, question-for-user ✓ · **resolvedQuery:** "Why did you use micro F1 in the evaluation setup, Ella?"
**Triage 中文:** "Ella，为什么在这里使用微F1？" ⚠ ("微F1" — see Q1 below)
**Evidence:** C1 · M1 myResponsibilities(meeting_notes) · M2 myResponsibilities(README) · M3 projectGoal · M4 currentTasks · M5 decisions · F1 v3.csv:profile · F2 v2.csv:profile · **F3★ meeting_notes:Discussion** · F4 v3.csv:rows · **F5★ meeting_notes:Decisions** · **F6★ evaluation_plan:Metrics**

> **中文理解** 他们在问你为什么在评估设置中使用微平均F1。
> **SAY THIS** "We chose micro F1 because it reflects overall performance and is more reliable with low-support categories. Macro F1 was too noisy for our needs."
> **WHY** Micro F1 chosen as headline metric due to robustness with low-support categories.
> **Confidence:** HIGH · **Conflict:** — · **Smart question:** —
> **Sources:** meeting_notes/2026-08-10-eval-sync.md, docs/evaluation_plan.md

**Latency:** triage 718 / retrieval 524 / generate 1936 / **total 3178 ms** · **Checks:** 9/9 ✓
**Quality:** Exactly right file (evaluation_plan:Metrics is the canonical rationale). 2 sentences, speakable, grounded. ✅

## Fixture 02 — vague "Why?" follow-up (DoD 2)

**Context:** David: "Looking at v3, Idea 12 is still pretty weak." → me: "Yes, it's at 0.68 right now."
**Trigger:** David: **"Why?"**
**Triage:** `copilot` ✓ · **resolvedQuery:** "Why is Idea 12 rated so low at 0.68?" — **correct referent reconstruction**
**Evidence:** C1 · M1 keyFacts(plan) · M2 openQuestions(meeting) … · **F1★ v3.csv:rows** · F2 v2.csv:rows · **F3★ experiment_notes:v3-run** · **F4★ evaluation_plan:Known-weak** · F5 meeting:OpenQuestions · F6 v3.csv:profile

> **中文理解** 他们在问为什么Idea 12的评分这么低，只有0.68。
> **SAY THIS** "Idea 12 has low support, only 28 instances, which affects its stability. Also, there's some ambiguity with Idea 9 that might be impacting its score."
> **WHY** Low support and boundary ambiguity with Idea 9 are noted issues.
> **Confidence:** HIGH · **Conflict:** ⚠ "0.68 in v3 (most recent) and 0.66 in v2" (see Q2)
> **Sources:** v3.csv, experiment_notes.md, evaluation_plan.md

**Latency:** 888 / 205 / 2237 / **3329 ms** · **Checks:** 8/8 ✓
**Quality:** The exact causal answer from experiment_notes (support=28, Idea 9 boundary). Both numbers (28, Idea 9) verified in sources. ✅ Conflict banner is technically true but off-topic noise for a "why" question.

## Fixture 03 — exact number, latest version (DoD 3)

**Trigger:** David: "What's the F1 for Idea 12 in the latest run?"
**Triage:** `copilot` ✓ · resolvedQuery ≈ verbatim · 中文: "David在问最新运行中Idea 12的F1分数是多少。"
**Evidence:** M1–M5 memory · **F1★ v3.csv:rows** (top file hit — correct!) · **F2★ experiment_notes:v3-run** · F3 v2.csv:rows · …

> **中文理解** 他们在问Idea 12在最新运行中的F1得分是多少。
> **SAY THIS** "The F1 score for Idea 12 in the latest run is 0.68."
> **WHY** Most recent evidence from v3 shows 0.68.
> **Confidence:** HIGH · **Conflict:** ⚠ "Sources agree that … v3 is 0.68, more recent than 0.66 in v2" (see Q2 — a *non-conflict* rendered in the conflict field)

**Latency:** 1140 / 193 / 2723 / **4056 ms** · **Checks:** 8/8 ✓ (0.68 present, 0.66 correctly absent from sayThis)
**Quality:** Correct value, correct file, v2's stale 0.66 excluded. ✅ The conflict field content is wrong-by-design (it literally says "sources agree").

## Fixture 04 — done vs not done (DoD 4)

**Trigger:** David: "Have you already run the five-trial evaluation?"
**Triage:** `copilot` ✓ · 中文: "你已经进行过五次试验评估了吗？"
**Evidence:** **M1★ currentTasks(experiment_notes): "needs to run the 5-trial run…"** · M2 currentTasks(meeting) · **M3★ myResponsibilities(meeting)** · M4 completedWork · … files: CSVs/plan (not helpful — memory carried this one, exactly as the priority order intends)

> **中文理解** 他们在问你是否已经完成了五次试验的评估。
> **SAY THIS** "I haven't run the five-trial evaluation yet. I still need to do that."
> **Confidence:** HIGH · **Conflict:** — · **Sources:** experiment_notes.md (memory:currentTasks), meeting_notes (memory:myResponsibilities)

**Latency:** 759 / 591 / 1676 / **3026 ms** · **Checks:** 8/8 ✓
**Quality:** Perfect status distinction — planned-but-not-run stated as not run, no false completion claim. This is Project Memory earning its place. ✅

## Fixture 05 — missing info → safe LOW (DoD 5)

**Trigger:** David: "What was the F1 on the held-out clinical subset?" (fact does not exist anywhere)

> **中文理解** 他们在问临床子集的F1分数是多少。
> **SAY THIS** "I'm not completely sure about that number. Let me double-check after the meeting."
> **WHY** The evidence does not specify this.
> **Confidence:** **LOW** · **Sources:** (empty — correct) · no number pattern anywhere in sayThis

**Latency:** 707 / 279 / 1725 / **2710 ms** · **Checks:** 7/7 ✓
**Quality:** Textbook safe uncertainty. Despite 11 evidence items being offered (all irrelevant), the model refused to improvise. **The single most important safety behavior — confirmed.** ✅

## Fixture 06 — conflicting v2/v3 values (DoD 6)

**Trigger:** David: "What F1 are we reporting for Idea 7?" (v2: 0.71, v3: 0.68)
**Evidence:** M1–M5 · **F1★ v3.csv:rows** · F2 v2.csv:rows · **F3★ experiment_notes:v3-run** · F4 experiment_notes:v2-run · …

> **中文理解** 他们在问我们为Idea 7报告的F1值是多少。 (triage版: "第7个想法" ⚠ see Q1)
> **SAY THIS** "The F1 score for Idea 7 is 0.68 in the latest v3 results."
> **Confidence:** HIGH · **Conflict:** ⚠ "0.68 in v3 and 0.71 in v2, with v3 being the most recent." — detected, both values named, recency reasoning correct, no silent averaging.

**Latency:** 719 / 195 / 2198 / **3112 ms** · **Checks:** 8/8 ✓
**Quality:** Exactly the specified behavior: answer with the newer value, surface the disagreement explicitly. ✅

## Fixture 07 — small talk (DoD 7)

Weekend/hiking/weather exchange → all three utterances `skip`, **zero cards, zero generation calls** (fillers died at triage; total wall 1223 ms was triage-only). ✅

## Fixture 08 — answered earlier in meeting (conversation priority)

**Trigger:** Marcus (joined late): "Ella, why micro F1 again?" — after Ella already answered David.
**resolvedQuery:** "Why did you choose micro F1 instead of macro F1?"

> **SAY THIS** "We chose micro F1 because some ideas have very low support, making macro F1 too noisy."
> **Sources:** **(current meeting) ★** + evaluation_plan (memory:keyFacts)

**Latency:** 778 / 355 / 1838 / **2972 ms** · **Checks:** 7/7 ✓
**Quality:** Echoes the user's own earlier phrasing (consistency!), cites the conversation as primary source — retrieval priority №1 working as designed. ✅

## Fixture 09 — next-step request

**Trigger:** David: "Okay, so what's our next step on the eval?"

> **中文理解** 他们在问我们评估的下一步是什么。
> **SAY THIS** "I need to run the 5-trial evaluation, which will take about 6 hours of compute time. I'll update the results table once it's done."
> **Sources:** meeting_notes (memory:myResponsibilities) ★, experiment_notes (memory:currentTasks) ★
> **Smart question:** — (none generated)

**Latency:** **2173** / 268 / 1853 / **4294 ms** (slowest run — triage outlier) · **Checks:** 7/7 ✓
**Quality:** Grounded ("~6 hours" comes from experiment_notes), ownership correct. ✅ Slightly long-ish but 2 sentences and natural.

## Fixture 10 — exact entity in code (`max_workers`)

**Trigger:** David: "What did you set max_workers to in the eval pipeline?"

> **SAY THIS** "I set max_workers to 8 in the evaluation pipeline."
> **Sources:** experiment_notes (memory:completedWork) ★, **src/evaluate.py ★**, **config.json ★**

**Latency:** 926 / 171 / 2636 / **3733 ms** · **Checks:** 7/7 ✓
**Quality:** Lexical entity retrieval reached into code + config; three independent agreeing sources. ✅

---

## Summary table

| # | Fixture | Triage | resolvedQuery | Retrieval | Answer | Conf | Latency (ms) | Checks |
|---|---|---|---|---|---|---|---|---|
| 01 | direct question | ✓ copilot | ✓ | ✓ plan:Metrics | ✓ grounded, 2 sent | high | 3178 | 9/9 |
| 02 | "Why?" follow-up | ✓ copilot | ✓ **Idea 12 resolved** | ✓ notes+csv | ✓ support 28 + Idea 9 | high | 3329 | 8/8 |
| 03 | exact number, latest | ✓ copilot | ✓ | ✓ **v3.csv top** | ✓ 0.68, no 0.66 | high | 4056 | 8/8 |
| 04 | done vs not done | ✓ copilot | ✓ | ✓ via **Memory** | ✓ "haven't yet" | high | 3026 | 8/8 |
| 05 | missing info | ✓ copilot | ✓ | (nothing relevant) | ✓ **safe, no number** | **low** | 2710 | 7/7 |
| 06 | v2/v3 conflict | ✓ copilot | ✓ | ✓ both csvs | ✓ 0.68 + ⚠ both values | high | 3112 | 8/8 |
| 07 | small talk | ✓ skip ×3 | — | — | ✓ no card | — | — | 1/1 |
| 08 | answered earlier | ✓ copilot | ✓ | ✓ **conversation ★** | ✓ consistent w/ user | high | 2972 | 7/7 |
| 09 | next step | ✓ copilot | ✓ | ✓ via Memory | ✓ owned task + 6h | high | 4294 | 7/7 |
| 10 | max_workers | ✓ copilot | ✓ | ✓ **code+config** | ✓ "8", 1 sent | high | 3733 | 7/7 |

Latency decomposition (avg): triage 979 · retrieval 298 · generate 2091 · **total 3379**. Privacy gate ✓.

## Manual quality review (7 dimensions)

1. **Speakability — good.** All answers 1–3 short sentences, plain vocabulary, first-person, no corporate polish. Weakest: none egregious; fixture 09 is the longest but still natural.
2. **Grounding — good.** Every project number in every answer (0.68, 28, 8, 6 hours, support<30) traces to a retrieved chunk or memory item. Fixture 05 proves refusal when evidence is absent.
3. **Project status — good.** Done vs not-done exactly right (04, 09); memory separates completedWork from currentTasks and the model respected it.
4. **Context resolution — good.** "Why?" → "Why is Idea 12 rated so low at 0.68?"; late-joiner repeat → resolved and answered from the conversation itself.
5. **Safe uncertainty — good.** LOW + safe sentence + empty sources + zero invented numbers.
6. **Conflict handling — mixed.** The real conflict (06) is handled exactly to spec. But the conflict *field* fires on non-conflicts too (02, 03) — see Q2. Detection: correct; presentation: noisy.
7. **Chinese comprehension — acceptable, one systematic flaw.** Gist-style and fast to read, but technical terms/entities get translated ("微平均F1", "第7个想法", "持出临床子集"), which slows recognition — the opposite of the feature's purpose. See Q1.

## Questionable results (all technically PASS)

- **Q1 — Chinese translates technical terms.** Triage and generation both render "micro F1"→"微(平均)F1", "Idea 7"→"第7个想法", "held-out"→"持出". A bilingual engineer reads "micro F1" faster than "微平均F1". → **prompt issue** (both triage & gen prompts).
- **Q2 — conflict field fires on non-conflicts.** Fixture 03's conflict literally says "Sources agree…". Two causes: (a) my pipeline force-fills `event.conflict` with the auto-detector hint even when the model returns null (`gen.conflict ?? conflictHint` in copilot.ts) — **pipeline bug, mine**; (b) the prompt doesn't say "only report a conflict that is unresolved *for this question*" — **prompt issue**. In the UI this would show a spurious ⚠ banner on clean answers.
- **Q3 — smartQuestion never generated (0/10).** Correct restraint on these fixtures, but the feature has zero positive validation — we don't know it works, only that it's quiet. → **eval-coverage gap**, needs 1–2 gap-scenario fixtures (task with no deadline; experiment with no success metric).
- **Q4 — file retrieval underweights prose for status queries.** In 04/09, file-level top hits were CSV profiles; Project Memory rescued both (by design, priority 2). Fine now, but on a project without good notes/memory, status questions would degrade. → **retrieval tuning** (make the `results/` doctype boost conditional on numeric/metric intent). Low priority.
- **Q5 — triage latency variance.** 707–2173 ms for identical-shape calls (network/API variance). Total worst case 4.29 s sits at the budget edge. Structural fix (streaming generation, already planned for A2 UI) will cut *perceived* latency below the felt threshold; no action now.
- **Q6 — duplicated meaningZh.** Both triage and generation produce one; UI will use generation's (better) version. Wasted tokens only. No action for A1.

## Diagnosis by component

| Component | Verdict |
|---|---|
| Triage | Correct on 10/10 classifications + all referent resolutions. Latency variance only. |
| Conversation context | Working (02, 08). |
| Project Memory | High-quality build (goal/tasks/decisions/status all correct w/ sources); carried fixtures 04, 09, 10. |
| Retrieval | Right file top-ranked in all lexical cases; prose-vs-CSV weighting slightly off for status queries (Q4). |
| Prompt | Source of Q1 (Chinese terms) and half of Q2 (conflict criteria). |
| Pipeline code | One real bug: conflict force-fill fallback (Q2a). |
| Model | No hallucination, no schema violation, no length violation in any run. |

## Smallest recommended changes (pre-A2)

1. **copilot.ts, one line:** stop force-filling `event.conflict` with the auto-hint; the hint stays as generation *input* only. (fixes Q2a)
2. **prompts.ts, two sentences:** 中文理解 must keep technical terms, metric names, and entity names in English ("micro F1", "Idea 7"); conflict field only when the disagreement is unresolved *for the question asked*. (fixes Q1, Q2b)
3. **Two new fixtures** where a smartQuestion SHOULD fire (missing owner; missing success metric) + one where it must stay silent. (fixes Q3)
4. Re-run `npm run eval`, confirm 13/13.

Nothing architectural. Estimated effort: ~30 minutes including the re-run.

## A1 release-gate verdict

Gates 1–5, 8, 9, 10: **pass** on real behavior. Gate 6 (speakable English): pass. Gate 7 (Chinese immediately understandable): pass with the Q1 caveat. Recommendation: apply changes 1–3, re-run, then declare A1 complete and start A2 (live transcription).
