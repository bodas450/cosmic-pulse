// The factory. Every episode moves through resumable stages:
//   narrated:  voice   -> plan      -> render -> mix      -> qc -> done
//   music:     analyze -> musicplan -> render -> musicmix -> qc -> done
//   (music mode: no voice; cuts, impacts and light pulses follow the soundtrack)
// State lives in out/<id>/state.json, so a crash or Ctrl-C resumes where it stopped.
//
// Usage:
//   node src/pipeline.js                       # everything in episodes/
//   node src/pipeline.js --only short --limit 3
//   node src/pipeline.js --scale 0.5 --cap 6   # fast preview: half res, scenes capped to 6s
// Options: --export <folder> --only <substr> --ids <id,id,...> --format long|short|music|compilation --limit <n> --workers <n> --fps <n> --scale <k> --cap <sec> --force
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { serve } from './serve.js';
import { synthesize, cues, probeDuration } from './voice.js';
import { planMusicEdit, findMainDrop } from './music-plan.js';
import { makeThumbnail, bestFrameTime } from './thumbnail.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const opt = (name, def) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : def);
const OPTS = {
  only: opt('only', ''),
  ids: opt('ids', ''), // comma-separated exact episode ids
  format: opt('format', ''),
  limit: Number(opt('limit', Infinity)),
  workers: Number(opt('workers', Math.max(1, Math.min(4, os.cpus().length - 1)))),
  fps: Number(opt('fps', 30)),
  scale: Number(opt('scale', 1)),
  cap: Number(opt('cap', 0)),
  force: argv.includes('--force'),
  export: opt('export', process.env.SF_EXPORT || ''), // copy finished videos here, named by title
};
const TITLE_SECONDS = 4;
// Software WebGL (SwiftShader) works everywhere; SF_GPU=1 lets Chromium use the machine's graphics card instead.
const CHROME_ARGS = process.env.SF_GPU === '1'
  ? ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=default']
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const LEAD = 0.8, TAIL = 1.4, MIN_SCENE = 7;

