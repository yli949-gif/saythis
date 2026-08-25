# Meeting Copilot — Phase 0 Audit & MVP Implementation Plan

Working name: **SayThis** (placeholder — rename freely).
Date: 2026-08-16. Author: Claude (senior product engineer / AI systems architect role).

---

## 1. Phase 0 — Workspace Audit

**Repository structure:** The cloud workspace is empty. There is no existing code, no package files, no architecture, no tests, no configuration. The attached Claude project ("自己的项目") contains zero docs.

**Existing capabilities:** None in this workspace. One relevant asset exists on the user's Mac — a locally installed "Minutes Conversation Memory" MCP server with live-transcript/copilot tooling — but the user has explicitly chosen to **start from scratch** and not build on it.

**Confirmed decisions (from user):**

| Decision | Choice |
|---|---|
| Starting point | Greenfield, from zero |
| Form factor | macOS desktop application |
| STT | Cloud streaming API |
| LLM / API key | OpenAI API (single key covers STT + LLM + embeddings) |

**What is missing:** Everything — this plan therefore defines the full stack, but scoped ruthlessly to the P0 loop.

**What should be ignored:** The Minutes MCP (user decision), and everything in spec §19 (out of scope).

---

## 2. Key Architecture Decisions

### 2.1 Shell: Electron (not Tauri, not Swift)

- **`electron-audio-loopback`** (npm) captures system loopback audio on macOS 12.3+ via Electron's `desktopCapturer` — this solves the single hardest problem (hearing the *other* meeting participants in Zoom/Meet/Teams) with a maintained library instead of custom native code.
- One language (TypeScript) end-to-end; the whole intelligence pipeline lives in the Electron main process (Node), UI in the renderer (React).
- Tauri would require Rust + custom ScreenCaptureKit bindings for loopback — slower path, no MVP benefit.

**Fallback if loopback breaks** (macOS updates occasionally break ScreenCaptureKit paths): a ~150-line Swift CLI helper using ScreenCaptureKit that pipes 16 kHz PCM to stdout, spawned as a child process. Documented as Plan B; do not build unless needed. Mic-only mode (user on speakers, not headphones) is the emergency fallback.

### 2.2 Audio: two channels = free speaker attribution

Capture **two separate streams** and never mix them:

- **`them` channel** — system loopback audio = remote participants only.
- **`me` channel** — microphone via `getUserMedia` = the user only.

This replaces speaker diarization for the MVP's core need: *"is this a question directed at me?"* is enormously easier when every utterance is already labeled `me` or `them`. Per-person diarization within `them` is deferred (P1+; the Realtime API does not diarize — a later swap to Deepgram/AssemblyAI can add it).

### 2.3 STT: OpenAI Realtime transcription API

- WebSocket transcription sessions (`gpt-4o-transcribe`; downgrade knob to `gpt-4o-mini-transcribe` for cost), **one session per channel**, with server-side VAD producing utterance-final events plus streaming partials.
- Partials render live in the transcript pane; **finals drive the pipeline** (triage → copilot).
- Config: `input_audio_format: pcm16` @ 16 kHz mono, server VAD with ~400–600 ms silence threshold (tune for utterance-boundary latency), language hint `en`.
- To cut cost, the `me` channel session is only fed audio when local energy-based VAD detects speech (cheap RMS gate in the audio worklet).

### 2.4 LLM tiering — two models, two jobs

| Job | Model class | Latency budget | Output |
|---|---|---|---|
| **Triage** (every final `them` utterance): important? question for user? concise 中文理解 | `gpt-4o-mini` / `gpt-4.1-mini` tier | ≤ 700 ms | strict JSON |
| **Copilot generation** (only when triage fires, or manual Ask): SAY THIS / WHY / sources / smart question | `gpt-4.1` / `gpt-4o` tier, **streaming** | first token ≤ 1.2 s | strict JSON schema (streamed) |

Both use OpenAI **structured outputs** (`response_format: json_schema, strict: true`) — this directly implements spec §21's schema. Triage is the cost/latency gate (spec §25): small talk dies at triage and never touches the big model. Heuristic pre-filters (utterance < 3 words and non-interrogative, filler acks) skip even the triage call.

