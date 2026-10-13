// The Radio's lyrics: written on the spot from a concept's seed, so every
// song gets its own words and title. No model: phrase banks and line
// patterns per language, a chorus hook that repeats, YuE2's section format.
//
//   Mandarin   YuE2's own first language: images and feelings in two-part
//              lines, the way the model's example song is written
//   English    short singable lines from patterns over word banks
//   wordless   vocalise (ooh / ah / la / na): the voice as an instrument

import { rngFrom } from "./concepts.js";

const pick = (rng, list) => list[Math.floor(rng() * list.length) % list.length];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ── Mandarin ────────────────────────────────────────────────────────────────
const ZH_IMAGE = ['晚风', '月光', '街灯', '海浪', '雨夜', '星空', '霓虹', '列车', '窗台', '旧梦', '烟火', '远方',
                  '黄昏', '清晨', '云朵', '花火', '河流', '山谷', '灯塔', '雪花', '心跳', '影子', '钟声', '气泡',
                  '唱片', '晚霞', '海风', '路口', '车站', '天空'];
const ZH_MOTION = ['轻轻吹过', '慢慢亮起', '不停闪烁', '悄悄落下', '一路向前', '缓缓流淌', '静静等待', '随风飘远',
                   '在跳舞', '在歌唱', '穿过人海', '划破寂静', '点亮夜晚', '染红天边', '翻过山丘', '回到身边'];
const ZH_FEEL = ['想念你', '不说再见', '心在跳动', '为你停留', '自由飞翔', '不再害怕', '把心打开', '快乐无限',
                 '永远记得', '等你回来', '一起出发', '别再犹豫', '跟着节拍', '直到天亮', '爱在发光', '梦在燃烧'];
const ZH_PLACE = ['城市', '海边', '街角', '屋顶', '车窗', '心里', '夜空', '远方', '人群', '路上'];

function zhLine(rng) {
    switch (Math.floor(rng() * 4)) {
        case 0: return pick(rng, ZH_IMAGE) + pick(rng, ZH_MOTION) + ' ' + pick(rng, ZH_FEEL);
        case 1: return pick(rng, ZH_PLACE) + '的' + pick(rng, ZH_IMAGE) + ' ' + pick(rng, ZH_MOTION);
        case 2: return pick(rng, ZH_IMAGE) + '和' + pick(rng, ZH_IMAGE) + ' ' + pick(rng, ZH_FEEL);
        default: return '在' + pick(rng, ZH_PLACE) + pick(rng, ZH_MOTION) + ' ' + pick(rng, ZH_IMAGE) + pick(rng, ZH_MOTION);
    }
}
function zhHook(rng) {
    const a = pick(rng, ZH_FEEL), b = pick(rng, ZH_IMAGE);
    const suffix = pick(rng, ['之歌', '', '夜', '时光', '旅程']);
    return { title: b.endsWith(suffix) ? b : b + suffix, lines: [
        a + ' ' + a, b + pick(rng, ZH_MOTION) + ' ' + pick(rng, ZH_FEEL),
        pick(rng, ZH_FEEL) + ' ' + pick(rng, ZH_FEEL), a + ' ' + b + pick(rng, ZH_MOTION)] };
}

// ── English ─────────────────────────────────────────────────────────────────
const EN_NOUN = ['river', 'city', 'window', 'highway', 'ocean', 'heartbeat', 'shadow', 'signal', 'morning', 'midnight',
                 'mirror', 'harbor', 'thunder', 'wildfire', 'satellite', 'garden', 'skyline', 'echo', 'lantern', 'compass',
                 'summer', 'winter', 'stranger', 'feather', 'neon', 'engine', 'sparrow', 'canyon', 'radio', 'paper moon'];
const EN_ADJ = ['golden', 'quiet', 'electric', 'broken', 'silver', 'restless', 'gentle', 'wild', 'hollow', 'burning',
                'distant', 'velvet', 'endless', 'brand new', 'faded', 'shining', 'lonely', 'fearless', 'midnight', 'crimson'];
const EN_VERB = ['running', 'falling', 'shining', 'calling', 'dancing', 'turning', 'drifting', 'burning', 'waiting', 'singing',
                 'flying', 'breaking', 'holding on', 'letting go', 'coming home', 'chasing light'];
