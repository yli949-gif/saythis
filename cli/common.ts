import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SessionConfig, ProjectMemory, CopilotEvent } from '../src/core/types.js';
import { getProvider, type LlmProvider } from '../src/core/provider/llm.js';
import { KnowledgeStore } from '../src/core/knowledge/store.js';
import { indexProject } from '../src/core/knowledge/indexer.js';
import { buildProjectMemory, loadProjectMemory } from '../src/core/memory/projectMemory.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Minimal .env loader (repo root), no dependency. */
export function loadEnv(): void {
  const p = path.join(ROOT, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

export interface Session {
  provider: LlmProvider;
  store: KnowledgeStore;
  memory: ProjectMemory | null;
  config: SessionConfig;
}

export async function setupSession(opts: {
  projectDir: string;
  mock: boolean;
  reindex?: boolean;
  userName?: string;
  projectName?: string;
  meetingGoal?: string;
}): Promise<Session> {
  loadEnv();
  const provider = await getProvider(opts.mock);
  const projectDir = path.resolve(opts.projectDir);
  const metaPath = path.join(projectDir, '.saythis', 'meta.json');
  const prevMeta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : null;
  const needIndex = opts.reindex || !prevMeta || prevMeta.provider !== provider.name;

  let store: KnowledgeStore;
  const t0 = performance.now();
  if (needIndex) {
    store = await indexProject(projectDir, provider);
    fs.writeFileSync(metaPath, JSON.stringify({ provider: provider.name, indexedAt: new Date().toISOString() }));
    console.error(`[index] ${store.count()} chunks from ${store.allPaths().length} files in ${Math.round(performance.now() - t0)}ms`);
  } else {
    store = new KnowledgeStore(projectDir);
  }

  let memory = loadProjectMemory(projectDir);
  if (!memory || needIndex) {
    memory = await buildProjectMemory(projectDir, provider, opts.userName ?? 'Ella');
    console.error(`[memory] project memory built (${provider.name}) → .saythis/project-memory.json`);
  }

  const config: SessionConfig = {
    userName: opts.userName ?? 'Ella',
    projectName: opts.projectName ?? path.basename(projectDir),
    meetingGoal: opts.meetingGoal,
    projectDir,
    mock: opts.mock,
  };
  return { provider, store, memory, config };
}

const C = {
  dim: '\x1b[2m', reset: '\x1b[0m', bold: '\x1b[1m', green: '\x1b[32m',
  yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m', magenta: '\x1b[35m',
};

export function renderEvent(e: CopilotEvent): string {
  const conf = e.confidence === 'high' ? C.green : e.confidence === 'medium' ? C.yellow : C.red;
  const lines: string[] = [];
  lines.push(`${C.dim}┌─ COPILOT ─ confidence: ${C.reset}${conf}${e.confidence.toUpperCase()}${C.reset}`);
  if (e.meaningZh) lines.push(`${C.cyan}${C.bold}中文理解${C.reset}  ${e.meaningZh}`);
  lines.push(`${C.bold}${C.magenta}SAY THIS${C.reset}  ${C.bold}"${e.sayThis}"${C.reset}`);
  if (e.why) lines.push(`${C.dim}WHY${C.reset}       ${e.why}`);
  if (e.conflict) lines.push(`${C.yellow}⚠ CONFLICT${C.reset} ${e.conflict}`);
  if (e.sources.length)
    lines.push(`${C.dim}BASED ON${C.reset}  ${e.sources.map((s) => `${s.file} ${C.dim}(${s.relevance})${C.reset}`).join('\n          ')}`);
  if (e.smartQuestion) lines.push(`${C.cyan}ASK${C.reset}       [${e.smartQuestion.type}] "${e.smartQuestion.text}"`);
  const lat = Object.entries(e.latencyMs).map(([k, v]) => `${k}=${v}ms`).join(' ');
  lines.push(`${C.dim}└─ ${lat}${C.reset}`);
  return lines.join('\n');
}
