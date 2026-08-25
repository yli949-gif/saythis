/**
 * Replay a fixture transcript through the full intelligence pipeline.
 *   npm run replay -- eval/fixtures/direct-question.yaml [--project eval/test-project] [--mock] [--reindex]
 */
import fs from 'node:fs';
import YAML from 'yaml';
import { CopilotPipeline } from '../src/core/pipeline/copilot.js';
import { setupSession, renderEvent } from './common.js';

const args = process.argv.slice(2);
const fixturePath = args.find((a) => !a.startsWith('--'));
if (!fixturePath) { console.error('usage: replay <fixture.yaml> [--project dir] [--mock] [--reindex]'); process.exit(1); }
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string, d: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };

const fixture = YAML.parse(fs.readFileSync(fixturePath, 'utf8'));
const session = await setupSession({
  projectDir: opt('project', 'eval/test-project'),
  mock: flag('mock'),
  reindex: flag('reindex'),
  meetingGoal: fixture.meetingGoal,
});
const pipeline = new CopilotPipeline(session.provider, session.store, session.memory, session.config);

console.log(`\n=== ${fixture.name} — provider: ${session.provider.name} ===\n`);
let t = 0;
for (const u of fixture.transcript) {
  t += 1000;
  const speaker = u.channel === 'me' ? session.config.userName : (u.speaker ?? 'Other');
  console.log(`\x1b[1m${speaker}:\x1b[0m ${u.text}`);
  const out = await pipeline.onUtterance({ channel: u.channel, speaker: u.speaker, text: u.text, t });
  if (out.triage && out.triage.importance === 'notable' && out.triage.meaningZh) {
    console.log(`  \x1b[36m» ${out.triage.meaningZh}\x1b[0m`);
  }
  if (out.event) console.log('\n' + renderEvent(out.event) + '\n');
}
