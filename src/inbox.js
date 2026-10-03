// Gives every track dropped into music/inbox/ to the next video that still needs one:
// first catalog compilations without their track, then ideas from catalog/ideas.js in order.
// The track is moved to music/<id>.<ext>, so the next `npm run make` produces that video.
//   node src/inbox.js            assign tracks
//   node src/inbox.js --dry-run  only show what would happen
import fs from 'node:fs';
import path from 'node:path';
import { COMPILATIONS } from '../catalog/topics.js';
import { IDEAS } from '../catalog/ideas.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const MUSIC = path.join(ROOT, 'music');
const INBOX = path.join(MUSIC, 'inbox');
const AUDIO = /\.(mp3|wav|m4a|flac|ogg)$/i;
const dry = process.argv.includes('--dry-run');

fs.mkdirSync(INBOX, { recursive: true });
const hasTrack = (c) => (c.music ? fs.existsSync(path.join(ROOT, c.music))
  : fs.readdirSync(MUSIC).some((f) => AUDIO.test(f) && f.replace(AUDIO, '') === c.id));
const open = [...COMPILATIONS, ...IDEAS].filter((c) => !hasTrack(c));
const tracks = fs.readdirSync(INBOX).filter((f) => AUDIO.test(f)).sort();

if (!tracks.length) {
  console.log(`music/inbox/ is empty. ${open.length} videos are waiting for a track.`);
  process.exit(0);
}
for (const f of tracks) {
  const c = open.shift();
  if (!c) { console.log(`no ideas left for ${f}: add new ideas to catalog/ideas.js`); break; }
  const ext = path.extname(f).toLowerCase();
  // Catalog compilations name their file (e.g. music/x.mp3); keep that name if the extension matches.
  const target = c.music && c.music.endsWith(ext) ? path.join(ROOT, c.music) : path.join(MUSIC, `${c.id}${ext}`);
  console.log(`${dry ? '[dry-run] ' : ''}${f}  ->  ${path.relative(ROOT, target)}   "${c.title}"`);
  if (!dry) fs.renameSync(path.join(INBOX, f), target);
}
console.log(`${open.length} videos still waiting for a track.`);