const log = (id, ...m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${id}:`, ...m);

function ff(args) { execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: ['ignore', 'ignore', 'inherit'] }); }

// ---------- stages ----------
const STAGES = {
  async voice(ep, dir, st) {
    st.voice = ep.scenes.map((s, i) => {
      const r = synthesize(s.text, path.join(dir, `voice-${i}.mp3`));
      return { file: path.basename(r.file), duration: r.duration, tts: r.tts };
    });
    if (!st.voice.some((v) => v.tts)) log(ep.id, 'TTS unavailable -> silent narration, captions only');
  },

  async plan(ep, dir, st) {
    let at = 0;
    const scenes = ep.scenes.map((s, i) => {
      const lead = (i === 0 ? TITLE_SECONDS : 0) + LEAD;
      const vd = st.voice[i].duration;
      let duration = Math.max(MIN_SCENE, lead + vd + TAIL);
      if (OPTS.cap) duration = Math.min(duration, OPTS.cap + (i === 0 ? TITLE_SECONDS : 0));
      const scene = { ...s, start: at, duration, voiceAt: at + lead, cues: cues(s.text, lead, Math.min(vd, duration - lead)) };
      at += duration;
      return scene;
    });
    const scale = OPTS.scale;
    st.plan = {
      id: ep.id, title: ep.title, subtitle: ep.subtitle, seed: scenes[0].seed, fps: OPTS.fps,
      width: Math.round((ep.width * scale) / 2) * 2, height: Math.round((ep.height * scale) / 2) * 2,
      vertical: ep.height > ep.width, titleSeconds: TITLE_SECONDS, duration: at, scenes,
    };
    fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(st.plan, null, 2));
  },

  // Deterministic frames let us cut the timeline into short segments, render them on
  // parallel browser workers and concatenate them losslessly. Each finished segment is kept
  // on disk, so a crash or container restart resumes from the last segment, not from zero.
  async render(ep, dir, st) {
    const plan = st.plan;
    const total = Math.ceil(plan.duration * plan.fps);
    const SEG = 120; // 4 s at 30 fps: little work is lost if the machine stops
    const key = createHash('md5').update(JSON.stringify(plan)).digest('hex').slice(0, 10);
    const segDir = path.join(dir, `segments-${key}`);
    // Segments from an older plan can't be reused.
    for (const d of fs.readdirSync(dir)) if (d.startsWith('segments-') && d !== path.basename(segDir)) fs.rmSync(path.join(dir, d), { recursive: true, force: true });
    fs.mkdirSync(segDir, { recursive: true });
    const segs = Array.from({ length: Math.ceil(total / SEG) }, (_, i) => ({ i, from: i * SEG, to: Math.min(total, (i + 1) * SEG), file: path.join(segDir, `seg-${String(i).padStart(5, '0')}.mp4`) }));
    const todo = segs.filter((g) => !fs.existsSync(g.file));
    if (todo.length < segs.length) log(ep.id, `resuming: ${segs.length - todo.length}/${segs.length} segments already rendered`);
    const t0 = Date.now();
    let done = (segs.length - todo.length) * SEG, fresh = 0;
    if (todo.length) {
      const { server, url } = await serve();
      try {
        const n = Math.min(OPTS.workers, todo.length);
        await Promise.all(Array.from({ length: n }, () => renderWorker(plan, url, todo, () => {
          done++; fresh++;
          if (done % 150 === 0) log(ep.id, `render ${Math.min(done, total)}/${total} frames, ${(fresh / ((Date.now() - t0) / 1000)).toFixed(1)} fps`);
        })));
      } finally { server.close(); }
    }
    fs.writeFileSync(path.join(dir, 'chunks.txt'), segs.map((g) => `file '${g.file}'`).join('\n'));
    ff(['-f', 'concat', '-safe', '0', '-i', path.join(dir, 'chunks.txt'), '-c', 'copy', path.join(dir, 'video.mp4')]);
    fs.rmSync(segDir, { recursive: true, force: true });
    log(ep.id, `rendered ${total} frames (${fresh} this run) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  },

  // Voice clips placed on the timeline over a generated ambient drone, loudness-normalised.
  async mix(ep, dir, st) {
    const plan = st.plan;
    const D = plan.duration.toFixed(2);
    const seed = plan.seed % 7;
    const root = [55, 49, 61.7, 46.2, 58.3, 51.9, 65.4][seed];
    const drone = `aevalsrc='0.10*sin(2*PI*${root}*t)*(0.6+0.4*sin(2*PI*0.05*t))+0.06*sin(2*PI*${root * 1.5}*t)*(0.5+0.5*sin(2*PI*0.031*t))+0.04*sin(2*PI*${root * 2.01}*t)*(0.5+0.5*sin(2*PI*0.023*t))+0.02*sin(2*PI*${root * 3}*t+sin(2*PI*0.1*t))':s=44100:d=${D}`;
    const inputs = ['-f', 'lavfi', '-i', drone];
    const parts = [`[0:a]aecho=0.8:0.7:900|1400:0.35|0.25,lowpass=f=1800,afade=t=in:d=3,afade=t=out:st=${Math.max(0, plan.duration - 3).toFixed(2)}:d=3,volume=0.55[bg]`];
    const labels = [];
    plan.scenes.forEach((s, i) => {
      inputs.push('-i', path.join(dir, st.voice[i].file));
      const ms = Math.round(s.voiceAt * 1000);
      parts.push(`[${i + 1}:a]aresample=44100,atrim=0:${(s.start + s.duration - s.voiceAt).toFixed(2)},adelay=${ms}|${ms},apad[v${i}]`);
      labels.push(`[v${i}]`);
    });
    parts.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0[vo]`);
    parts.push(`[bg][vo]amix=inputs=2:normalize=0,atrim=0:${D},loudnorm=I=-16:TP=-1.5:LRA=11[out]`);
    ff([...inputs, '-filter_complex', parts.join(';'), '-map', '[out]', '-ar', '48000', '-ac', '2', '-c:a', 'aac', '-b:a', '192k', path.join(dir, 'audio.m4a')]);
    ff(['-i', path.join(dir, 'video.mp4'), '-i', path.join(dir, 'audio.m4a'), '-c:v', 'copy', '-c:a', 'copy', '-shortest', '-movflags', '+faststart', path.join(dir, 'final.mp4')]);
    // Thumbnail from the middle scene, past its fade-in.
    const s = plan.scenes[Math.floor(plan.scenes.length / 2)];
    ff(['-ss', (s.start + s.duration * 0.6).toFixed(2), '-i', path.join(dir, 'final.mp4'), '-frames:v', '1', '-q:v', '2', path.join(dir, 'thumb.jpg')]);
  },

  // ---- music mode ----
  async analyze(ep, dir, st) {
    if (ep.musicWindow) {
      // Short: cut ~musicWindow seconds around the main drop, on bar lines, then analyze the cut.
      analyzeTrack(path.resolve(ROOT, ep.music), path.join(dir, 'source.json'));
      const a = JSON.parse(fs.readFileSync(path.join(dir, 'source.json'), 'utf8'));
      const drop = findMainDrop(a) ?? a.duration / 2;
      const bars = a.downbeats;
      const near = (t) => bars.reduce((b, x) => (Math.abs(x - t) < Math.abs(b - t) ? x : b), bars[0] ?? 0);
      const start = Math.max(0, near(drop - ep.musicWindow * 0.55));
      let end = near(start + ep.musicWindow);
      if (end <= start + 10) end = Math.min(a.duration, start + ep.musicWindow);
      ff(['-ss', start.toFixed(3), '-to', end.toFixed(3), '-i', path.resolve(ROOT, ep.music), '-ac', '2', '-ar', '44100', trackPath(ep, dir)]);
      log(ep.id, `short window ${start.toFixed(1)}–${end.toFixed(1)}s of ${ep.music} (main drop at ${drop.toFixed(1)}s)`);
    }
    analyzeTrack(trackPath(ep, dir), path.join(dir, 'music.json'));
    st.music = path.join(dir, 'music.json');
  },

  async musicplan(ep, dir, st) {
    const a = JSON.parse(fs.readFileSync(path.join(dir, 'music.json'), 'utf8'));
    assertSameTrack(ep, a, dir);
    const edit = planMusicEdit(ep, a, OPTS.fps);
    const scale = OPTS.scale;
    st.plan = {
      id: ep.id, title: ep.title, subtitle: ep.subtitle, seed: ep.scenes[0].seed, fps: OPTS.fps,
      width: Math.round((ep.width * scale) / 2) * 2, height: Math.round((ep.height * scale) / 2) * 2,
      vertical: ep.height > ep.width, titleSeconds: ep.titleSeconds ?? 5, ...edit,
    };
    fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(st.plan));
    log(ep.id, `${a.bpm} BPM, drops at ${a.drops.join(', ')}s, ${edit.scenes.reduce((n, s) => n + s.shots.length, 0)} shots`);
  },

  async musicmix(ep, dir, st) {
    const D = st.plan.duration;
    ff(['-i', trackPath(ep, dir), '-af', `afade=t=in:d=${ep.musicWindow ? 0.05 : 0.5},afade=t=out:st=${Math.max(0, D - 2).toFixed(2)}:d=2,loudnorm=I=-14:TP=-1:LRA=11`,
      '-ar', '48000', '-ac', '2', '-t', D.toFixed(3), '-c:a', 'aac', '-b:a', '256k', path.join(dir, 'audio.m4a')]);
    ff(['-i', path.join(dir, 'video.mp4'), '-i', path.join(dir, 'audio.m4a'), '-c:v', 'copy', '-c:a', 'copy', '-shortest', '-movflags', '+faststart', path.join(dir, 'final.mp4')]);
    const t = st.plan.mainDrop ?? D / 2;
    ff(['-ss', (t + 0.6).toFixed(2), '-i', path.join(dir, 'final.mp4'), '-frames:v', '1', '-q:v', '2', path.join(dir, 'thumb.jpg')]);
  },

  // Branded 1280x720 thumbnail from the most striking frame (Shorts don't need one).
  async thumbnail(ep, dir, st) {
    if (ep.musicWindow || ep.height > ep.width) return;
    const t = bestFrameTime(path.join(dir, 'final.mp4'));
    ff(['-ss', t.toFixed(2), '-i', path.join(dir, 'final.mp4'), '-frames:v', '1', path.join(dir, 'frame.png')]);
    await makeThumbnail(path.join(dir, 'frame.png'), ep.title, path.join(dir, 'thumbnail.jpg'));
  },

  async qc(ep, dir, st) {
    const file = path.join(dir, 'final.mp4');
    const problems = [];
    const dur = probeDuration(file);
    if (Math.abs(dur - st.plan.duration) > 0.6) problems.push(`duration ${dur.toFixed(1)}s != planned ${st.plan.duration.toFixed(1)}s`);
    const blackLog = spawnSyncStderr(['-v', 'info', '-i', file, '-vf', 'blackdetect=d=0.5:pix_th=0.06', '-an', '-f', 'null', '-']);
    const blackSecs = [...blackLog.matchAll(/black_duration:([\d.]+)/g)].reduce((n, m) => n + Number(m[1]), 0);
    if (blackSecs > dur * 0.2) problems.push(`${blackSecs.toFixed(1)}s of black frames`);
    const vol = spawnSyncStderr(['-v', 'info', '-i', file, '-af', 'volumedetect', '-vn', '-f', 'null', '-']);
    const mean = Number(/mean_volume: (-?[\d.]+)/.exec(vol)?.[1] ?? -99);
    if (mean < -40) problems.push(`audio too quiet (${mean} dB)`);
    // Music mode: measure sync in the finished video itself. Detect hard cuts in the picture
    // and check how far each lands from the nearest beat of the track.
    let sync = null;
    if (ep.mode === 'music') {
      const a = JSON.parse(fs.readFileSync(path.join(dir, 'music.json'), 'utf8'));
      assertSameTrack(ep, a, dir);
      const grid = [...a.beats, ...a.downbeats].sort((x, y) => x - y);
      const log_ = spawnSyncStderr(['-v', 'info', '-i', file, '-vf', "select='gt(scene,0.25)',showinfo", '-an', '-f', 'null', '-']);
      const cuts = [...log_.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1])).filter((t) => t > 0.5 && t < dur - 1);
      const offs = cuts.map((t) => Math.min(...grid.map((g) => Math.abs(g - t)))).sort((x, y) => x - y);
      const pct = (q) => (offs.length ? +offs[Math.min(offs.length - 1, Math.floor(q * offs.length))].toFixed(3) : null);
      sync = { cuts: cuts.length, onBeatWithin50ms: offs.filter((o) => o <= 0.05).length, medianOffset: pct(0.5), p90Offset: pct(0.9) };
      const tolerance = Math.max(0.1, 1.5 / st.plan.fps); // a cut can't be finer than one frame
      if (offs.length && sync.medianOffset > tolerance) problems.push(`cuts are off the beat (median ${sync.medianOffset}s)`);
    }
    st.qc = { sync, duration: +dur.toFixed(2), blackSeconds: +blackSecs.toFixed(2), meanVolume: mean, tts: st.voice?.some((v) => v.tts) ?? null, problems };
    if (problems.length) throw new Error(`QC failed: ${problems.join('; ')}`);
  },
};

// The edit must be planned from the analysis of the very track that ends up in the video.
function assertSameTrack(ep, a, dir) {
  if (path.resolve(a.file) !== trackPath(ep, dir)) throw new Error(`beat analysis is for ${a.file}, but the video uses ${trackPath(ep, dir)}`);
}

// The audio a video is cut to: the full track, or for Shorts the excerpt cut in `analyze`.
function trackPath(ep, dir) {
  return ep.musicWindow ? path.join(dir, 'track.wav') : path.resolve(ROOT, ep.music);
}

function analyzeTrack(file, out) {
  execFileSync(process.platform === 'win32' ? 'python' : 'python3', [path.join(ROOT, 'src', 'analyze_music.py'), file, out], { stdio: ['ignore', 'inherit', 'inherit'] });
}

function spawnSyncStderr(args) {
  return spawnSync('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] }).stderr?.toString() ?? '';
}

// One browser per worker; it keeps taking segments off the shared queue until none are left.
// A segment is written to a .part file and renamed only once fully encoded.
async function renderWorker(plan, url, queue, tick) {
  const browser = await chromium.launch({ args: CHROME_ARGS });
  try {
    const page = await browser.newPage({ viewport: { width: plan.width, height: plan.height } });
    page.on('pageerror', (e) => console.error('page error:', e.message));
    await page.goto(`${url}/renderer/index.html`);
    await page.waitForFunction(() => window.rendererReady === true);
    await page.evaluate((p) => window.setup(p), plan);
    for (let g = queue.shift(); g; g = queue.shift()) {
      const part = `${g.file}.part.mp4`;
      const enc = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(plan.fps), '-c:v', 'mjpeg', '-i', '-',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-x264-params', 'aq-mode=3', '-pix_fmt', 'yuv420p', '-r', String(plan.fps), part], { stdio: ['pipe', 'ignore', 'inherit'] });
      const encoded = new Promise((ok, fail) => enc.on('close', (c) => (c === 0 ? ok() : fail(new Error(`ffmpeg exited ${c}`)))));
      try {
        for (let f = g.from; f < g.to; f++) {
          await page.evaluate((i) => window.renderFrame(i), f);
          const jpg = await page.screenshot({ type: 'jpeg', quality: 97 });
          if (!enc.stdin.write(jpg)) await new Promise((ok) => enc.stdin.once('drain', ok));
          tick();
        }
      } finally { enc.stdin.end(); }
      await encoded;
      fs.renameSync(part, g.file);
    }
  } finally {
    await browser.close();
  }
}

// Copy a finished video (and its thumbnail) to the export folder, e.g. ~/Downloads/Cosmic Pulse.
function exportVideo(ep, dir) {
  if (!OPTS.export) return;
  const target = path.resolve(OPTS.export.replace(/^~(?=$|\/)/, os.homedir()));
  fs.mkdirSync(target, { recursive: true });
  const name = `${ep.title}${ep.musicWindow ? ' (Short)' : ''}`.replace(/[\\/:*?"<>|]/g, '').trim();
  fs.copyFileSync(path.join(dir, 'final.mp4'), path.join(target, `${name}.mp4`));
  const thumb = ['thumbnail.jpg', 'thumb.jpg'].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
  if (thumb) fs.copyFileSync(thumb, path.join(target, `${name}.jpg`));
  const st = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  if (st.plan) fs.writeFileSync(path.join(target, `${name}.txt`), youtubeText(ep, st.plan));
  log(ep.id, `exported -> ${path.join(target, name)}.mp4`);
}

// Ready-to-paste YouTube title, description (with chapters from the edit) and tags.
function youtubeText(ep, plan) {
  if (ep.musicWindow) {
    return [
      'TITLE', `${ep.title} 🌌 #shorts`, '',
      'DESCRIPTION',
      `${ep.title}, timed to the beat. Watch the full 3D journey on the channel.`, '',
      '🔔 Subscribe to Cosmic Pulse: the universe, in rhythm.', '',
      '#shorts #space #universe #spacemusic', '',
      'TAGS', 'shorts, space, universe, cosmos, space music, 3D space animation, space visuals', '',
    ].join('\n');
  }
  const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  // YouTube chapters: first at 0:00, each at least 10 s long.
  const chapters = [];
  for (const sc of plan.scenes) {
    if (!sc.label) continue;
    const last = chapters.at(-1);
    if (last && (sc.start - last.start < 10 || last.label === sc.label)) continue;
    chapters.push({ start: chapters.length ? sc.start : 0, label: sc.label });
  }
  while (chapters.length > 1 && plan.duration - chapters.at(-1).start < 10) chapters.pop();
  const tags = ['space', 'universe', 'cosmos', 'space music', '3D space animation', 'cinematic music', 'space visuals', 'astronomy',
    ...new Set(plan.scenes.map((sc) => sc.type).map((t) => ({ nebula: 'nebula', protostar: 'star formation', star: 'stars', planetformation: 'planet formation',
      planet: 'planets', planetarynebula: 'planetary nebula', supernova: 'supernova', blackhole: 'black hole', galaxy: 'galaxy', bigbang: 'big bang' })[t]).filter(Boolean))];
  return [
    'TITLE',
    `${ep.title} | 3D Space Music Video`,
    '',
    'DESCRIPTION',
    `${ep.title}: ${ep.subtitle}. A cinematic 3D journey through space where every cut, flash and explosion is timed to the music.`,
    '',
    ...(chapters.length >= 3 ? ['Chapters:', ...chapters.map((c) => `${mmss(c.start)} ${c.label}`), ''] : []),
    'Turn the sound up and go full screen. 🔔 Subscribe to Cosmic Pulse: the universe, in rhythm.',
    '',
    '#space #universe #spacemusic',
    '',
    'TAGS',
    tags.join(', '),
    '',
  ].join('\n');
}

