export type Channel = 'me' | 'them';

export interface Utterance {
  id: string;
  channel: Channel;
  speaker?: string;
  text: string;
  t: number; // ms timestamp (fixture-relative or wall clock)
}

export type Importance = 'skip' | 'notable' | 'copilot';

export interface TriageResult {
  utteranceId: string;
  importance: Importance;
  isQuestionForUser: boolean;
  /** Concise Chinese gist, present when importance != skip */
  meaningZh?: string;
  /** Self-contained rewrite of the utterance (resolves "Why?" etc.) used as retrieval query */
  resolvedQuery?: string;
}

export type EvidenceKind = 'conversation' | 'memory' | 'file';

export interface EvidenceItem {
  id: string; // e.g. E1, E2 — referenced by generation output
  kind: EvidenceKind;
  file?: string; // relative path for kind=file, or memory source files joined
  heading?: string; // heading path / memory field / speaker
  text: string;
  score: number;
  mtime?: number;
}

export type Confidence = 'high' | 'medium' | 'low';

export interface SourceRef {
  file: string;
  relevance: string;
}

export interface SmartQuestion {
  type: 'clarification' | 'decision' | 'validation' | 'next_step';
  text: string;
}

export interface CopilotEvent {
  id: string;
  triggerUtteranceId: string | null; // null => manual ask
  meaningZh: string;
  sayThis: string; // 1–3 short speakable sentences
  why?: string;
  confidence: Confidence;
  sources: SourceRef[];
  conflict?: string; // surfaced evidence conflict, if any
  smartQuestion?: SmartQuestion;
  latencyMs: Record<string, number>;
  /** Debug/eval instrumentation: ranked evidence that was offered to generation. */
  evidence?: { id: string; kind: EvidenceKind; file?: string; heading?: string; score: number; cited: boolean }[];
  /** The query actually used for retrieval (triage resolvedQuery or raw text). */
  query?: string;
}

export interface MemoryItem {
  text: string;
  sources: string[]; // relative file paths this fact was derived from
}

export interface ProjectMemory {
  projectGoal?: string;
  myResponsibilities: MemoryItem[];
  currentTasks: MemoryItem[];
  decisions: MemoryItem[];
  completedWork: MemoryItem[];
  openQuestions: MemoryItem[];
  keyFacts: MemoryItem[];
  latestResults: MemoryItem[];
}

export interface SessionConfig {
  userName: string; // how the user is addressed in meetings
  projectName?: string;
  meetingGoal?: string;
  projectDir: string;
  mock: boolean;
}

export interface Chunk {
  id?: number;
  path: string;
  heading: string;
  mtime: number;
  text: string;
}
