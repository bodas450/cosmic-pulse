# Cosmic Pulse

> Running the channel day to day? Start with **WORKER.md** (operator manual, Ukrainian) and `ops/`.

A conveyor for mass-producing 3D space explainer videos in English: how stars,
planets and galaxies form, the life cycle of the Sun, black holes, and so on.

```
catalog/topics.js ──► episodes/*.json ──► voice ──► plan ──► render ──► mix ──► qc ──► out/<id>/final.mp4
 (15 topics)           (long + Shorts)    (TTS)    (timing)  (three.js  (voice +  (duration,
                                                             + Chromium  drone +   black frames,
                                                             + ffmpeg)   loudnorm) loudness)
```

- **15 topics → 90 videos**: each topic becomes one 16:9 long video plus one 9:16 Short per beat.
- **Deterministic rendering**: every frame is a pure function of time, so a render can be retried,
  split across workers, and always comes out the same.
- **Resumable queue**: each episode keeps `out/<id>/state.json`. Kill it at any point and rerun:
  it continues from the stage that failed. Changing an episode re-renders only what's affected.
- **Automatic QC**: a video with the wrong duration, black frames or no sound is marked failed, not shipped.

## Music mode (no narration)

The soundtrack drives the edit instead of a voice:

```
music/<track> ──► analyze ──► musicplan ──► render ──► musicmix ──► qc
                  (BPM, bars,   (cuts on bars,  (light & camera   (track, fades,
                   drops, kick   impact on the   pulse on the      -14 LUFS)
                   & energy)     main drop)      kick)
```

- `src/analyze_music.py` (librosa) finds the tempo, bar lines, **drops** (big energy jumps, snapped
  to a bar), and per-frame curves: `pulse` (kick/bass hits), `energy` (section loudness), `bright` (hi-hats/shimmer).
  Ambient intros without drums still get a bar grid, extended at the detected tempo.
- `src/music-plan.js` builds the edit:
  - every cut is on a bar line; quiet sections hold shots for ~10 s, loud ones cut every ~4 s;
  - each story beat is one continuous simulation filmed from several shots (wide / close / low / high);
  - story changes snap to drops;
  - the impact beat (supernova) gets one bar of collapse before the **main drop** (the biggest
    before/after contrast — e.g. a build that cuts to silence and slams back in), so the explosion lands on it.
- The renderer pulses glows, particle size, exposure and camera distance with the kick, and flashes on every drop.

```bash
# put tracks in music/ (mp3/wav/m4a/flac/ogg), then:
npm run episodes                                   # adds <topic>-music episodes, tracks assigned round-robin
node src/pipeline.js --format music                # one music video per topic
node src/pipeline.js --format compilation --scale 1.3333 --export ~/Downloads/"Cosmic Pulse"
                                                   # 3-4 min compilations in 2K (2560x1440), copied to Downloads
node src/snapshot.js out/<id>/plan.json /tmp/f 42.1 60   # render single frames to check timing
```

