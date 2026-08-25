/**
 * Evaluation harness: replays every fixture through the REAL pipeline and scores it.
 *   npm run eval               (real OpenAI provider — needs OPENAI_API_KEY)
 *   npm run eval -- --mock     (offline plumbing check; language-quality assertions skipped)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { CopilotPipeline, type PipelineOutput } from '../src/core/pipeline/copilot.js';
import { setupSession } from '../cli/common.js';
import type { CopilotEvent } from '../src/core/types.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const mock = args.includes('--mock');
const only = (() => { const i = args.indexOf('--only'); return i >= 0 ? args[i + 1] : null; })();

/** Count spoken sentences without splitting decimals like 0.68. */
export function sentenceCount(s: string): number {
  const m = s.trim().match(/[.!?]+(?=\s|$)/g);
  return m ? m.length : (s.trim() ? 1 : 0);
}

interface Check { name: string; pass: boolean; skipped?: boolean; detail?: string }

function checkFixture(fx: any, outputs: PipelineOutput[], mockMode: boolean): Check[] {
  const checks: Check[] = [];
  const realOnly: string[] = fx.real_only ?? [];
  const skip = (name: string) => mockMode && realOnly.includes(name);
  const exp = fx.expect ?? {};
  const events = outputs.map((o) => o.event).filter((e): e is CopilotEvent => !!e);
  const last = outputs[outputs.length - 1];
  const ev = last?.event;
  const add = (name: string, pass: boolean, detail?: string) =>
    checks.push(skip(name) ? { name, pass: true, skipped: true } : { name, pass, detail });

  if (exp.card === false) {
    add('no_card', events.length === 0, events.length ? `unexpected card: "${events[0].sayThis.slice(0, 80)}"` : undefined);
    return checks;
  }
  add('card', !!ev, ev ? undefined : 'no copilot card for final utterance');
  if (!ev) return checks;

  if (exp.is_question_for_user !== undefined) {
    add('is_question_for_user', last.triage?.isQuestionForUser === exp.is_question_for_user,
      `got ${last.triage?.isQuestionForUser}`);
  }
  if (exp.resolved_contains_any) {
    const rq = (last.triage?.resolvedQuery ?? '').toLowerCase();
    add('resolved_contains_any', exp.resolved_contains_any.some((s: string) => rq.includes(s.toLowerCase())),
      `resolvedQuery="${rq}"`);
  }
  const say = `${ev.sayThis} ${ev.why ?? ''}`.toLowerCase();
  if (exp.say_contains_any) {
    add('say_contains_any', exp.say_contains_any.some((s: string) => say.includes(String(s).toLowerCase())),
      `sayThis="${ev.sayThis}"`);
  }
  if (exp.say_not_contains) {
    add('say_not_contains', exp.say_not_contains.every((s: string) => !ev.sayThis.toLowerCase().includes(String(s).toLowerCase())),
      `sayThis="${ev.sayThis}"`);
  }
  if (exp.say_not_matches) {
    add('say_not_matches', exp.say_not_matches.every((re: string) => !new RegExp(re, 'i').test(ev.sayThis)),
      `sayThis="${ev.sayThis}"`);
  }
  if (exp.confidence_any) {
    add('confidence_any', exp.confidence_any.includes(ev.confidence), `got ${ev.confidence}`);
  }
  if (exp.sources_any) {
    const files = ev.sources.map((s) => s.file.toLowerCase());
    add('sources_any', exp.sources_any.some((s: string) => files.some((f) => f.includes(String(s).toLowerCase()))),
      `sources=[${files.join(', ')}]`);
  }
  if (exp.conflict) add('conflict_flagged', !!ev.conflict, `conflict=${ev.conflict}`);

  // Global DoD invariants for every card:
  add('max_3_sentences', sentenceCount(ev.sayThis) <= 3, `${sentenceCount(ev.sayThis)} sentences: "${ev.sayThis}"`);
  add('meaning_zh_present', ev.meaningZh.length > 0);
  add('latency_measured', typeof ev.latencyMs.total === 'number' && ['triage', 'retrieval', 'generate'].every((k) => k in ev.latencyMs));
  if (ev.confidence !== 'low') {
    add('traceable_sources', ev.sources.length > 0, 'non-low confidence answer has no sources');
  }
  return checks;
}