### 2.5 Knowledge base: SQLite, zero infra

One file per project: **`better-sqlite3` + FTS5 (BM25 keyword) + `sqlite-vec` (embeddings)**. Embeddings: `text-embedding-3-small`. No external vector DB, no server, fully local, portable. Hybrid retrieval in one process, < 50 ms per query.

### 2.6 Dev/test topology (important workflow constraint)

The cloud workspace (where I build) is Linux and has no audio hardware and no macOS. Therefore the codebase MUST have a **mock-audio mode** from day one: a `--replay <fixture>` flag that feeds scripted utterances (with timing) into the pipeline *after* the STT boundary. This gives us: full pipeline development + the eval harness runnable headless in CI/cloud, while real audio capture is verified on the user's Mac (`npm run dev`). This is not optional polish — it is how the vertical slice gets built and tested at all.

---

## 3. Proposed Architecture & Data Flow

```
                    ┌──────────────── Electron renderer (React) ───────────────┐
                    │  TranscriptPane   CopilotCard   AskBar   SessionSetup    │
                    └───────────────△──────────────────────△──────────────────┘
                            IPC (typed events)        IPC (ask, controls)
┌───────────────────────────── Electron main (Node/TS) ─────────────────────────────┐
│                                                                                   │
│  mic (getUserMedia)──┐                                                            │
│                      ├─► AudioRouter ─► RealtimeSTT ×2 ─► TranscriptStore         │
│  loopback (system)───┘    (PCM16)      (OpenAI WS)         (utterances,           │
│                                             │               rolling summary)      │
│        [--replay fixture injects here ──────┘                    │                │
│                                                                  ▼                │
│                                                    Triage (mini model, JSON)      │
│                                                     │ skip │ zh-gist │ FIRE       │
│                                                     ▼               ▼             │
│                                            zh line → UI      ContextRouter       │
│                                                            ┌────────┴────────┐   │
│                                                    transcript ctx      Retriever  │
│                                                    (rolling window+   (hybrid:   │
│                                                     summary)           FTS5+vec) │
│                                                            └────────┬────────┘   │
│                                                                     ▼            │
│                                                     Copilot generate (streaming, │
│                                                      strict JSON schema)         │
│                                                                     ▼            │
│                                                     CopilotEvent → UI            │
│                                                                                   │
│  KnowledgeIndexer (folder scan → chunk → embed → SQLite)   LatencyMetrics        │
└───────────────────────────────────────────────────────────────────────────────────┘
```

### Core data model (`src/shared/types.ts`)

```ts
type Channel = 'me' | 'them';

interface Utterance {
  id: string; channel: Channel; text: string;
  startedAt: number; finalizedAt: number; isFinal: boolean;
}

interface TriageResult {
  utteranceId: string;
  importance: 'skip' | 'notable' | 'copilot';   // copilot ⇒ generate
  isQuestionForUser: boolean;
  meaningZh?: string;                            // only when notable/copilot
}

interface CopilotEvent {
  id: string; triggerUtteranceId: string | null;  // null ⇒ manual ask
  meaningZh: string;
  sayThis: string;                                // 1–3 short speakable sentences
  why?: string;
  confidence: 'high' | 'medium' | 'low';
  sources: { file: string; relevance: string }[];
  smartQuestion?: { type: 'clarification'|'decision'|'validation'|'next_step'; text: string };
  conflict?: string;                              // surfaced source conflicts
  latencyMs: Record<string, number>;              // stage timings
}
```

---

## 4. Repository Layout (exact)

