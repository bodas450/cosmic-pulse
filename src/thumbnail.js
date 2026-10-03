// Branded YouTube thumbnail (1280x720): a frame from the video, the title, the channel mark.
//   node src/thumbnail.js <frame.png> "<Title>" <out.jpg>
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { serve } from './serve.js';

const ROOT = path.resolve(import.meta.dirname, '..');

// Pick the most thumbnail-worthy moment: sample one small frame per second and score
// colour, brightness and how much of the picture is "lit" (not black, not blown out).
export function bestFrameTime(video, { skipStart = 3, skipEnd = 3 } = {}) {
  const W = 64, H = 36;
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', video, '-vf', `fps=1,scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 28 });
  const buf = r.stdout, frameBytes = W * H * 3, n = Math.floor(buf.length / frameBytes);
  let best = { t: n / 2, score: -1 };
  for (let i = skipStart; i < n - skipEnd; i++) {
    let lit = 0, sat = 0, blown = 0;
    for (let p = i * frameBytes; p < (i + 1) * frameBytes; p += 3) {
      const R = buf[p], G = buf[p + 1], B = buf[p + 2], mx = Math.max(R, G, B), mn = Math.min(R, G, B);
      if (mx > 40) { lit++; sat += (mx - mn) / mx; }
      if (mn > 235) blown++;
    }
    const px = W * H, score = (lit / px) * (0.4 + sat / Math.max(1, lit)) - 3 * (blown / px);
    if (score > best.score) best = { t: i + 0.5, score };
  }
  return best.t;
}

export async function makeThumbnail(frame, title, out) {
  const rel = path.relative(ROOT, path.resolve(frame)).split(path.sep).join('/');
  if (rel.startsWith('..')) throw new Error(`thumbnail frame must be inside the project: ${frame}`);
  const { server, url } = await serve();
  const b = await chromium.launch();
  try {
    const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(`${url}/branding/thumbnail.html?img=${encodeURIComponent(`/${rel}`)}&title=${encodeURIComponent(title)}`);
    await page.waitForFunction(() => window.thumbReady === true);
    await page.screenshot({ path: out, type: 'jpeg', quality: 92 });
  } finally {
    await b.close();
    server.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [frame, title, out] = process.argv.slice(2);
  await makeThumbnail(frame, title, out);
  console.log(`wrote ${out}`);
}