// ---------- queue ----------
const ORDERS = {
  narrated: ['voice', 'plan', 'render', 'mix', 'qc'],
  music: ['analyze', 'musicplan', 'render', 'musicmix', 'qc', 'thumbnail'],
};

async function produce(file) {
  const ep = JSON.parse(fs.readFileSync(file, 'utf8'));
  const dir = path.join(ROOT, 'out', ep.id);
  fs.mkdirSync(dir, { recursive: true });
  const stateFile = path.join(dir, 'state.json');
  const ORDER = ORDERS[ep.mode ?? 'narrated'];
  let st = fs.existsSync(stateFile) && !OPTS.force ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { stage: ORDER[0] };
  // A changed episode or render settings invalidate everything from 'plan' on.
  const fingerprint = JSON.stringify([ep, OPTS.fps, OPTS.scale, OPTS.cap]);
  // Any change to the episode or render settings restarts from the first stage: a new
  // track needs a new beat analysis, new narration text needs new voice clips.
  if (st.fingerprint && st.fingerprint !== fingerprint) st.stage = ORDER[0];
  st.fingerprint = fingerprint;
  if (st.stage === 'done') { log(ep.id, 'already done'); exportVideo(ep, dir); return st; }
  for (let i = ORDER.indexOf(st.stage); i < ORDER.length; i++) {
    const stage = ORDER[i];
    log(ep.id, `stage ${stage}`);
    try {
      await STAGES[stage](ep, dir, st);
      st.stage = ORDER[i + 1] ?? 'done';
      delete st.error;
    } catch (e) {
      st.error = `${stage}: ${e.message}`;
      fs.writeFileSync(stateFile, JSON.stringify(st, null, 2));
      throw e;
    }
    fs.writeFileSync(stateFile, JSON.stringify(st, null, 2));
  }
  log(ep.id, `DONE -> out/${ep.id}/final.mp4 (${st.qc.duration}s)`);
  exportVideo(ep, dir);
  return st;
}

const files = fs.readdirSync(path.join(ROOT, 'episodes')).filter((f) => f.endsWith('.json') && f.includes(OPTS.only) && (!OPTS.ids || OPTS.ids.split(',').includes(f.slice(0, -5))))
  .filter((f) => !OPTS.format || JSON.parse(fs.readFileSync(path.join(ROOT, 'episodes', f), 'utf8')).format === OPTS.format).sort().slice(0, OPTS.limit);
let ok = 0, failed = 0;
for (const f of files) {
  try { await produce(path.join(ROOT, 'episodes', f)); ok++; }
  catch (e) { failed++; console.error(`FAILED ${f}: ${e.message}`); }
}
console.log(`\nfinished: ${ok} ok, ${failed} failed, ${files.length} total`);
process.exitCode = failed ? 1 : 0;