```
saythis/
├── package.json                  # electron-vite + electron-builder
├── electron.vite.config.ts
├── tsconfig.json
├── .env.example                  # OPENAI_API_KEY=
├── src/
│   ├── shared/types.ts           # all interfaces above + IPC channel names
│   ├── main/
│   │   ├── index.ts              # app bootstrap, window, IPC wiring
│   │   ├── audio/loopback.ts     # electron-audio-loopback init + mic routing
│   │   ├── audio/replay.ts       # --replay fixture injector (mock mode)
│   │   ├── stt/realtimeStt.ts    # OpenAI Realtime WS session mgmt (×2), reconnect
│   │   ├── transcript/store.ts   # utterance list, rolling window, running summary
│   │   ├── pipeline/triage.ts    # heuristics + mini-model triage
│   │   ├── pipeline/generate.ts  # copilot generation (streaming, strict schema)
│   │   ├── pipeline/prompts.ts   # all prompt templates in one reviewable file
│   │   ├── pipeline/schema.ts    # JSON schemas for triage + copilot outputs
│   │   ├── knowledge/indexer.ts  # scan, ignore rules, chunkers, embed, upsert
│   │   ├── knowledge/chunkers.ts # md/code/csv/ipynb chunk strategies
│   │   ├── knowledge/store.ts    # better-sqlite3 + FTS5 + sqlite-vec
│   │   ├── knowledge/retrieve.ts # hybrid rank: BM25 + cosine + RRF + boosts
│   │   └── metrics/latency.ts    # per-stage timers attached to every event
│   ├── renderer/
│   │   ├── App.tsx               # two-pane layout per spec §12
│   │   ├── components/TranscriptPane.tsx
│   │   ├── components/CopilotCard.tsx   # SAY THIS visually dominant (§13)
│   │   ├── components/AskBar.tsx
│   │   ├── components/SessionSetup.tsx  # project picker, meeting goal, ● LIVE
│   │   └── styles.css            # calm, low-cognitive-load; no animation
│   └── preload/index.ts
├── eval/
│   ├── fixtures/                 # scenario YAMLs (see §9)
│   ├── test-project/             # fake "WISE" repo: README, results CSVs, notes
│   └── run-eval.ts               # replay fixtures through real pipeline, score
└── docs/PLAN.md                  # this document
```

---

## 5. Pipeline & Trigger Logic

1. **Utterance finalized** (`them`) → heuristic gate: drop pure fillers ("yeah", "okay", "mm-hmm"), merge fragments < 1.5 s apart into one triage unit.
2. **Triage call** (mini model, strict JSON). Input: last ~12 utterances + running summary + user's name + meeting goal. Output: `TriageResult`.
   - `skip` → nothing (small talk).
   - `notable` → render `meaningZh` line inline in transcript (the 中文理解 need, spec §3.2). No big-model call.
   - `copilot` (question/task/decision directed at user) → fire generation.
