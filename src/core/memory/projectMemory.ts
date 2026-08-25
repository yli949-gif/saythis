import fs from 'node:fs';
import path from 'node:path';
import type { ProjectMemory, MemoryItem, EvidenceItem } from '../types.js';
import type { LlmProvider } from '../provider/llm.js';
import { scanProject } from '../knowledge/indexer.js';

const MEMORY_FILE = 'project-memory.json';
/** High-value docs that feed memory building, in priority order. */
const MEMORY_SOURCES = [/readme/i, /meeting_notes|meeting-notes/i, /experiments?\//i, /docs?\//i, /plan/i, /decision/i];

export async function buildProjectMemory(
  projectDir: string,
  provider: LlmProvider,
  userName: string
): Promise<ProjectMemory> {
  const files = scanProject(projectDir)
    .filter((f) => MEMORY_SOURCES.some((re) => re.test(f.relPath)))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 12)
    .map((f) => ({ relPath: f.relPath, text: f.text.slice(0, 12_000) }));
  const memory = await provider.buildMemory(userName, files);
  const dir = path.join(projectDir, '.saythis');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, MEMORY_FILE), JSON.stringify(memory, null, 2));
  return memory;
}

export function loadProjectMemory(projectDir: string): ProjectMemory | null {
  const p = path.join(projectDir, '.saythis', MEMORY_FILE);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8')) as ProjectMemory;
}

interface Tagged { field: string; item: MemoryItem }

function flatten(mem: ProjectMemory): Tagged[] {
  const out: Tagged[] = [];
  const push = (field: string, items: (MemoryItem | string)[] | undefined) => {
    for (const it of items ?? []) {
      out.push({ field, item: typeof it === 'string' ? { text: it, sources: [] } : it });
    }
  };
  if (mem.projectGoal) push('projectGoal', [mem.projectGoal]);
  push('myResponsibilities', mem.myResponsibilities);
  push('currentTasks', mem.currentTasks);
  push('decisions', mem.decisions);
  push('completedWork', mem.completedWork);
  push('openQuestions', mem.openQuestions);
  push('keyFacts', mem.keyFacts);
  push('latestResults', mem.latestResults);
  return out;
}

/** Priority-2 retrieval: lexical overlap between query and memory items. */
export function retrieveFromMemory(mem: ProjectMemory | null, query: string, topK = 5): EvidenceItem[] {
  if (!mem) return [];
  const qTokens = new Set(query.toLowerCase().split(/\W+/).filter((t) => t.length > 2));
  const scored = flatten(mem)
    .map(({ field, item }) => {
      const tokens = item.text.toLowerCase().split(/\W+/);
      let overlap = tokens.filter((t) => qTokens.has(t)).length;
      // status/progress questions strongly want task/completion fields
      if (/\b(done|finish|status|progress|yet|complete|run)\b/i.test(query) &&
          /currentTasks|completedWork/.test(field)) overlap += 1;
      return { field, item, score: overlap / Math.sqrt(tokens.length + 1) };
    })
    .filter((s) => s.score > 0.15)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
  return scored.map((s, i) => ({
    id: `M${i + 1}`,
    kind: 'memory' as const,
    file: s.item.sources.join(', ') || undefined,
    heading: `memory:${s.field}`,
    text: s.item.text,
    score: s.score,
  }));
}
