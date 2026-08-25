import fs from 'node:fs';
import path from 'node:path';
import type { Chunk } from '../types.js';
import { chunkFile } from './chunkers.js';
import { KnowledgeStore } from './store.js';
import type { LlmProvider } from '../provider/llm.js';

const IGNORE_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', '__pycache__', '.venv', 'venv',
  '.saythis', '.next', 'target', '.cache', 'coverage', '.idea', '.vscode',
]);
const IGNORE_FILE_PATTERNS = [
  /^\.env/i, /\.pem$/i, /\.key$/i, /secret/i, /credential/i, /\.DS_Store$/,
  /\.lock$/, /-lock\.(json|yaml)$/,
];
const TEXT_EXTS = new Set([
  '.md', '.txt', '.rst', '.csv', '.tsv', '.json', '.ipynb',
  '.py', '.js', '.ts', '.tsx', '.jsx', '.java', '.go', '.rs', '.yaml', '.yml', '.toml', '.cfg', '.sh',
]);
const MAX_FILE_BYTES = 1_000_000;

export interface IndexedFile { relPath: string; text: string; mtime: number }

export function scanProject(projectDir: string): IndexedFile[] {
  const files: IndexedFile[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') && entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name)) walk(full);
        continue;
      }
      if (IGNORE_FILE_PATTERNS.some((p) => p.test(entry.name))) continue;
      const ext = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase();
      if (!TEXT_EXTS.has(ext)) continue;
      const stat = fs.statSync(full);
      if (stat.size > MAX_FILE_BYTES) continue;
      files.push({
        relPath: path.relative(projectDir, full),
        text: fs.readFileSync(full, 'utf8'),
        mtime: stat.mtimeMs,
      });
    }
  };
  walk(projectDir);
  return files;
}

export async function indexProject(
  projectDir: string,
  provider: LlmProvider,
  opts: { inMemory?: boolean } = {}
): Promise<KnowledgeStore> {
  const store = new KnowledgeStore(projectDir, opts.inMemory);
  store.clear();
  const files = scanProject(projectDir);
  const chunks: Chunk[] = files.flatMap((f) => chunkFile(f.relPath, f.text, f.mtime));
  // Embed heading-prefixed text for better semantic anchoring.
  const embeddings = await provider.embed(chunks.map((c) => `${c.path} ${c.heading}\n${c.text}`.slice(0, 4000)));
  store.insertChunks(chunks, embeddings);
  return store;
}
