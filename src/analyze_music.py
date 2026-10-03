"""Music analysis for beat-synced edits.

Usage: python3 src/analyze_music.py <track.wav|mp3> <out.json>

Produces everything the planner and renderer need to make the picture follow the music:
  bpm, beats, downbeats (bar starts), drops (big energy jumps, snapped to a bar),
  and per-frame curves at RATE Hz: energy (loudness, 0..1), pulse (kick/bass hits, 0..1),
  bright (high-frequency shimmer, 0..1).
"""
import json
import sys

import librosa
import numpy as np

RATE = 60  # curve samples per second; the renderer resamples to its own fps


def norm(x):
    x = np.asarray(x, dtype=float)
    lo, hi = np.percentile(x, 2), np.percentile(x, 98)
    return np.clip((x - lo) / max(hi - lo, 1e-9), 0, 1)


def resample(curve, src_times, duration):
    t = np.arange(0, duration, 1 / RATE)
    return np.interp(t, src_times, curve)


def main(path, out):
    y, sr = librosa.load(path, sr=22050, mono=True)
    duration = len(y) / sr
    hop = 256

    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, hop_length=hop, units="frames")
    beats = librosa.frames_to_time(beat_frames, sr=sr, hop_length=hop)
    bpm = float(np.atleast_1d(tempo)[0])

    # Kick/bass pulse: onset strength in the low mel bands, with a fast attack/slow decay.
    mel = librosa.feature.melspectrogram(y=y, sr=sr, hop_length=hop, n_mels=64, fmax=8000)
    low = librosa.onset.onset_strength(S=librosa.power_to_db(mel[:8]), sr=sr, hop_length=hop)
    high = librosa.onset.onset_strength(S=librosa.power_to_db(mel[40:]), sr=sr, hop_length=hop)
    times = librosa.frames_to_time(np.arange(len(low)), sr=sr, hop_length=hop)

    def envelope(x, decay):
        x = norm(x)
        out_, v = np.zeros_like(x), 0.0
        for i, s in enumerate(x):
            v = max(s, v * decay)
            out_[i] = v
        return out_

    pulse = envelope(low, 0.88)
    bright = envelope(high, 0.92)

    # Loudness envelope, smoothed over ~1 s so it reads as "section energy".
    rms = librosa.feature.rms(y=y, hop_length=hop)[0]
    rms_t = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop)
    win = max(1, int(sr / hop))
    energy = norm(np.convolve(rms, np.ones(win) / win, mode="same"))

    # Downbeats: pick the beat phase (0..3) whose beats carry the most low-end punch.
    if len(beats) >= 8:
        strength = np.interp(beats, times, norm(low))
        phase = int(np.argmax([strength[k::4].mean() for k in range(4)]))
        downbeats = beats[phase::4]
    else:
        downbeats = beats
    # Ambient intros/outros have no detectable beats: extend the bar grid at the
    # detected tempo so cuts and drops can still land on bar lines there.
    bar = 4 * 60 / bpm if bpm > 0 else 2.0
    if len(downbeats):
        before = np.arange(downbeats[0] - bar, -1e-6, -bar)[::-1]
        after = np.arange(downbeats[-1] + bar, duration, bar)
        downbeats = np.concatenate([before, downbeats, after])
    else:
        downbeats = np.arange(0, duration, bar)

    # Drops: the biggest rises in 2-second energy, at least 8 s apart, snapped to the nearest bar.
    e2 = np.interp(np.arange(0, duration, 0.1), rms_t, energy)
    k = 20
    rise = np.array([e2[i + k // 2 : i + k].mean() - e2[max(0, i - k // 2) : i].mean() if i > 0 else 0 for i in range(len(e2) - k)])
    drops = []
    for i in np.argsort(-rise):
        if rise[i] < 0.25 or len(drops) >= 4:
            break
        t = i * 0.1
        if t < 3:  # the track starting is not a drop
            continue
        if all(abs(t - d) > 8 for d in drops):
            drops.append(t)
    if len(downbeats):
        drops = sorted({float(downbeats[np.argmin(np.abs(downbeats - d))]) for d in drops})

    result = {
        "file": path,
        "duration": round(duration, 3),
        "bpm": round(bpm, 2),
        "beats": [round(float(b), 3) for b in beats],
        "downbeats": [round(float(b), 3) for b in downbeats],
        "drops": [round(d, 3) for d in drops],
        "rate": RATE,
        "energy": [round(float(v), 3) for v in resample(energy, rms_t, duration)],
        "pulse": [round(float(v), 3) for v in resample(pulse, times, duration)],
        "bright": [round(float(v), 3) for v in resample(bright, times, duration)],
    }
    with open(out, "w") as f:
        json.dump(result, f)
    print(f"{path}: {duration:.1f}s, {bpm:.1f} BPM, {len(beats)} beats, {len(downbeats)} bars, drops at {result['drops']}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
