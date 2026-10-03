// Checks that this machine can run the factory: `npm run doctor`.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const py = process.platform === 'win32' ? 'python' : 'python3';
const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8' });
const checks = [
  ['Node.js 20+', () => Number(process.versions.node.split('.')[0]) >= 20, 'install Node.js 20 or newer from nodejs.org'],
  ['ffmpeg', () => run('ffmpeg', ['-version']).status === 0, 'install ffmpeg and make sure `ffmpeg` works in a terminal'],
  ['Python + librosa', () => run(py, ['-c', 'import librosa']).status === 0, `run: ${py} -m pip install librosa`],
  ['npm packages', () => fs.existsSync(path.join(ROOT, 'node_modules', 'three')) && fs.existsSync(path.join(ROOT, 'node_modules', 'playwright')), 'run: npm install'],
  ['Chromium for Playwright', async () => {
    const { chromium } = await import('playwright');
    const b = await chromium.launch(); await b.close(); return true;
  }, 'run: npx playwright install chromium'],
  ['music tracks', () => fs.readdirSync(path.join(ROOT, 'music')).some((f) => /\.(mp3|wav|m4a|flac|ogg)$/i.test(f)), 'put at least one track into music/'],
];
let bad = 0;
for (const [name, test, fix] of checks) {
  let ok = false;
  try { ok = await test(); } catch { ok = false; }
  console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : `  ->  ${fix}`}`);
  if (!ok) bad++;
}
console.log(bad ? `\n${bad} problem(s) to fix first.` : '\nAll good. Run: npm run make');
process.exitCode = bad ? 1 : 0;
