// Turns a music analysis + an ordered list of story beats into an edit:
//   - every cut lands on a bar line;
//   - quiet sections get long shots, loud sections get fast cuts;
//   - each story beat is one continuous simulation filmed from several camera shots;
//   - the "impact" beat (supernova / big bang) is placed so its flash hits the main drop;
//   - per-frame audio curves (pulse, energy, bright) are resampled to the video fps.

const IMPACT = new Set(['supernova', 'bigbang']);

const near = (arr, t) => arr.reduce((b, x) => (Math.abs(x - t) < Math.abs(b - t) ? x : b), arr[0]);

function resample(curve, rate, fps, frames) {
  const out = new Array(frames);
  for (let f = 0; f < frames; f++) {
    const x = (f / fps) * rate;
    const i = Math.min(curve.length - 1, Math.floor(x));
    const j = Math.min(curve.length - 1, i + 1);
    out[f] = +(curve[i] + (curve[j] - curve[i]) * (x - i)).toFixed(3);
  }
  return out;
}

function meanEnergy(a, from, to) {
  const s = Math.floor(from * a.rate), e = Math.max(s + 1, Math.floor(to * a.rate));
  let n = 0;
  for (let i = s; i < e && i < a.energy.length; i++) n += a.energy[i];
  return n / (e - s);
}

// Bars per shot as a function of section loudness.
function barsPerShot(energy, bar) {
  const target = energy > 0.65 ? 4 : energy > 0.35 ? 6 : 10; // seconds
  return Math.max(1, Math.round(target / bar));
}

// Camera variations for successive shots of the same beat: wide / close / low / high, new angles.
// Volumetric scenes (clouds, debris) turn to noise if the camera flies inside them: no close-ups.
const VOLUMETRIC = new Set(['nebula', 'supernova', 'planetarynebula', 'bigbang', 'galaxy']);

function shotCamera(base, k, energy, type) {
  const c = { dist: [90, 60], height: [20, 12], orbit: 0.05, start: 0, ...base };
  const framing = (VOLUMETRIC.has(type) ? [1.1, 1.3, 1.6, 1.2] : [1, 0.62, 1.35, 0.8])[k % 4];
  const heightMul = [1, 0.4, 1.8, -0.6][k % 4];
  const push = energy > 0.6 ? [1.15, 0.85] : [1.04, 0.96];
  const d = ((c.dist[0] + c.dist[1]) / 2) * framing;
  const h = ((c.height[0] + c.height[1]) / 2) * heightMul;
  return {
    dist: [d * push[0], d * push[1]],
    height: [h, h * 0.8],
    orbit: c.orbit * (0.6 + energy * 1.6) * (k % 2 ? -1 : 1),
    start: c.start + k * 1.37,
  };
}

// The main drop: the biggest contrast between the moment before and the hit after
// (a build that cuts to silence and then slams back in scores highest).
export function findMainDrop(a) {
  const contrast = (d) => meanEnergy(a, d, d + 4) - meanEnergy(a, Math.max(0, d - 1.5), d);
  return a.drops.length ? a.drops.reduce((b, d) => (contrast(d) > contrast(b) ? d : b), a.drops[0]) : null;
}