Pin a track to a topic with `music: 'music/<file>'` in `catalog/topics.js`. Video length = track length.
Use tracks you have the rights to: YouTube Audio Library, your own, or generated ones
(the included `music/epic-space-01.mp3` was generated with vidIQ's music generator).
Tracks with a clear structure (intro → build → drop → outro) give the best edits.

## Setup

```bash
npm install
pip install edge-tts librosa  # narration voice (narrated mode) / beat analysis (music mode)
# ffmpeg must be on PATH; Playwright needs Chromium (npx playwright install chromium)
```

## Run

```bash
npm run episodes                                    # catalog -> episodes/*.json (90 files)
node src/pipeline.js --format long                  # 15 long videos, 1080p30
node src/pipeline.js --format short                 # 75 Shorts, 1080x1920
node src/pipeline.js --only black-hole --scale 0.5 --cap 4 --fps 12   # quick preview
npm run preview                                     # open the renderer in a browser
```

| Option | Meaning |
|---|---|
| `--format long\|short\|music` | Pick the format |
| `--only <text>` | Only episodes whose id contains the text |
| `--limit <n>` | At most n episodes |
| `--workers <n>` | Parallel Chromium renderers per video (default: CPUs-1, max 4) |
| `--scale <k>` | Resolution multiplier (0.6667 = 720p) |
| `--fps <n>` | Frame rate (default 30) |
| `--cap <sec>` | Cap scene length for previews |
| `--force` | Rebuild from scratch |
| `--ids <a,b>` | Exactly these episode ids |
| `--export <folder>` | Copy each finished video (and thumbnail) there, named by its title; `~` works. Also `SF_EXPORT` |

Environment: `SF_VOICE` (any edge-tts voice, e.g. `en-GB-RyanNeural`), `SF_RATE` (e.g. `-5%`),
`SF_TTS=off` to skip TTS. If TTS is unreachable, narration falls back to silence timed at
reading pace, and captions still appear.

Output per episode: `final.mp4`, `thumb.jpg`, `plan.json` (timing, captions), `state.json` (QC report).

## Adding content

Add a topic to `catalog/topics.js`: a title plus 4–6 beats, each with a scene `type`,
a `label`, the narration `text`, optional `params` and `camera`. Available scene types
(`renderer/scenes.js`):

| type | What it shows | Key params |
|---|---|---|
| `bigbang` | Hot expanding universe cooling | – |
| `nebula` | Gas cloud, optionally collapsing into clumps | `palette`, `collapse` 0..1 |
| `protostar` | Infalling spiral disk with polar jets | `color` |
| `star` | Star surface with granulation and flares; can grow and change colour | `color`, `radius`, `growTo`, `colorTo`, `flares` |
| `planetformation` | Dust disk clumping into planets | `planets` |
| `planet` | Rocky / gas planet, molten option, rings | `kind`, `colorA`, `colorB`, `molten`, `ring` |
| `planetarynebula` | Shell blown off around a white dwarf | `palette` |
| `supernova` | Collapse, flash, expanding debris | `remnant` |
| `blackhole` | Accretion disk, lensed ring, shadow | `color` |
| `galaxy` | Spiral galaxy, optionally forming from chaos | `arms`, `twist`, `palette`, `form` |

`camera`: `dist: [from, to]`, `height: [from, to]`, `orbit` (rad/s) — the camera dollies while orbiting.

`npm run episodes -- --variants 3` produces 3 visually different long versions of each topic
(different seeds, palettes, camera angles).

## Repositories worth borrowing from

None of these were built for video; all can be driven the same way (deterministic time → frames):

| Repo | Use for |
|---|---|
| [hyqzz/Solar-Wanderer](https://github.com/hyqzz/Solar-Wanderer) | Real-scale Solar System with NASA JPL ephemeris: "where is Voyager now"-type videos |
| [MisterPrada/singularity](https://github.com/MisterPrada/singularity) | Ray-marched black hole with real lensing (three.js TSL): upgrade for `blackhole` |
| [dgreenheck/threejs-procedural-planets](https://github.com/dgreenheck/threejs-procedural-planets) | Better procedural planets: upgrade for `planet` |
| [ZyFou/ProceduralTerrains](https://github.com/ZyFou/ProceduralTerrains) | Planet surfaces, flyovers, clouds |
| [zjoooooo/galaxy-explorer](https://github.com/zjoooooo/galaxy-explorer) | Procedural Milky Way (MIT, no build step) |
| [andrewdcampbell/galaxy-sim](https://github.com/andrewdcampbell/galaxy-sim) | Real N-body galaxy formation / collisions in WebGL |
| [vasturiano/globe.gl](https://github.com/vasturiano/globe.gl) | Earth from space with data |
| [pavelsevecek/OpenSPH](https://github.com/pavelsevecek/OpenSPH) | Physically simulated impacts (Moon formation) — offline, export frames |

## Rendering speed

Rendering runs in headless Chromium. Without a GPU (SwiftShader), expect roughly 2–6 frames/s per
worker at 720p. On a machine with a GPU, drop the `--use-angle=swiftshader` flag in `renderChunk`
for a large speed-up.
