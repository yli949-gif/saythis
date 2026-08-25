# SayThis — meeting copilot, Milestone A1 (intelligence slice)

No audio yet, by design. This slice proves: **meeting question → context understanding →
project retrieval → grounded 1–3 sentence answer + 中文理解 + sources + latency.**

## Setup

```bash
npm install
cp .env.example .env   # put your OPENAI_API_KEY in .env (omit to use --mock)
```

## Commands

```bash
# Full evaluation (10 fixtures = the A1 definition of done)
npm run eval                 # real OpenAI provider
npm run eval -- --mock       # offline plumbing check (language-quality checks skipped)

# Replay one scripted meeting and watch the copilot respond
npm run replay -- eval/fixtures/01-direct-question.yaml

# Interactive: type questions, or feed transcript lines with "them: ..." / "me: ..."
npm run ask -- --project eval/test-project

# (Re)index a project folder + rebuild Project Memory
npm run index -- --project /path/to/your/project
```

Per-project state lives in `<project>/.saythis/`: `index.db` (FTS5 + sqlite-vec hybrid
index) and `project-memory.json` (inspectable Project Memory with per-fact sources).

## Architecture (A1)

```
utterance ─ triage (mini model, strict JSON: skip / notable(中文) / copilot + resolvedQuery)
              └─ copilot → evidence in priority order:
                   1 conversation window   2 ProjectMemory   3 lexical FTS5   4 semantic vec
                 → numeric-conflict pre-check
                 → generate (strict JSON: sayThis ≤3 sentences, confidence, sourceIds, conflict, smartQuestion)
                 → CopilotEvent + per-stage latency
```

Models (env-overridable): `SAYTHIS_TRIAGE_MODEL` (default gpt-4o-mini),
`SAYTHIS_GEN_MODEL` (default gpt-4o), `SAYTHIS_EMBED_MODEL` (default text-embedding-3-small).

Next milestones: A2 live transcription (OpenAI Realtime), A3 dual-channel mic/system
audio (Electron), B smart questions/memory/confidence refinements. See `docs/PLAN.md`.