// Fake secret fixture is generated at runtime (git-ignored on purpose): the indexer must skip it.
const fakeEnv = path.join(HERE, 'test-project', '.env');
if (!fs.existsSync(fakeEnv)) {
  fs.writeFileSync(fakeEnv, '# FAKE credentials for eval: must NEVER be indexed\nWISE_API_KEY=sk-fake-super-secret-do-not-index-9x7q\n');
}

const session = await setupSession({ projectDir: path.join(HERE, 'test-project'), mock, reindex: true });
// Privacy gate: secrets and dependency dirs must not be in the index.
const badPaths = session.store.allPaths().filter((p) => /\.env|node_modules|secret|\.pem|\.key$/i.test(p));
console.log(badPaths.length === 0
  ? '\x1b[32mPASS\x1b[0m  privacy: no .env/node_modules/secrets indexed'
  : `\x1b[31mFAIL\x1b[0m  privacy: indexed forbidden paths: ${badPaths.join(', ')}`);
if (badPaths.length) process.exitCode = 1;
const fixtureDir = path.join(HERE, 'fixtures');
const fixtureFiles = fs.readdirSync(fixtureDir).filter((f) => f.endsWith('.yaml')).sort()
  .filter((f) => !only || f.includes(only));

const report: any[] = [];
let failed = 0;
for (const file of fixtureFiles) {
  const fx = YAML.parse(fs.readFileSync(path.join(fixtureDir, file), 'utf8'));
  const pipeline = new CopilotPipeline(session.provider, session.store, session.memory, session.config);
  const outputs: PipelineOutput[] = [];
  let t = 0;
  const t0 = performance.now();
  for (const u of fx.transcript) {
    outputs.push(await pipeline.onUtterance({ channel: u.channel, speaker: u.speaker, text: u.text, t: (t += 1000) }));
  }
  const wallMs = Math.round(performance.now() - t0);
  const checks = checkFixture(fx, outputs, mock);
  const ok = checks.every((c) => c.pass);
  if (!ok) failed++;
  const lastEvent = outputs[outputs.length - 1]?.event;
  report.push({
    fixture: fx.name, dod: fx.dod, pass: ok, wallMs,
    transcript: fx.transcript,
    triage: outputs[outputs.length - 1]?.triage,
    latency: lastEvent?.latencyMs,
    checks: checks.map((c) => ({ name: c.name, pass: c.pass, skipped: c.skipped ?? false, detail: c.pass ? undefined : c.detail })),
    event: lastEvent,
  });
  const skippedN = checks.filter((c) => c.skipped).length;
  console.log(`${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${fx.name}` +
    `  (${checks.filter((c) => c.pass && !c.skipped).length} ok${skippedN ? `, ${skippedN} skipped[mock]` : ''}, ${wallMs}ms)`);
  for (const c of checks.filter((x) => !x.pass)) console.log(`      \x1b[31m✗ ${c.name}\x1b[0m — ${c.detail ?? ''}`);
}

const summaryLat = report.filter((r) => r.latency).map((r) => r.latency.total);
console.log(`\n${fixtureFiles.length - failed}/${fixtureFiles.length} fixtures passed (provider: ${session.provider.name})`);
if (summaryLat.length) {
  const avg = Math.round(summaryLat.reduce((a: number, b: number) => a + b, 0) / summaryLat.length);
  console.log(`intelligence latency (triage→answer): avg ${avg}ms, max ${Math.max(...summaryLat)}ms`);
}
fs.writeFileSync(path.join(HERE, `report-${session.provider.name}.json`), JSON.stringify(report, null, 2));
console.log(`report → eval/report-${session.provider.name}.json`);
process.exit(failed ? 1 : 0);
