# Музика: де брати, які вимоги, готові промпти

Музика — це половина відео. Монтаж будується під неї автоматично: склейки ставляться на такти, вибухи на дропи. **Кожне відео має власний трек.** Один трек на два відео не ставимо.

## Вимоги до треку

| Що | Як має бути |
|---|---|
| Довжина | 2.5–4 хвилини |
| Вокал | без вокалу (instrumental) |
| Ритм | чітка бочка (kick), темп 90–130 BPM |
| Структура | тихий вступ → розгін → дроп → спад → розгін → **пауза → великий дроп** → затихання |
| Формат | mp3, wav, m4a, flac або ogg |
| Права | лише музика, на яку в каналу є права (див. нижче) |

Чим чіткіша структура (особливо пауза перед великим дропом), тим ефектніший монтаж: вибух наднової або Великий вибух потрапляє саме на цей дроп.

## Звідки брати (тільки ці джерела)

1. **vidIQ → Generate music.** Генерується з акаунта каналу, 25 кредитів за трек. **Тільки з погодження власника.** Готові промпти нижче.
2. **YouTube Audio Library** (studio.youtube.com → Audio Library). Безкоштовно. Фільтри: Cinematic або Electronic, тривалість 2:30–4:00. Якщо в треку вказано «Attribution required», скопіюй рядок атрибуції в опис відео.
3. **Suno / Udio на платному плані власника.** Ці самі промпти теж працюють.

**Не можна:** музика з чужих відео на YouTube, «no copyright» збірки невідомого походження, треки з TikTok чи Spotify. Через них прилітає Content ID claim і пропадає монетизація.

## Як додати трек

Поклади файл у `music/inbox/` (назва файлу будь-яка) і запусти `npm run daily`. Програма сама призначить трек наступній темі з черги й перейменує файл.

## Шаблон промпту

```
[жанр/стиль], instrumental, [темп] BPM with a clear steady kick drum.
[настрій вступу] intro with [інструменти], build with [що наростає],
first big drop with [бас/ударні], [енергійна частина],
quiet breakdown with [м'які інструменти], rising build ending in a brief silence,
huge final drop with [найпотужніше], [як закінчується] outro.
```
Тривалість у генераторі: **180 секунд**.

## Готові промпти (перевірені, з них зроблено музику каналу)

Під кожну тему бери жанр за настроєм: народження — світле, смерть зірок — епічне або темне, чорні діри — темне, планети — тепле.

**Epic cinematic electronic (універсальний):**
> Cinematic epic space electronic, instrumental, 120 BPM with a clear steady kick drum. Structure: 30-second calm atmospheric intro with soft pads and distant pulses; 30-second build with rising synth arpeggios and growing drums; first powerful drop with deep bass and big cinematic hits; driving energetic section; short quiet breakdown with only pads; second tense build-up ending in a brief moment of silence; huge final drop, the most intense and epic part with heavy bass, orchestral hits and choir pads; then a slow fading ambient outro.

**Оркестр + електроніка (Великий вибух, галактики):**
> Epic cinematic orchestral electronic, instrumental, 110 BPM with a strong clear kick drum. Starts in near silence with a deep low rumble and slow swelling strings, builds with timpani and pulsing synth bass, first big drop with massive orchestral hits and heavy drums, energetic driving section, quiet breakdown with soft piano and pads, long rising build with snare roll ending in a moment of silence, then a huge triumphant final drop with choir, brass and heavy bass, ending with a gentle warm fading outro.

**Теплий ambient (Сонце, Земля, життя):**
> Warm melancholic ambient electronic, instrumental, 100 BPM with a soft but clear kick drum. Gentle glowing intro with warm pads and slow arpeggios, steady build with plucked synths and light percussion, first emotional drop with deep bass and wide synth chords, flowing mid section, tender breakdown with only pads and a soft melody, rising build ending in a brief silence, powerful bittersweet final drop with big drums and soaring lead synth, slowly dimming outro.

