import type { LlmProvider, TriageInput, GenerateInput, GenOut } from './llm.js';
import type { ProjectMemory, TriageResult, MemoryItem } from '../types.js';
import { extractEntities } from '../knowledge/retrieve.js';

const FILLERS = /^(yeah|yes|no|ok(ay)?|right|sure|mm+|uh+|hm+|got it|sounds good|thanks?|thank you|cool|great)[.!\s]*$/i;
const SMALL_TALK = /\b(weekend|weather|lunch|coffee|vacation|holiday|how are you|how's it going|nice day)\b/i;
const INTERROGATIVE = /^(why|what|how|when|where|who|which|can|could|should|would|do|does|did|is|are|will|have|has)\b/i;

/**
 * Deterministic, offline provider. Validates pipeline mechanics (routing, retrieval,
 * grounding discipline, latency plumbing) — NOT language quality. All text outputs
 * are tagged [mock].
 */
export class MockProvider implements LlmProvider {
  readonly name = 'mock';

  async triage(input: TriageInput): Promise<Omit<TriageResult, 'utteranceId'>> {
    const text = input.last.text.trim();
    if (FILLERS.test(text) || SMALL_TALK.test(text)) {
      return { importance: 'skip', isQuestionForUser: false };
    }
    const mentionsUser = new RegExp(`\\b${input.config.userName}\\b`, 'i').test(text);
    const secondPerson = /\byou(r)?\b/i.test(text);
    const isQ = /\?/.test(text) || INTERROGATIVE.test(text);
    if (isQ || (mentionsUser && /\b(rerun|run|update|report|check|send|share)\b/i.test(text))) {
      // resolve short follow-ups against the previous meaningful utterance
      let resolved = text;
      if (text.split(/\s+/).length <= 3) {
        const prev = [...input.recent].reverse().find((u) => u.id !== input.last.id && !FILLERS.test(u.text));
        if (prev) resolved = `${text} (referring to: ${prev.text})`;
      }
      return {
        importance: 'copilot',
        isQuestionForUser: isQ ? (secondPerson || mentionsUser || true) : true,
        meaningZh: `[mock] 对方在问：${text}`,
        resolvedQuery: resolved,
      };
    }
    if (/\b(decided?|deadline|must|important|f1|result|trial|metric)\b/i.test(text)) {
      return { importance: 'notable', isQuestionForUser: false, meaningZh: `[mock] 重要信息：${text}` };
    }
    return { importance: 'skip', isQuestionForUser: false };
  }

  async generate(input: GenerateInput): Promise<GenOut> {
    const grounded = input.evidence.filter((e) => e.kind !== 'conversation');
    const entities = extractEntities(input.query);
    // find the evidence line matching the MOST queried entities (number lookups)
    let factLine: { ev: typeof grounded[number]; line: string; hits: number } | undefined;
    for (const ev of grounded) {
      for (const line of ev.text.split('\n')) {
        const l = line.toLowerCase();
        const hits = entities.filter((e) => l.includes(e)).length;
        if (hits >= 1 && /\d/.test(line) && hits > (factLine?.hits ?? 0)) {
          factLine = { ev, line: line.trim().slice(0, 160), hits };
        }
      }
    }
    const strong = grounded.length > 0 && (factLine || grounded[0].score > 0.01);
    if (!strong) {
      return {
        meaningZh: `[mock] 他们在问：${input.query}`,
        sayThis: "I'm not completely sure about that. Let me double-check after the meeting and follow up.",
        confidence: 'low',
        sourceIds: [],
        conflict: input.conflictHint,
        why: '[mock] No supporting evidence found in project files.',
      };
    }
    // Always cite file evidence for traceability; add the fact's own item and one memory item.
    const files = grounded.filter((e) => e.kind === 'file');
    const mems = grounded.filter((e) => e.kind === 'memory');
    const top = [...new Set([
      ...(factLine ? [factLine.ev] : []),
      ...files.slice(0, 2),
      ...mems.slice(0, 1),
    ])].slice(0, 4);
    const sayThis = factLine
      ? `[mock] Based on ${factLine.ev.file}, the relevant entry is: ${factLine.line}. I can share more detail after the meeting.`
      : `[mock] Based on ${top[0].file}: ${top[0].text.split('\n').find((l) => l.trim())?.slice(0, 120)}.`;
    return {
      meaningZh: `[mock] 他们在问：${input.query}`,
      sayThis,
      why: `[mock] grounded in ${top.map((t) => t.file).join(', ')}`,
      confidence: input.conflictHint ? 'medium' : 'high',
      sourceIds: top.map((t) => t.id),
      conflict: input.conflictHint,
    };
  }

  async buildMemory(userName: string, docs: { relPath: string; text: string }[]): Promise<ProjectMemory> {
    const mem: ProjectMemory = {
      myResponsibilities: [], currentTasks: [], decisions: [], completedWork: [],
      openQuestions: [], keyFacts: [], latestResults: [],
    };
    const item = (text: string, src: string): MemoryItem => ({ text: text.trim(), sources: [src] });
    for (const d of docs) {
      const lines = d.text.split('\n');
      let section = '';
      for (const line of lines) {
        const h = /^#{1,4}\s+(.*)/.exec(line);
        if (h) { section = h[1].toLowerCase(); continue; }
        const bold = /^\*\*(.+?):?\*\*\s*$/.exec(line.trim());
        if (bold) { section = bold[1].toLowerCase(); continue; }
        const t = line.replace(/^[-*\d.]+\s*/, '').trim();
        if (!t) continue;
        if (/readme/i.test(d.relPath) && !mem.projectGoal && /goal/.test(section)) mem.projectGoal = t;
        if (new RegExp(`\\*\\*${userName}\\*\\*|^${userName}\\b`, 'i').test(t) && /owns|to run|run the/i.test(t))
          mem.myResponsibilities.push(item(t.replace(/\*\*/g, ''), d.relPath));
        if (/decision/.test(section) && /^[-*\d]/.test(line.trim())) mem.decisions.push(item(t, d.relPath));
        if (/completed/.test(section)) mem.completedWork.push(item(t, d.relPath));
        if (/not done|action item/.test(section)) mem.currentTasks.push(item(t, d.relPath));
        if (/open question/.test(section)) mem.openQuestions.push(item(t, d.relPath));
        if (/known weak|terminolog/.test(section)) mem.keyFacts.push(item(t, d.relPath));
        if (/v3 run/.test(section) && /f1|idea/i.test(t)) mem.latestResults.push(item(t, d.relPath));
      }
    }
    const dedupe = (arr: MemoryItem[]) => [...new Map(arr.map((x) => [x.text, x])).values()];
    mem.currentTasks = dedupe(mem.currentTasks);
    mem.myResponsibilities = dedupe(mem.myResponsibilities);
    return mem;
  }

  /** Deterministic hashed bag-of-words embedding (256-dim), L2-normalized. */
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => {
      const v = new Array(256).fill(0);
      for (const tok of t.toLowerCase().split(/\W+/).filter((x) => x.length > 1)) {
        let h = 2166136261;
        for (let i = 0; i < tok.length; i++) { h ^= tok.charCodeAt(i); h = Math.imul(h, 16777619); }
        v[(h >>> 0) % 256] += 1;
      }
      const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
      return v.map((x) => x / norm);
    });
  }
}
