import type { EvidenceItem } from '../types.js';
import { KnowledgeStore } from './store.js';
import type { LlmProvider } from '../provider/llm.js';

const DOCTYPE_BOOST: [RegExp, number][] = [
  [/meeting_notes|meeting-notes/i, 0.028],
  [/readme/i, 0.022],
  [/results?/i, 0.022],
  [/docs?\//i, 0.020],
  [/experiments?/i, 0.020],
];

/** Entities that must match lexically: "Idea 12", "v3", "max_workers", "F1", numbers. */
export function extractEntities(query: string): string[] {
  const out = new Set<string>();
  for (const m of query.matchAll(/\b(?:idea|trial|version|run|seed)\s*#?\d+\b/gi)) out.add(m[0].toLowerCase());
  for (const m of query.matchAll(/\bv\d+(?:\.\d+)*\b/gi)) out.add(m[0].toLowerCase());
  for (const m of query.matchAll(/\b[a-z]+_[a-z_0-9]+\b/gi)) out.add(m[0].toLowerCase());
  for (const m of query.matchAll(/\b[a-z]+\d+\b/gi)) out.add(m[0].toLowerCase()); // f1, gpt4 ...
  return [...out];
}

export async function retrieveFiles(
  store: KnowledgeStore,
  provider: LlmProvider,
  query: string,
  topK = 6
): Promise<EvidenceItem[]> {
  if (store.count() === 0) return [];
  const [qEmb] = await provider.embed([query]);
  const fts = store.ftsSearch(query, 20);
  const vec = store.vecSearch(qEmb, 20);

  // Reciprocal rank fusion
  const K = 60;
  const fused = new Map<number, number>();
  fts.forEach((r, i) => fused.set(r.id, (fused.get(r.id) ?? 0) + 1 / (K + i + 1)));
  vec.forEach((r, i) => fused.set(r.id, (fused.get(r.id) ?? 0) + 1 / (K + i + 1)));
  if (fused.size === 0) return [];

  const ids = [...fused.keys()];
  const chunks = store.getChunks(ids);
  const entities = extractEntities(query);
  const mtimes = chunks.map((c) => c.mtime);
  const mtMin = Math.min(...mtimes), mtMax = Math.max(...mtimes);

  const scored = chunks.map((c) => {
    let score = fused.get(c.id!) ?? 0;
    const hay = `${c.path} ${c.heading} ${c.text}`.toLowerCase();
    // exact-entity guarantee: penalize chunks missing queried entities, boost hits
    for (const e of entities) score *= hay.includes(e) ? 1.35 : 0.55;
    // filename token match
    const qTokens = query.toLowerCase().split(/\W+/).filter((t) => t.length > 3);
    if (qTokens.some((t) => c.path.toLowerCase().includes(t))) score += 0.004;
    // doc-type prior
    for (const [re, b] of DOCTYPE_BOOST) if (re.test(c.path)) { score += b * 0.15; break; }
    // recency (mtime), small
    if (mtMax > mtMin) score += 0.002 * ((c.mtime - mtMin) / (mtMax - mtMin));
    // version recency: prefer higher vN in path when versions exist
    const vm = /v(\d+)/i.exec(c.path);
    if (vm) score += 0.0015 * Number(vm[1]);
    return { c, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map(({ c, score }, i) => ({
    id: `F${i + 1}`,
    kind: 'file' as const,
    file: c.path,
    heading: c.heading,
    text: c.text,
    score,
    mtime: c.mtime,
  }));
}

/** Detect numeric disagreement between retrieved file chunks for the same entity. */
export function detectNumericConflict(items: EvidenceItem[], query: string): string | undefined {
  const entities = extractEntities(query).filter((e) => /^(idea|trial|version|run|seed)/.test(e));
  if (entities.length === 0) return undefined;
  const findings: Record<string, Map<string, string>> = {};
  for (const it of items.filter((i) => i.kind === 'file')) {
    for (const e of entities) {
      const lines = it.text.toLowerCase().split('\n').filter((l) => l.includes(e));
      for (const line of lines) {
        const nums = line.match(/0\.\d{2,3}/g);
        if (nums?.length) {
          findings[e] ??= new Map();
          if (!findings[e].has(it.file!)) findings[e].set(it.file!, nums[0]);
        }
      }
    }
  }
  for (const [e, byFile] of Object.entries(findings)) {
    const vals = new Set(byFile.values());
    if (vals.size > 1) {
      const detail = [...byFile.entries()].map(([f, v]) => `${f}: ${v}`).join('; ');
      return `Sources disagree on "${e}": ${detail}`;
    }
  }
  return undefined;
}
