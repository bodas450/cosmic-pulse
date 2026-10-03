// Production status at a glance: `npm run status`.
import fs from 'node:fs';
import path from 'node:path';
import { COMPILATIONS } from '../catalog/topics.js';
import { IDEAS } from '../catalog/ideas.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const AUDIO = /\.(mp3|wav|m4a|flac|ogg)$/i;
const tracks = new Set(fs.readdirSync(path.join(ROOT, 'music')).filter((f) => AUDIO.test(f)).map((f) => f.replace(AUDIO, '')));
const state = (id) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'out', id, 'state.json'), 'utf8')); } catch { return null; } };
const label = (st) => (!st ? 'not started' : st.stage === 'done' ? (st.qc?.problems?.length ? 'QC FAILED' : 'done') : st.error ? `error: ${st.error}` : `in progress (${st.stage})`);

let ready = 0, waiting = 0;
console.log('VIDEO'.padEnd(34), 'TRACK'.padEnd(6), 'LONG'.padEnd(22), 'SHORT');
for (const c of [...COMPILATIONS, ...IDEAS]) {
  const has = c.music ? fs.existsSync(path.join(ROOT, c.music)) : tracks.has(c.id);
  if (!has) { waiting++; continue; }
  const long = label(state(c.id)), short = label(state(`${c.id}-short`));
  if (long === 'done') ready++;
  console.log(c.id.padEnd(34), 'yes'.padEnd(6), long.padEnd(22), short);
}
const inbox = fs.existsSync(path.join(ROOT, 'music', 'inbox')) ? fs.readdirSync(path.join(ROOT, 'music', 'inbox')).filter((f) => AUDIO.test(f)).length : 0;
console.log(`\n${ready} long videos done · ${waiting} ideas waiting for a track · ${inbox} track(s) in music/inbox/`);
