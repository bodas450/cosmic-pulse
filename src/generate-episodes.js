// Expands the catalog into episode files. One topic yields:
//   - N long (16:9) variants with different seeds/palettes,
//   - one vertical Short (9:16) per beat.
// Usage: node src/generate-episodes.js [--variants 3] [--no-shorts]
import fs from 'node:fs';
import path from 'node:path';
import { TOPICS, NEBULA_PALETTES, COMPILATIONS } from '../catalog/topics.js';
import { IDEAS } from '../catalog/ideas.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const variants = args.includes('--variants') ? Math.max(1, Number(args[args.indexOf('--variants') + 1]) || 1) : 1;
const shorts = !args.includes('--no-shorts');

function hash(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }

function beatToScene(b, seed, v) {
  const params = { ...b.params };
  if (b.type === 'nebula' && !b.params?.palette) params.palette = NEBULA_PALETTES[(seed + v) % NEBULA_PALETTES.length];
  return { type: b.type, label: b.label, text: b.text, seed, params, camera: { start: (seed % 628) / 100, ...b.camera } };
}

const AUDIO = ['mp3', 'wav', 'm4a', 'flac', 'ogg'];
function findTrack(id) {
  const ext = AUDIO.find((e) => fs.existsSync(path.join(ROOT, 'music', `${id}.${e}`)));
  return ext ? `music/${id}.${ext}` : null;
}

export function buildEpisodes(topics = TOPICS) {
  const out = [];
  const musicDir = path.join(ROOT, 'music');
  const missing = [];
  const tracks = fs.existsSync(musicDir) ? fs.readdirSync(musicDir).filter((f) => /\.(mp3|wav|m4a|flac|ogg)$/i.test(f)).sort() : [];
  for (const t of topics) {
    for (let v = 0; v < variants; v++) {
      const id = variants > 1 ? `${t.id}-v${v + 1}` : t.id;
      out.push({
        id, format: 'long', width: 1920, height: 1080,
        title: t.title, subtitle: t.subtitle,
        scenes: t.beats.map((b, i) => beatToScene(b, hash(`${id}:${i}`), v)),
      });
    }
    // Music edition: no narration, the soundtrack drives the edit. Tracks from music/ are
    // assigned round-robin; pin one per topic with `music: 'music/<file>'` in the catalog.
    if (tracks.length) {
      const id = `${t.id}-music`;
      out.push({
        id, format: 'music', mode: 'music', width: 1920, height: 1080,
        title: t.title, subtitle: t.subtitle,
        music: t.music ?? `music/${tracks[topics.indexOf(t) % tracks.length]}`,
        scenes: t.beats.map((b, i) => beatToScene(b, hash(`${id}:${i}`), 0)),
      });
    }
    if (shorts) t.beats.forEach((b, i) => {
      const id = `${t.id}-short-${i + 1}`;
      out.push({
        id, format: 'short', width: 1080, height: 1920,
        title: b.label, subtitle: t.title,
        scenes: [beatToScene({ ...b, camera: { ...b.camera, dist: b.camera.dist.map((d) => d * 1.25) } }, hash(id), 0)],
      });
    });
  }
  // Compilations (catalog) and ideas (idea bank): chained topics as one 3–4 minute music
  // video, plus a vertical Short cut from it around the main drop.
  const all = [...COMPILATIONS, ...IDEAS];
  const seen = new Set();
  let waiting = 0;
  for (const [ci, c] of all.entries()) {
    if (seen.has(c.id)) throw new Error(`duplicate compilation/idea id: ${c.id}`);
    seen.add(c.id);
    const beats = c.topics.flatMap((id) => {
      const t = topics.find((x) => x.id === id);
      if (!t) throw new Error(`${c.id}: unknown topic ${id}`);
      return t.beats;
    });
    // Catalog entries name their track; ideas use music/<id>.<ext> once it exists.
    const music = c.music ?? findTrack(c.id);
    if (!music || !fs.existsSync(path.join(ROOT, music))) {
      if (c.music) missing.push(`${c.id}: add ${c.music}`); else waiting++;
      continue;
    }
    const scenes = beats.map((b, i) => beatToScene(b, hash(`${c.id}:${i}`), ci));
    out.push({ id: c.id, format: 'compilation', mode: 'music', width: 1920, height: 1080, title: c.title, subtitle: c.subtitle, music, scenes });
    // Short: ~40 s of the track around its main drop, 4 story beats around the impact.
    const imp = scenes.findIndex((sc) => sc.type === 'supernova' || sc.type === 'bigbang');
    const from = Math.max(0, Math.min(scenes.length - 4, (imp >= 0 ? imp : Math.floor(scenes.length / 2)) - 2));
    out.push({
      id: `${c.id}-short`, format: 'music-short', mode: 'music', width: 1080, height: 1920, title: c.title, subtitle: 'Cosmic Pulse',
      music, musicWindow: 40, titleSeconds: 2.5, parent: c.id, scenes: scenes.slice(from, from + 4),
    });
  }
  if (waiting) console.log(`${waiting} ideas waiting for a track (drop tracks into music/inbox/ and run: npm run daily)`);
  if (missing.length) console.log(`skipped (no track yet):\n  ${missing.join('\n  ')}`);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = path.join(ROOT, 'episodes');
  fs.rmSync(dir, { recursive: true, force: true }); // stale episodes would otherwise still get rendered
  fs.mkdirSync(dir, { recursive: true });
  const eps = buildEpisodes();
  for (const e of eps) fs.writeFileSync(path.join(dir, `${e.id}.json`), JSON.stringify(e, null, 2));
  console.log(`wrote ${eps.length} episodes to episodes/`);
}
