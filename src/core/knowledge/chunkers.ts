import type { Chunk } from '../types.js';

const MAX_CHUNK_CHARS = 2000; // ~500 tokens

function fixedSplit(text: string, path: string, mtime: number, heading = ''): Chunk[] {
  const chunks: Chunk[] = [];
  for (let i = 0; i < text.length; i += MAX_CHUNK_CHARS) {
    const piece = text.slice(i, i + MAX_CHUNK_CHARS + 200); // slight overlap
    if (piece.trim()) chunks.push({ path, heading, mtime, text: piece.trim() });
  }
  return chunks;
}

/** Markdown / txt: split on headings, keep heading path; oversize sections fixed-split. */
export function chunkMarkdown(text: string, path: string, mtime: number): Chunk[] {
  const lines = text.split('\n');
  const sections: { heading: string; body: string[] }[] = [{ heading: '', body: [] }];
  const stack: string[] = [];
  for (const line of lines) {
    const m = /^(#{1,4})\s+(.*)$/.exec(line);
    if (m) {
      const level = m[1].length;
      stack.length = level - 1;
      stack[level - 1] = m[2].trim();
      sections.push({ heading: stack.filter(Boolean).join(' > '), body: [line] });
    } else {
      sections[sections.length - 1].body.push(line);
    }
  }
  const out: Chunk[] = [];
  for (const s of sections) {
    const body = s.body.join('\n').trim();
    if (!body) continue;
    if (body.length <= MAX_CHUNK_CHARS) out.push({ path, heading: s.heading, mtime, text: body });
    else out.push(...fixedSplit(body, path, mtime, s.heading));
  }
  return out;
}

/** Code: split on top-level def/class/function boundaries; fallback fixed-size. */
export function chunkCode(text: string, path: string, mtime: number): Chunk[] {
  const boundary = /^(def |class |function |export |const [A-Z_]|async function |public |private )/;
  const lines = text.split('\n');
  const blocks: { name: string; body: string[] }[] = [{ name: '', body: [] }];
  for (const line of lines) {
    if (boundary.test(line)) {
      const name = line.replace(/[({:].*$/, '').trim().slice(0, 80);
      blocks.push({ name, body: [line] });
    } else {
      blocks[blocks.length - 1].body.push(line);
    }
  }
  // merge tiny blocks forward so we don't get one chunk per one-liner
  const out: Chunk[] = [];
  let acc: string[] = [];
  let accName = '';
  for (const b of blocks) {
    const body = b.body.join('\n');
    if (!body.trim()) continue;
    if (!accName) accName = b.name;
    acc.push(body);
    const joined = acc.join('\n');
    if (joined.length > MAX_CHUNK_CHARS / 2) {
      out.push(...(joined.length <= MAX_CHUNK_CHARS
        ? [{ path, heading: accName, mtime, text: joined.trim() }]
        : fixedSplit(joined, path, mtime, accName)));
      acc = []; accName = '';
    }
  }
  if (acc.join('\n').trim()) out.push({ path, heading: accName, mtime, text: acc.join('\n').trim() });
  return out;
}

/** CSV: structured profile (columns, stats) + full table when small — never blind text chunks. */
export function chunkCsv(text: string, path: string, mtime: number): Chunk[] {
  const rows = text.trim().split('\n').map((r) => r.split(',').map((c) => c.trim()));
  if (rows.length < 2) return [{ path, heading: 'csv', mtime, text }];
  const header = rows[0];
  const data = rows.slice(1);
  const stats: string[] = [];
  for (let c = 0; c < header.length; c++) {
    const vals = data.map((r) => Number(r[c])).filter((v) => Number.isFinite(v));
    if (vals.length >= data.length / 2 && vals.length > 0) {
      const min = Math.min(...vals), max = Math.max(...vals);
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      stats.push(`${header[c]}: numeric, min=${min}, max=${max}, mean=${mean.toFixed(3)}`);
    } else {
      stats.push(`${header[c]}: text, e.g. ${data.slice(0, 3).map((r) => r[c]).join('; ')}`);
    }
  }
  const profile = `CSV file ${path}\nRows: ${data.length}\nColumns:\n${stats.join('\n')}`;
  const shown = data.length <= 60 ? data : data.slice(0, 25);
  const table = [header, ...shown].map((r) => r.join(' | ')).join('\n')
    + (shown.length < data.length ? `\n... (${data.length - shown.length} more rows)` : '');
  // Row chunks keep exact lexical entities ("Idea 12") findable with their values.
  return [
    { path, heading: 'profile', mtime, text: profile },
    ...fixedSplit(table, path, mtime, 'rows'),
  ];
}

export function chunkJson(text: string, path: string, mtime: number): Chunk[] {
  try {
    const obj = JSON.parse(text);
    const pretty = JSON.stringify(obj, null, 2);
    if (pretty.length <= MAX_CHUNK_CHARS) return [{ path, heading: 'json', mtime, text: pretty }];
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      return Object.entries(obj).map(([k, v]) => ({
        path, heading: k, mtime, text: `"${k}": ${JSON.stringify(v, null, 2)}`.slice(0, MAX_CHUNK_CHARS),
      }));
    }
    return fixedSplit(pretty, path, mtime, 'json');
  } catch {
    return fixedSplit(text, path, mtime, 'json');
  }
}

export function chunkIpynb(text: string, path: string, mtime: number): Chunk[] {
  try {
    const nb = JSON.parse(text);
    const cells: Chunk[] = [];
    for (let i = 0; i < (nb.cells ?? []).length; i++) {
      const cell = nb.cells[i];
      const src = (Array.isArray(cell.source) ? cell.source.join('') : cell.source ?? '').trim();
      if (src) cells.push({ path, heading: `cell ${i} (${cell.cell_type})`, mtime, text: src.slice(0, MAX_CHUNK_CHARS) });
    }
    return cells;
  } catch {
    return fixedSplit(text, path, mtime, 'notebook');
  }
}

export function chunkFile(relPath: string, text: string, mtime: number): Chunk[] {
  const ext = relPath.slice(relPath.lastIndexOf('.')).toLowerCase();
  switch (ext) {
    case '.md': case '.txt': case '.rst': return chunkMarkdown(text, relPath, mtime);
    case '.csv': case '.tsv': return chunkCsv(text, relPath, mtime);
    case '.json': return chunkJson(text, relPath, mtime);
    case '.ipynb': return chunkIpynb(text, relPath, mtime);
    case '.py': case '.js': case '.ts': case '.tsx': case '.jsx': case '.java': case '.go': case '.rs':
      return chunkCode(text, relPath, mtime);
    default: return chunkMarkdown(text, relPath, mtime);
  }
}
