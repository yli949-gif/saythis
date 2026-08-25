/**
 * Interactive "Ask Copilot..." — type questions (中文 or English) against a project.
 *   npm run ask -- --project eval/test-project [--mock]
 * Lines prefixed with `them:` or `me:` are added to the transcript instead of asked.
 */
import readline from 'node:readline';
import { CopilotPipeline } from '../src/core/pipeline/copilot.js';
import { setupSession, renderEvent } from './common.js';

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string, d: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };

const session = await setupSession({
  projectDir: opt('project', 'eval/test-project'),
  mock: flag('mock'),
  reindex: flag('reindex'),
});
const pipeline = new CopilotPipeline(session.provider, session.store, session.memory, session.config);

console.log(`Ask Copilot (provider: ${session.provider.name}). Type a question, or "them: ..." / "me: ..." to feed transcript. Ctrl+C to exit.\n`);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
rl.prompt();
rl.on('line', async (line) => {
  const text = line.trim();
  if (!text) return rl.prompt();
  const m = /^(them|me):\s*(.*)$/i.exec(text);
  try {
    if (m) {
      const out = await pipeline.onUtterance({ channel: m[1].toLowerCase() as 'me' | 'them', text: m[2], t: Date.now() });
      if (out.triage?.meaningZh) console.log(`  \x1b[36m» ${out.triage.meaningZh}\x1b[0m`);
      if (out.event) console.log('\n' + renderEvent(out.event) + '\n');
    } else {
      const e = await pipeline.ask(text);
      console.log('\n' + renderEvent(e) + '\n');
    }
  } catch (err) {
    console.error(String(err));
  }
  rl.prompt();
});