export function planMusicEdit(ep, a, fps) {
  const bar = a.downbeats.length > 1 ? a.downbeats[1] - a.downbeats[0] : (4 * 60) / a.bpm;
  const D = a.duration;
  const grid = a.downbeats.filter((t) => t > 0.5 && t < D - 0.5);

  // 1. Shots: walk sections between drops, cutting every N bars.
  const bounds = [0, ...a.drops.filter((d) => d > 1 && d < D - 1), D];
  const shots = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const [s, e] = [bounds[i], bounds[i + 1]];
    const n = barsPerShot(meanEnergy(a, s, e), bar);
    const lines = grid.filter((t) => t > s + 0.01 && t < e - 0.01);
    let last = s;
    lines.forEach((t, j) => {
      if ((j + 1) % n === 0 && t - last >= bar * 0.9 && e - t >= bar * 0.9) { shots.push([last, t]); last = t; }
    });
    shots.push([last, e]);
  }

  // 2. Main drop: the biggest contrast between the moment before and the hit after
  //    (a build that cuts to silence and then slams back in scores highest).
  const mainDrop = findMainDrop(a);

  // 3. Assign shots to story beats, in order, proportionally; pin the impact beat to the main drop.
  const beats = ep.scenes;
  // Pick the impact beat (supernova / big bang) whose place in the story is closest to where the
  // main drop falls in the track; if none is close, don't pin anything and spread beats evenly.
  const pickImpact = () => {
    if (mainDrop == null) return -1;
    let best = -1, bestDist = Infinity;
    beats.forEach((b, i) => {
      if (!IMPACT.has(b.type)) return;
      const dist = Math.abs(i / beats.length - mainDrop / D);
      if (dist < bestDist) { best = i; bestDist = dist; }
    });
    return bestDist <= 0.25 ? best : -1;
  };
  const impact0 = pickImpact();
  // Make sure every beat can get a shot: split the longest shot (on a bar line) until the
  // stretch before the main drop has enough shots for the beats before the impact, and the
  // whole edit has at least one shot per beat.
  const splitLongest = (from, to) => {
    let best = -1;
    shots.forEach(([s, e], k) => { if (s >= from - 0.01 && e <= to + 0.01 && (best < 0 || e - s > shots[best][1] - shots[best][0])) best = k; });
    if (best < 0) return false;
    const [s, e] = shots[best];
    const mid = grid.filter((t) => t > s + bar * 0.5 && t < e - bar * 0.5).reduce((m, t) => (m == null || Math.abs(t - (s + e) / 2) < Math.abs(m - (s + e) / 2) ? t : m), null);
    if (mid == null) return false;
    shots.splice(best, 1, [s, mid], [mid, e]);
    return true;
  };
  if (impact0 > 0 && mainDrop != null) {
    while (shots.filter(([s]) => s < mainDrop - 0.05).length < impact0 && splitLongest(0, mainDrop)) { /* split */ }
  }
  while (shots.length < beats.length && splitLongest(0, D)) { /* split */ }
  const S = shots.length, B = beats.length;
  const owner = shots.map((_, k) => Math.min(B - 1, Math.floor((k * B) / S)));
  const impact = impact0;
  if (impact > 0 && mainDrop != null) {
    const k0 = shots.findIndex(([s]) => Math.abs(s - mainDrop) < 0.05);
    if (k0 > 0) {
      const after = Math.max(1, Math.round(((S - k0) * 1) / Math.max(1, B - impact)));
      for (let k = 0; k < S; k++) {
        if (k < k0) owner[k] = Math.min(impact - 1, Math.floor((k * Math.max(1, impact)) / k0));
        else if (k < k0 + after) owner[k] = impact;
        else owner[k] = Math.min(B - 1, impact + 1 + Math.floor(((k - k0 - after) * Math.max(1, B - impact - 1)) / Math.max(1, S - k0 - after)));
      }
    }
  }

  // Story changes should land on drops: move the nearest beat change (within 2 shots) onto each drop.
  for (const d of a.drops) {
    const kd = shots.findIndex(([s]) => Math.abs(s - d) < 0.05);
    if (kd <= 0 || owner[kd] !== owner[kd - 1]) continue;
    for (const off of [1, -1, 2, -2]) {
      const k = kd + off;
      if (k <= 0 || k >= S) continue;
      if (owner[k] !== owner[k - 1]) {
        if (off > 0) for (let j = kd; j < k; j++) owner[j] = owner[k];
        else for (let j = k; j < kd; j++) owner[j] = owner[k - 1];
        break;
      }
    }
  }

  // 4. Build scenes: a beat spans its shots; supernova gets one bar of pre-collapse before the drop.
  const scenes = [];
  for (let b = 0; b < B; b++) {
    const mine = shots.map((s, k) => [s, k]).filter(([, k]) => owner[k] === b);
    if (!mine.length) continue;
    const start = mine[0][0][0], end = mine[mine.length - 1][0][1];
    const beat = beats[b];
    const params = { ...beat.params };
    if (beat.type === 'supernova') {
      const drop = mainDrop != null && Math.abs(start - mainDrop) < 0.05 ? mainDrop : near(a.drops.length ? a.drops : [start + bar], start + bar);
      params.flashAt = Math.min(0.5, Math.max(0.02, (drop - start) / (end - start)));
      params.flashLen = 1.5 / (end - start);
    }
    scenes.push({
      type: beat.type, label: beat.label, seed: beat.seed, params, start, duration: end - start, cues: [],
      shots: mine.map(([[s, e]], i) => ({ start: s - start, end: e - start, camera: shotCamera(beat.camera, i, meanEnergy(a, s, e), beat.type) })),
    });
  }
  // If the impact beat starts on the drop, steal one bar from the previous beat for the build-up.
  scenes.forEach((s, i) => {
    if (s.type === 'supernova' && i > 0 && Math.abs(s.start - mainDrop) < 0.05) {
      const prev = scenes[i - 1];
      if (prev.duration > bar * 2) {
        prev.duration -= bar; prev.shots[prev.shots.length - 1].end -= bar;
        s.start -= bar; s.duration += bar;
        s.shots.forEach((sh, j) => { if (j > 0) { sh.start += bar; } sh.end += bar; });
        s.shots[0].start = 0;
        s.params.flashAt = bar / s.duration;
        s.params.flashLen = 1.5 / s.duration;
      }
    }
  });

  const frames = Math.ceil(D * fps);
  return {
    duration: D,
    scenes,
    drops: a.drops,
    mainDrop,
    bpm: a.bpm,
    audio: {
      pulse: resample(a.pulse, a.rate, fps, frames),
      energy: resample(a.energy, a.rate, fps, frames),
      bright: resample(a.bright, a.rate, fps, frames),
    },
  };
}
