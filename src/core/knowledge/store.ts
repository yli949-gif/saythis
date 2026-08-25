import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import fs from 'node:fs';
import path from 'node:path';
import type { Chunk } from '../types.js';

export class KnowledgeStore {
  readonly db: Database.Database;
  private dim: number | null = null;

  constructor(projectDir: string, inMemory = false) {
    const dir = path.join(projectDir, '.saythis');
    if (!inMemory) fs.mkdirSync(dir, { recursive: true });
    this.db = new Database(inMemory ? ':memory:' : path.join(dir, 'index.db'));
    sqliteVec.load(this.db);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY, path TEXT, heading TEXT, mtime REAL, text TEXT
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        text, path, heading, content='chunks', content_rowid='id', tokenize='porter unicode61'
      );
    `);
    const d = this.db.prepare(`SELECT v FROM meta WHERE k='dim'`).get() as { v: string } | undefined;
    if (d) this.dim = Number(d.v);
  }

  clear(): void {
    this.db.exec(`DELETE FROM chunks; DELETE FROM chunks_fts;`);
    if (this.dim) this.db.exec(`DROP TABLE IF EXISTS chunks_vec;`);
  }

  insertChunks(chunks: Chunk[], embeddings: number[][]): void {
    if (chunks.length === 0) return;
    const dim = embeddings[0].length;
    if (this.dim !== dim) {
      this.db.exec(`DROP TABLE IF EXISTS chunks_vec;`);
      this.db.exec(`CREATE VIRTUAL TABLE chunks_vec USING vec0(embedding float[${dim}])`);
      this.db.prepare(`INSERT OR REPLACE INTO meta VALUES ('dim', ?)`).run(String(dim));
      this.dim = dim;
    } else {
      this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(embedding float[${dim}])`);
    }
    const insChunk = this.db.prepare(`INSERT INTO chunks (path, heading, mtime, text) VALUES (?,?,?,?)`);
    const insFts = this.db.prepare(`INSERT INTO chunks_fts (rowid, text, path, heading) VALUES (?,?,?,?)`);
    const insVec = this.db.prepare(`INSERT INTO chunks_vec (rowid, embedding) VALUES (?,?)`);
    const tx = this.db.transaction(() => {
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        const info = insChunk.run(c.path, c.heading, c.mtime, c.text);
        const id = Number(info.lastInsertRowid);
        insFts.run(id, c.text, c.path, c.heading);
        insVec.run(BigInt(id), Buffer.from(new Float32Array(embeddings[i]).buffer));
      }
    });
    tx();
  }

  ftsSearch(query: string, limit = 20): { id: number; rank: number }[] {
    const tokens = query.toLowerCase().replace(/[^a-z0-9_一-鿿.\s-]/g, ' ')
      .split(/\s+/).filter((t) => t.length > 1);
    if (tokens.length === 0) return [];
    const ftsQuery = tokens.map((t) => `"${t.replace(/"/g, '')}"`).join(' OR ');
    try {
      const rows = this.db.prepare(
        `SELECT rowid AS id, bm25(chunks_fts, 10.0, 2.0, 2.0) AS rank
         FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY rank LIMIT ?`
      ).all(ftsQuery, limit) as { id: number; rank: number }[];
      return rows;
    } catch { return []; }
  }

  vecSearch(embedding: number[], limit = 20): { id: number; distance: number }[] {
    if (!this.dim) return [];
    try {
      return this.db.prepare(
        `SELECT rowid AS id, distance FROM chunks_vec WHERE embedding MATCH ? AND k = ? ORDER BY distance`
      ).all(Buffer.from(new Float32Array(embedding).buffer), limit) as { id: number; distance: number }[];
    } catch { return []; }
  }

  getChunks(ids: number[]): Chunk[] {
    if (ids.length === 0) return [];
    const rows = this.db.prepare(
      `SELECT id, path, heading, mtime, text FROM chunks WHERE id IN (${ids.map(() => '?').join(',')})`
    ).all(...ids) as Chunk[];
    const byId = new Map(rows.map((r) => [r.id!, r]));
    return ids.map((id) => byId.get(id)).filter((c): c is Chunk => !!c);
  }

  count(): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM chunks`).get() as { n: number }).n;
  }

  allPaths(): string[] {
    return (this.db.prepare(`SELECT DISTINCT path FROM chunks`).all() as { path: string }[]).map((r) => r.path);
  }
}