3. **Retrieval**: query = utterance text + triage-resolved referents (triage rewrites "why?" → "why did you use micro F1" using context — this handles spec §15's "Why?" case) → embed + hybrid search → top 6 chunks.
4. **Generation** (streaming): system prompt enforces — 1–3 speakable sentences, simple English, cite only supplied chunks, confidence rules (spec §8), conflict surfacing (spec §7), at most one smart question and only if a real information gap exists (spec §9–10). `sayThis` streams into the UI token-by-token so the user starts reading before completion.
5. **Rolling context**: verbatim window of last ~30 utterances + a running summary (topics, decisions, open tasks) refreshed by the mini model every ~20 finalized utterances. The summary also feeds the P1 post-meeting output for free.
6. **Manual Ask**: AskBar input (Chinese or English) → same retrieval + generation path with `triggerUtteranceId: null`.

### Latency budget (spec §24) — target ≤ 3.5 s utterance-end → SAY THIS visible

| Stage | Budget |
|---|---|
| STT finalization (VAD silence + flush) | ~700 ms |
| Triage (mini, JSON) | ~600 ms |
| Embed + hybrid retrieval (local) | ~250 ms |
| Generation first token | ~1000 ms |
| Render | ~50 ms |
| **First useful text visible** | **~2.6 s** |

Every `CopilotEvent` carries `latencyMs` per stage; dev mode shows it in the status bar. Instrumented from day one.

---

## 6. Knowledge Indexing & Retrieval Design

**Indexing** (on folder select, then chokidar watch for changes):

- Default ignores: `.git`, `node_modules`, `dist`, `build`, `__pycache__`, `.venv`, `*.env*`, `*key*`, `*secret*`, `*.pem`, binaries, files > 1 MB (spec §26). `.gitignore` is respected if present.
- Chunkers by type: **md/txt** → heading-based (~500 tokens, heading path retained); **code** (`.py/.js/.ts`) → top-level def/class blocks via lightweight regex splitting (no tree-sitter in MVP), path + symbol name retained; **csv** → structured profile per file (columns, row count, numeric min/max/mean, first ~20 rows rendered as aligned text — never blind text-chunking, spec §22) plus full content if < 50 rows; **ipynb** → markdown + code cells, outputs truncated; **json** → pretty-printed, top-level-key chunks; **pdf** → deferred to P1 (parsing quality rabbit hole).
- Each chunk stores: relative path, heading/symbol, mtime, text, embedding.

**Retrieval** (hybrid, spec §23):

- FTS5 BM25 (exact lexical: "Idea 12", "v3", "max_workers") + sqlite-vec cosine → merged via reciprocal rank fusion → boosts: recency (mtime), filename match, doc-type prior (meeting notes/README/results > deep code), current-topic overlap with rolling summary.
- Quoted-entity guarantee: tokens matching `Idea \d+`, version tags, metric names must lexically match or the chunk's fused score is penalized.
- Conflict pass: if two retrieved chunks give different values for the same entity+metric, both are passed to generation flagged `possible_conflict`, and the prompt requires surfacing it with recency ordering.

---

## 7. Open-Source / Off-the-Shelf Reuse

**Reuse (commodity infra):** [`electron-audio-loopback`](https://github.com/alectrocute/electron-audio-loopback) (macOS 12.3+ system loopback — the key enabler); `electron-vite` + `electron-builder` (scaffold/build); OpenAI [Realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription) (streaming STT); OpenAI structured outputs (schema enforcement); `better-sqlite3` + FTS5 + `sqlite-vec` (hybrid RAG store); `chokidar` (file watching); React + Tailwind (UI).

**Examined, not adopted:** Meetily (local Whisper stack — conflicts with cloud-STT decision, heavy); Vexa (bot-joins-meeting server architecture — wrong form factor); Natively-style assistants (closed/product-shaped, nothing extractable). Verdict per spec §20: reuse commodity pieces, hand-build the differentiated intelligence layer (triage, context router, grounded generation, smart questions) — that layer is ~5 files and is the product.

---

## 8. Implementation Sequence

**Milestone A — Vertical slice** (spec Phase 2; mock-audio first, real audio last):

1. Scaffold `electron-vite` app; typed IPC; empty two-pane UI; `.env` key loading.
2. `TranscriptStore` + `--replay` fixture injector → scripted utterances appear in TranscriptPane.
3. Triage pipeline (heuristics + mini model, strict JSON) → `notable` zh lines render inline.
4. Knowledge store + indexer (md/txt/csv first) over `eval/test-project`; CLI smoke test for retrieval.
5. Generation path with strict schema + streaming → CopilotCard renders SAY THIS / 中文 / WHY / SOURCE.
6. Wire real audio: `electron-audio-loopback` + mic → dual Realtime STT sessions. **User-on-Mac checkpoint**: run against a real YouTube video / test Zoom call.
7. Latency instrumentation across all stages.
   → **Slice done when:** a replayed fixture AND a live meeting both produce a grounded suggestion citing test-project files in < 4 s.

**Milestone B — Reliability** (spec Phase 3): 8. Eval harness + 9 fixture scenarios (see §9), run in CI/cloud. 9. Confidence states + LOW-confidence safe-response behavior. 10. Conflict detection pass. 11. Smart-question gap logic tuning against fixtures. 12. Manual AskBar. 13. Rolling summary + referent rewriting ("why?" case). 14. Code/ipynb/json chunkers; chokidar re-indexing.

**Milestone C — Polish** (spec Phase 4): 15. Session setup screen (project picker, meeting goal, ● LIVE indicator, explicit start/stop). 16. Answer style buttons (Simpler / Shorter / More professional — re-prompt on existing event, cheap). 17. Post-meeting summary (from rolling summary — nearly free). 18. Keyboard shortcuts; `electron-builder` signed DMG.

**Division of labor:** I build everything in the cloud workspace and keep it fully testable via replay mode + eval harness; you pull the repo on your Mac only at steps 6, 15, 18 checkpoints to verify live audio and packaging.

---

## 9. Evaluation Harness (spec §28)

`eval/run-eval.ts` replays YAML fixtures through the **real** pipeline (real LLM calls, mock STT) against `eval/test-project` and scores results. Fixture format:

```yaml
name: direct-technical-question
transcript:
  - {channel: them, speaker: David, text: "Why did you use micro F1 here?"}
expect:
  triage: copilot
  is_question_for_user: true
  sources_include_any: [evaluation_plan.md, results]
  say_this: {max_sentences: 3, must_be_speakable: true}
  confidence: high
```

Nine scenarios (per spec): direct technical question; vague "why?" follow-up; number retrieval ("what's Idea 12's F1?"); conflicting result files; info-not-present (must go LOW confidence, no invented numbers — asserted by string-checking against known-absent facts + LLM-judge); next-step request; small talk (must `skip`); question already answered earlier in meeting; ambiguous project term. Scoring: hard assertions where possible, mini-model judge for "speakable/useful", latency recorded per stage. Target gates: detection > 90%, retrieval relevance > 90%, zero unsupported factual claims on the not-present scenario.

---

## 10. Major Risks & Mitigations

1. **macOS loopback fragility** — `electron-audio-loopback` depends on Electron/ScreenCaptureKit behavior that macOS updates have broken before (see electron#49607). *Mitigation:* pin Electron version; Swift CLI helper as documented Plan B; mic-only degraded mode always works.
2. **Screen-recording permission UX** — loopback capture requires the Screen Recording permission; first-run must explain why or users will deny it. *Mitigation:* explicit permission walkthrough in SessionSetup.
3. **Realtime STT cost** — two continuous sessions ≈ order of $0.4–0.8/meeting-hour (verify current pricing at build time). *Mitigation:* VAD-gated `me` channel; `gpt-4o-mini-transcribe` knob.
4. **Triage precision** — false negatives (missed questions) hurt most. *Mitigation:* the two-channel design + name matching + eval fixtures; bias triage toward firing (a spurious suggestion is cheaper than a missed one).
5. **Hallucinated numbers under pressure** — *Mitigation:* strict schema, cite-only-supplied-chunks rule, LOW-confidence safe response, not-present eval scenario as a release gate.
6. **Latency creep** — *Mitigation:* per-stage budget table enforced by instrumentation from step 7, streaming everywhere.
7. **Cloud/Mac dev split** — audio bugs only reproduce on your Mac. *Mitigation:* replay mode keeps 90% of the system testable headless; audio layer is deliberately thin.

---

## 11. MVP Definition of Done

The MVP is complete when, on a real Zoom/Meet call on your Mac with a real project folder selected:

1. Live English transcript renders with `me`/`them` attribution, partials < 1.5 s behind speech.
2. Important utterances get concise 中文理解 lines; small talk stays silent.
3. A question directed at you produces a CopilotCard — SAY THIS (1–3 speakable sentences) + 中文 meaning + WHY + clickable source files — first text visible ≤ 4 s after the utterance ends.
4. Answers about project facts cite real files; the not-present scenario yields a LOW-confidence safe response, never an invented number.
5. At most one smart question appears, only when a genuine gap exists.
6. Manual AskBar answers Chinese or English questions using transcript + project context.
7. All nine eval fixtures pass their gates in a headless run.
8. Listening starts/stops only on explicit user action, with a clearly visible LIVE indicator; ignored-file rules verified against a fixture containing a fake `.env`.

P1 (confidence badge UI polish, style buttons, post-meeting summary, meeting history) begins only after all eight hold.
