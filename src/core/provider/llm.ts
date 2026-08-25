import type {
  Utterance, TriageResult, EvidenceItem, SessionConfig, ProjectMemory, Confidence, SmartQuestion,
} from '../types.js';

export interface TriageInput {
  last: Utterance;
  recent: Utterance[];
  config: SessionConfig;
}

export interface GenerateInput {
  query: string;
  recent: Utterance[];
  evidence: EvidenceItem[];
  config: SessionConfig;
  manual?: boolean;
  conflictHint?: string;
}

export interface GenOut {
  meaningZh: string;
  sayThis: string;
  why?: string;
  confidence: Confidence;
  sourceIds: string[];
  conflict?: string;
  smartQuestion?: SmartQuestion;
}

export interface LlmProvider {
  readonly name: string;
  triage(input: TriageInput): Promise<Omit<TriageResult, 'utteranceId'>>;
  generate(input: GenerateInput): Promise<GenOut>;
  buildMemory(userName: string, docs: { relPath: string; text: string }[]): Promise<ProjectMemory>;
  embed(texts: string[]): Promise<number[][]>;
}

export async function getProvider(mock: boolean): Promise<LlmProvider> {
  if (mock) {
    const { MockProvider } = await import('./mock.js');
    return new MockProvider();
  }
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY not set. Use --mock or provide a key.');
  const { OpenAIProvider } = await import('./openai.js');
  return new OpenAIProvider(key);
}
