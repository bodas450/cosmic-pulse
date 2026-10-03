// Narration stage. Uses edge-tts (pip install edge-tts) when reachable; otherwise
// falls back to silence timed at a natural reading pace so the rest of the
// pipeline (captions, timing, render) still works offline.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

export const VOICE = process.env.SF_VOICE || 'en-US-AndrewNeural';
const CHARS_PER_SEC = 15;

export function probeDuration(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim();
  return Number(out);
}

export function synthesize(text, file) {
  if (process.env.SF_TTS !== 'off') {
    try {
      execFileSync('python3', ['-m', 'edge_tts', '--voice', VOICE, '--rate', process.env.SF_RATE || '-5%', '--text', text, '--write-media', file], { stdio: 'pipe', timeout: 60000 });
      if (fs.statSync(file).size > 1000) return { file, duration: probeDuration(file), tts: true };
    } catch { /* fall through to silence */ }
  }
  const duration = Math.max(2, text.length / CHARS_PER_SEC);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', duration.toFixed(2), '-c:a', 'libmp3lame', file]);
  return { file, duration, tts: false };
}

// Split narration into caption cues sized for the screen, timed by length.
export function cues(text, offset, duration, maxWords = 9) {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks = [];
  for (let i = 0; i < words.length; i += maxWords) chunks.push(words.slice(i, i + maxWords).join(' '));
  const total = chunks.reduce((n, c) => n + c.length, 0);
  let at = offset;
  return chunks.map((c) => {
    const len = (c.length / total) * duration;
    const q = { from: +at.toFixed(3), to: +(at + len).toFixed(3), text: c };
    at += len;
    return q;
  });
}
