import type {
  Utterance, TriageResult, CopilotEvent, EvidenceItem, SessionConfig, ProjectMemory, SourceRef,
} from '../types.js';
import type { LlmProvider } from '../provider/llm.js';
import { TranscriptStore } from '../transcript/store.js';
import { KnowledgeStore } from '../knowledge/store.js';
import { retrieveFiles, detectNumericConflict } from '../knowledge/retrieve.js';
import { retrieveFromMemory } from '../memory/projectMemory.js';
import { StageTimer } from '../metrics/latency.js';

const FILLER = /^(yeah|yes|no|ok(ay)?|right|sure|mm+|uh+|hm+|got it|sounds good|thanks?|thank you|cool|great)[.!\s]*$/i;

export interface PipelineOutput {
  utterance: Utterance;
  triage?: TriageResult;
  event?: CopilotEvent;
}

export class CopilotPipeline {
  private transcript = new TranscriptStore();
  private nextEventId = 1;

  constructor(
    private provider: LlmProvider,
    private store: KnowledgeStore,
    private memory: ProjectMemory | null,
    private config: SessionConfig
  ) {}

  getTranscript(): TranscriptStore {
    return this.transcript;
  }

  /** Feed one finalized utterance through triage → (maybe) evidence → generation. */
  async onUtterance(u: Omit<Utterance, 'id'>): Promise<PipelineOutput> {
    const utterance = this.transcript.add(u);
    // The user's own speech is context, not a trigger.
    if (utterance.channel === 'me') return { utterance };

    const timer = new StageTimer();
    // Heuristic pre-filter: obvious fillers never cost an LLM call.
    if (FILLER.test(utterance.text.trim())) {
      return {
        utterance,
        triage: { utteranceId: utterance.id, importance: 'skip', isQuestionForUser: false },
      };
    }

    const triageRaw = await this.provider.triage({
      last: utterance,
      recent: this.transcript.recent(12),
      config: this.config,
    });
    const triage: TriageResult = { utteranceId: utterance.id, ...triageRaw };
    timer.mark('triage');

    if (triage.importance !== 'copilot') return { utterance, triage };

    const query = triage.resolvedQuery ?? utterance.text;
    const event = await this.answer(query, utterance.id, timer, triage.meaningZh);
    return { utterance, triage, event };
  }

  /** Manual "Ask Copilot..." path — same evidence + generation flow. */
  async ask(question: string): Promise<CopilotEvent> {
    const timer = new StageTimer();
    timer.mark('triage'); // no triage cost on manual path
    return this.answer(question, null, timer, undefined, true);
  }

  private async answer(
    query: string,
    triggerUtteranceId: string | null,
    timer: StageTimer,
    meaningZhHint?: string,
    manual = false
  ): Promise<CopilotEvent> {
    // Evidence in strict priority order: conversation > memory > files (lexical+semantic hybrid).
    const conversation = this.transcript.asEvidence(triggerUtteranceId ?? undefined);
    const memoryEv = retrieveFromMemory(this.memory, query);
    const fileEv = await retrieveFiles(this.store, this.provider, query);
    timer.mark('retrieval');

    const evidence: EvidenceItem[] = [...conversation, ...memoryEv, ...fileEv];
    const conflictHint = detectNumericConflict(fileEv, query);

    const gen = await this.provider.generate({
      query,
      recent: this.transcript.recent(12),
      evidence,
      config: this.config,
      manual,
      conflictHint,
    });
    timer.mark('generate');

    const byId = new Map(evidence.map((e) => [e.id, e]));
    const sources: SourceRef[] = [];
    for (const id of gen.sourceIds) {
      const ev = byId.get(id);
      if (!ev) continue;
      if (ev.kind === 'conversation') {
        sources.push({ file: '(current meeting)', relevance: 'said earlier in this meeting' });
      } else if (ev.kind === 'memory') {
        for (const f of (ev.file ?? '').split(', ').filter(Boolean)) {
          sources.push({ file: f, relevance: `project memory: ${ev.heading?.replace('memory:', '')}` });
        }
      } else {
        sources.push({ file: ev.file!, relevance: ev.heading || 'retrieved match' });
      }
    }
    // dedupe by file
    const seen = new Set<string>();
    const dedupedSources = sources.filter((s) => !seen.has(s.file) && seen.add(s.file));

    return {
      id: `e${this.nextEventId++}`,
      triggerUtteranceId,
      meaningZh: gen.meaningZh || meaningZhHint || '',
      sayThis: gen.sayThis,
      why: gen.why,
      confidence: gen.confidence,
      sources: dedupedSources,
      conflict: gen.conflict ?? conflictHint,
      smartQuestion: gen.smartQuestion,
      latencyMs: timer.report(),
      query,
      evidence: evidence.map((e) => ({
        id: e.id, kind: e.kind, file: e.file, heading: e.heading,
        score: Number(e.score.toFixed(4)), cited: gen.sourceIds.includes(e.id),
      })),
    };
  }
}