**Світлий ethereal (перші зірки, туманності):**
> Ethereal cinematic ambient electronic, instrumental, 105 BPM with a soft clear kick drum. Dawn-like intro with shimmering pads and slow glowing arpeggios, gentle build with growing percussion, first luminous drop with warm bass and bright synth chords, flowing section, delicate breakdown with bells and pads, rising build ending in a short silence, radiant final drop with big drums, strings and soaring synth, slow shimmering outro.

**Темний меланхолійний (кінець Всесвіту):**
> Dark melancholic cinematic electronic, instrumental, 95 BPM with a deep clear kick drum. Cold lonely intro with low drones and sparse piano, slow build with deep pulses and soft percussion, first heavy emotional drop with sub bass and wide dark chords, haunting section, near-silent breakdown with distant echoes, tense build ending in silence, massive final drop with heavy drums, choir pads and deep bass, fading into a cold empty drone.

**Епічний трейлер з брасом (наднові, золото):**
> Powerful epic trailer electronic with golden brass, instrumental, 125 BPM with a punchy clear kick drum. Tense intro with ticking clock percussion and low strings, build with rising brass and pulsing synth bass, first explosive drop with big brass hits and heavy drums, energetic section, short quiet breakdown with soft strings, huge build with snare roll ending in silence, triumphant final drop with full orchestra, choir and heavy bass, majestic outro.

**Темний горор-трейлер (чорні діри):**
> Intense dark cinematic horror electronic, instrumental, 90 BPM half-time with a deep heavy kick drum. Unsettling intro with deep sub rumble and warped sounds like time stretching, slow build with heartbeat drums and rising dissonant strings, first crushing drop with massive sub bass and impacts, ominous section, eerie breakdown with reversed sounds, extreme build ending in total silence, apocalyptic final drop with the heaviest bass, distorted brass and booms, collapsing into silence.

**Індастріал синтвейв (нейтронні зірки, пульсари):**
> Cold mechanical dark synthwave with industrial percussion, instrumental, 128 BPM with a hard clear kick drum. Eerie intro with radio static, metallic pings and a steady pulse like a pulsar, build with arpeggiated bass and driving hi-hats, first hard drop with distorted bass and big snares, relentless section, ghostly breakdown with pulsing beeps only, intense build ending in silence, crushing final drop with the heaviest bass and industrial hits, fading pulsar beeps outro.

**Drum and bass (зіткнення галактик, динаміка):**
> Massive cinematic drum and bass with orchestral elements, instrumental, 172 BPM with clear fast breakbeats. Atmospheric intro with wide pads and a slow heartbeat kick, build with rising strings and filtered drums, first big drop with rolling breakbeats and deep reese bass, intense section, airy breakdown with pads only, long rising build ending in a moment of silence, colossal final drop with full drums, bass and orchestral hits, fading outro.

**Світлий з піаніно (Сонячна система, планети):**
> Bright wonder-filled cinematic electronic with piano, instrumental, 112 BPM with a clear steady kick drum. Gentle intro with soft piano and sparkling synths, build with plucked arpeggios and growing drums, first uplifting drop with warm bass and bright chords, playful energetic section, calm breakdown with solo piano, rising build ending in a short silence, joyful final drop with big drums, strings and lead synth, gentle twinkling outro.

**Chillwave / melodic house (зоряні ясла, спокійні теми):**
> Dreamy chillwave and melodic house, instrumental, 122 BPM with a clear four-on-the-floor kick drum. Soft hazy intro with warm pads and vocal-like synth textures, build with plucks and claps, first warm drop with groovy bass and lush chords, flowing dance section, gentle breakdown with pads and a soft melody, rising build ending in a short silence, euphoric final drop with full groove and soaring synths, soft dreamy outro.

**Прогресив-транс (огляди всього Всесвіту):**
> Epic progressive cinematic trance, instrumental, 130 BPM with a clear driving kick drum. Cosmic intro with deep space pads and a slow rising pulse, build with rolling bassline and arpeggios, first big drop with driving bass and supersaw chords, energetic section, emotional breakdown with pads and a beautiful melody, long rising build ending in a brief silence, massive euphoric final drop with full supersaws, big drums and orchestral hits, fading cosmic outro.

Генератор інколи видає збій. Це нормально: у vidIQ кредити за невдалу генерацію повертаються. Просто запусти той самий промпт ще раз.
