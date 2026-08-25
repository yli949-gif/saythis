import type { Utterance, EvidenceItem } from '../types.js';

const WINDOW = 30;

export class TranscriptStore {
  private utterances: Utterance[] = [];
  private nextId = 1;

  add(u: Omit<Utterance, 'id'>): Utterance {
    const full: Utterance = { ...u, id: `u${this.nextId++}` };
    this.utterances.push(full);
    return full;
  }

  all(): Utterance[] {
    return this.utterances;
  }

  /** Rolling window of recent utterances for prompts. */
  recent(n = WINDOW): Utterance[] {
    return this.utterances.slice(-n);
  }

  /** Conversation evidence: recent exchange rendered as one evidence item (priority 1). */
  asEvidence(excludeId?: string, n = 12): EvidenceItem[] {
    const us = this.recent(n).filter((u) => u.id !== excludeId);
    if (us.length === 0) return [];
    const text = us
      .map((u) => `${u.channel === 'me' ? 'USER' : (u.speaker ?? 'Other')}: ${u.text}`)
      .join('\n');
    return [{ id: 'C1', kind: 'conversation', heading: 'current meeting', text, score: 1 }];
  }
}