const EN_TIME = ['the night', 'the morning', 'the rain', 'the dark', 'the summer', 'the storm', 'the dawn', 'the years'];
const EN_PATTERNS = [
    (r) => cap(pick(r, EN_ADJ)) + ' ' + pick(r, EN_NOUN) + ' in ' + pick(r, EN_TIME),
    (r) => 'I keep ' + pick(r, EN_VERB) + ' through ' + pick(r, EN_TIME),
    (r) => 'Every ' + pick(r, EN_NOUN) + ' is ' + pick(r, EN_VERB) + ' your name',
    (r) => 'We were ' + pick(r, EN_ADJ) + ', we were ' + pick(r, EN_VERB),
    (r) => cap(pick(r, EN_NOUN)) + ' on the ' + pick(r, EN_NOUN) + ', ' + pick(r, EN_ADJ) + ' and slow',
    (r) => 'Under the ' + pick(r, EN_ADJ) + ' ' + pick(r, EN_NOUN) + ' light',
    (r) => 'Hold me like ' + pick(r, EN_TIME) + ' never ends',
    (r) => 'All of the ' + pick(r, EN_NOUN) + 's ' + pick(r, EN_VERB) + ' tonight',
    (r) => 'Tell me the ' + pick(r, EN_NOUN) + ' still remembers',
    (r) => 'Down by the ' + pick(r, EN_NOUN) + ' where the ' + pick(r, EN_NOUN) + 's go',
];
// A pattern does not come twice in a row.
let lastPattern = -1;
function enLine(rng) {
    let i = Math.floor(rng() * EN_PATTERNS.length) % EN_PATTERNS.length;
    if (i === lastPattern) i = (i + 1) % EN_PATTERNS.length;
    lastPattern = i;
    return EN_PATTERNS[i](rng);
}
function enHook(rng) {
    const adj = pick(rng, EN_ADJ), noun = pick(rng, EN_NOUN), verb = pick(rng, EN_VERB);
    const hook = cap(adj) + ' ' + noun;
    return { title: hook.split(' ').map(cap).join(' '), lines: [
        hook + ', ' + adj + ' ' + noun, 'Keep on ' + verb + ' till ' + pick(rng, EN_TIME) + ' is gone',
        hook + ', carry me on', 'We were ' + verb + ', ' + adj + ' ' + noun] };
}

// ── wordless ────────────────────────────────────────────────────────────────
const SYL = ['ooh', 'ah', 'la', 'na', 'oh', 'mm', 'da', 'yeah', 'hey', 'whoa'];
function syllables(rng, n, word) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(word || pick(rng, SYL));
    return out.join(' ');
}
function woLine(rng) {
    const w = pick(rng, SYL);
    return cap(syllables(rng, 2 + Math.floor(rng() * 3), w)) + ', ' + syllables(rng, 2 + Math.floor(rng() * 3), pick(rng, SYL));
}
function woHook(rng) {
    const a = pick(rng, SYL), b = pick(rng, SYL);
    return { title: cap(pick(rng, EN_ADJ)) + ' ' + cap(pick(rng, EN_NOUN)), lines: [
        cap(syllables(rng, 4, a)), cap(syllables(rng, 3, b)) + ', ' + a + ' ' + a,
        cap(syllables(rng, 4, a)), cap(b) + ' ' + b + ', ' + syllables(rng, 3, a)] };
}

const WRITERS = {
    Mandarin: { line: zhLine, hook: zhHook },
    English: { line: enLine, hook: enHook },
    wordless: { line: woLine, hook: woHook },
};

/**
 * Lyrics for a concept in `language` (one of LANGUAGES): { title, lyrics },
 * from the concept's seed and shape. The chorus repeats one hook; every
 * other sung line is fresh.
 */
export function writeLyrics(c, language) {
    const w = WRITERS[language] || WRITERS.English;
    const rng = rngFrom((c.seed ^ 0x5bd1e995) >>> 0);
    lastPattern = -1;
    const hook = w.hook(rng);
    const lines = { 'Verse': 4, 'Pre-Chorus': 2, 'Bridge': 2 };
    const pre = [w.line(rng), w.line(rng)];
    const blocks = ['[Intro]\n'];
    for (const tag of c.shape) {
        let body;
        if (tag === 'Chorus') body = hook.lines;
        else if (tag === 'Pre-Chorus') body = pre;
        else if (lines[tag]) body = Array.from({ length: lines[tag] }, () => w.line(rng));
        else body = [];
        blocks.push('[' + tag + ']\n' + body.map((l) => l + '\n').join(''));
    }
    blocks.push('[Outro]\n');
    return { title: hook.title, lyrics: blocks.join('\n') };
}
