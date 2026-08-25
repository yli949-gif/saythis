import type { LlmProvider, TriageInput, GenerateInput, GenOut } from './llm.js';
import type { ProjectMemory, TriageResult } from '../types.js';
import { TRIAGE_SCHEMA, GEN_SCHEMA, MEMORY_SCHEMA } from '../pipeline/schema.js';
import { triageSystem, triageUser, genSystem, genUser, memorySystem, memoryUser } from '../pipeline/prompts.js';

const API = 'https://api.openai.com/v1';

export class OpenAIProvider implements LlmProvider {
  readonly name = 'openai';
  private triageModel = process.env.SAYTHIS_TRIAGE_MODEL ?? 'gpt-4o-mini';
  private genModel = process.env.SAYTHIS_GEN_MODEL ?? 'gpt-4o';
  private embedModel = process.env.SAYTHIS_EMBED_MODEL ?? 'text-embedding-3-small';

  constructor(private key: string) {}

  private async chatJson<T>(
    model: string,
    system: string,
    user: string,
    schema: object,
    maxTokens = 700,
    retries = 2
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${API}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.key}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          response_format: { type: 'json_schema', json_schema: schema },
          max_tokens: maxTokens,
          temperature: 0.2,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        if (attempt < retries && (res.status === 429 || res.status >= 500)) {
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
          continue;
        }
        throw new Error(`OpenAI ${res.status}: ${body.slice(0, 400)}`);
      }
      const data = (await res.json()) as any;
      const content = data.choices?.[0]?.message?.content;
      try {
        return JSON.parse(content) as T;
      } catch (e) {
        if (attempt < retries) continue;
        throw new Error(`Bad JSON from model: ${String(content).slice(0, 200)}`);
      }
    }
  }

  async triage(input: TriageInput): Promise<Omit<TriageResult, 'utteranceId'>> {
    const raw = await this.chatJson<{
      importance: 'skip' | 'notable' | 'copilot';
      isQuestionForUser: boolean;
      meaningZh: string | null;
      resolvedQuery: string | null;
    }>(this.triageModel, triageSystem(input.config), triageUser(input.recent, input.last), TRIAGE_SCHEMA, 300);
    return {
      importance: raw.importance,
      isQuestionForUser: raw.isQuestionForUser,
      meaningZh: raw.meaningZh ?? undefined,
      resolvedQuery: raw.resolvedQuery ?? undefined,
    };
  }

  async generate(input: GenerateInput): Promise<GenOut> {
    const raw = await this.chatJson<any>(
      this.genModel,
      genSystem(input.config),
      genUser(input.query, input.recent, input.evidence, { manual: input.manual, conflictHint: input.conflictHint }),
      GEN_SCHEMA,
      700
    );
    return {
      meaningZh: raw.meaningZh,
      sayThis: raw.sayThis,
      why: raw.why ?? undefined,
      confidence: raw.confidence,
      sourceIds: raw.sourceIds ?? [],
      conflict: raw.conflict ?? undefined,
      smartQuestion: raw.smartQuestion ?? undefined,
    };
  }

  async buildMemory(userName: string, docs: { relPath: string; text: string }[]): Promise<ProjectMemory> {
    const raw = await this.chatJson<any>(
      this.genModel, memorySystem(), memoryUser(userName, docs), MEMORY_SCHEMA, 6000
    );
    return { ...raw, projectGoal: raw.projectGoal ?? undefined };
  }

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 100) {
      const batch = texts.slice(i, i + 100);
      const res = await fetch(`${API}/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.key}` },
        body: JSON.stringify({ model: this.embedModel, input: batch }),
      });
      if (!res.ok) throw new Error(`OpenAI embeddings ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = (await res.json()) as any;
      for (const d of data.data) out.push(d.embedding);
    }
    return out;
  }
}
