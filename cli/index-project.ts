/**
 * (Re)index a project folder and rebuild Project Memory.
 *   npm run index -- --project eval/test-project [--mock]
 */
import { setupSession } from './common.js';

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string, d: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };

const session = await setupSession({
  projectDir: opt('project', 'eval/test-project'),
  mock: flag('mock'),
  reindex: true,
});
console.log(`Indexed ${session.store.count()} chunks from ${session.store.allPaths().length} files.`);
console.log('Files:', session.store.allPaths().join(', '));
console.log('\nProject memory:', JSON.stringify(session.memory, null, 2));
