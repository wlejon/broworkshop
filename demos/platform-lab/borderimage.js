// borderimage.js — CSS border-image (Backgrounds-3 §6) nine-slice borders.
//
// border-image is the one feature in this lab with no JS API at all: it is pure
// cascade + paint. That makes it the hardest to demonstrate honestly, because
// "it looks like a fancy frame" is not evidence. Two things make it verifiable:
//
//   1. The SHORTHAND. `border-image: url(x) 16 fill / 20px / 6 round space` is
//      a genuinely gnarly grammar — source, slice, width, outset and repeat in
//      a slash-separated soup where the token classes disambiguate position.
//      The panel reads back all five longhands through getComputedStyle for
//      every sample, so the expansion is inspectable rather than assumed.
//   2. The FIXTURE. assets/nine.png is 48×48 of nine flat 16×16 blocks in nine
//      distinct colours (see tools/make_frames.js). With `slice: 16` each block
//      is exactly one region, so a pixel read at a known corner tells you
//      which slice the painter put there. The smoke test does exactly that
//      with getPixel(); the panel just makes it visible.
//
// The samples are laid out at FIXED sizes and positions so those pixel reads
// have stable coordinates — a flow-relative layout would make the test
// fragile for no benefit.

export const biState = {
    samples: [],       // [{ id, label, longhands }]
    expansions: 0,
    log: [],
};

// The nine fixture region colours, mirrored from tools/make_frames.js. The
// panel uses them to name what it painted; the test uses them to assert it.
export const REGION_COLORS = {
    tl: [255, 32, 32],   tc: [255, 176, 32],  tr: [248, 240, 48],
    ml: [32, 200, 96],   mc: [40, 44, 60],    mr: [48, 168, 255],
    bl: [128, 64, 224],  bc: [232, 48, 200],  br: [255, 255, 255],
};

// Every sample declares its border-image with the SHORTHAND, never longhands.
// That is deliberate: the longhand path is trivially correct, and the shorthand
// expander is where the interesting parsing lives.
const SAMPLES = [
    {
        id: 'biStretch',
        label: 'stretch (default)',
        css: 'url(assets/nine.png) 16 / 24px / 0 stretch',
        note: 'Corners land 1:1 in their 24px boxes; edges stretch along their run.',
    },
    {
        id: 'biRepeat',
        label: 'repeat',
        css: 'url(assets/nine-striped.png) 16 / 24px / 0 repeat',
        note: 'Edge slice tiled at natural size and CENTERED, so the run starts and ends mid-tile.',
    },
    {
        id: 'biRound',
        label: 'round',
        css: 'url(assets/nine-striped.png) 16 / 24px / 0 round',
        note: 'Tile scaled so a whole number fits — no partial tiles at the ends.',
    },
    {
        id: 'biSpace',
        label: 'space',
        css: 'url(assets/nine-striped.png) 16 / 24px / 0 space',
        note: 'Whole tiles only, leftover distributed as GAPS between them.',
    },
    {
        id: 'biFill',
        label: 'slice + fill',
        css: 'url(assets/nine.png) 16 fill / 24px / 0 stretch',
        note: '`fill` paints the middle region too — without it the centre is left alone.',
    },
    {
        id: 'biOutset',
        label: 'outset 8px',
        css: 'url(assets/nine.png) 16 / 20px / 8px stretch',
        note: 'Paint area grows OUTSIDE the border box; layout and hit-testing are untouched.',
    },
    {
        id: 'biPercentSlice',
        label: 'percentage slice',
        css: 'url(assets/nine.png) 33.333% / 24px / 0 stretch',
        note: '33.333% of 48px = 16px — the same nine regions expressed relatively.',
    },
    {
        id: 'biAsymmetric',
        label: 'asymmetric width',
        css: 'url(assets/nine.png) 16 / 40px 12px 8px 28px / 0 stretch',
        note: 'Four-value border-image-width in top/right/bottom/left order.',
    },
    {
        id: 'biMixedRepeat',
        label: 'round + space',
        css: 'url(assets/nine-striped.png) 16 / 24px / 0 round space',
        note: 'Two-value repeat: first is horizontal (top/bottom edges), second vertical.',
    },
    {
        id: 'biOverlapSlice',
        label: 'over-large slice',
        css: 'url(assets/nine.png) 40 / 24px / 0 stretch',
        note: 'Opposite slices (40+40 > 48) cover the image — edges and middle clamp empty, corners survive.',
    },
    {
        id: 'biGradient',
        label: 'gradient source (fallback)',
        css: 'linear-gradient(45deg, #f0f, #0ff) 16 / 24px / 0 stretch',
        note: 'Gradient sources are not sampled per-region; the element falls back to its NORMAL border.',
    },
    {
        id: 'biMissing',
        label: 'missing file (fallback)',
        css: 'url(assets/does-not-exist.png) 16 / 24px / 0 stretch',
        note: 'A source that fails to load also falls back to the normal border — never a blank frame.',
    },
];

const LONGHANDS = [
    'border-image-source', 'border-image-slice', 'border-image-width',
    'border-image-outset', 'border-image-repeat',
];

function logLine(text) {
    biState.log.push(text);
    if (biState.log.length > 30) biState.log.shift();
    const el = document.getElementById('biLog');
    if (el) el.textContent = biState.log.slice(-10).join('\n');
}

export function buildSamples() {
    const host = document.getElementById('biGrid');
    biState.samples = [];

    for (const spec of SAMPLES) {
        const cell = document.createElement('div');
        cell.className = 'bi-cell';

        const title = document.createElement('div');
        title.className = 'bi-title';
        title.textContent = spec.label;
        cell.appendChild(title);

        const box = document.createElement('div');
        box.className = 'bi-box';
        box.id = spec.id;
        // The shorthand goes on last so it wins over the class's plain border,
        // which is what the two fallback samples fall BACK to.
        box.style.borderImage = spec.css;
        box.textContent = '';
        cell.appendChild(box);

        const code = document.createElement('code');
        code.className = 'bi-code';
        code.textContent = 'border-image: ' + spec.css;
        cell.appendChild(code);

        const note = document.createElement('p');
        note.className = 'bi-note';
        note.textContent = spec.note;
        cell.appendChild(note);

        const dump = document.createElement('pre');
        dump.className = 'bi-longhands mono';
        dump.id = spec.id + 'Longhands';
        cell.appendChild(dump);

        if (host) host.appendChild(cell);
        biState.samples.push({ id: spec.id, label: spec.label, css: spec.css, el: box });
    }
}

// Read the five longhands back out of computed style. This is the panel's real
// content: it proves the shorthand EXPANDED, and it is the only place the
// grammar's slash-slot rules (slice → width → outset) are observable.
export function longhandsFor(id) {
    const el = document.getElementById(id);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const out = {};
    for (const prop of LONGHANDS) out[prop] = cs.getPropertyValue(prop);
    return out;
}

export function refreshLonghands() {
    biState.expansions = 0;
    for (const sample of biState.samples) {
        const lh = longhandsFor(sample.id);
        if (!lh) continue;
        sample.longhands = lh;
        if (lh['border-image-source'] && lh['border-image-source'] !== 'none') biState.expansions++;
        const dump = document.getElementById(sample.id + 'Longhands');
        if (dump) {
            const text = LONGHANDS
                .map((p) => `${p.replace('border-image-', '').padEnd(7)} ${lh[p]}`)
                .join('\n');
            if (dump.textContent !== text) dump.textContent = text;
        }
    }
    setText('biExpansions', String(biState.expansions));
    return biState.samples.map((s) => ({ id: s.id, longhands: s.longhands }));
}

// The interactive sample: one box whose shorthand is rebuilt from sliders, so
// the reader can watch the longhand dump change under the grammar rather than
// reading twelve static variants.
export function applyLive() {
    const box = document.getElementById('biLiveBox');
    if (!box) return null;
    const slice = value('biLiveSlice', 16);
    const width = value('biLiveWidth', 24);
    const outset = value('biLiveOutset', 0);
    const repeat = document.getElementById('biLiveRepeat');
    const source = document.getElementById('biLiveSource');
    const css = `url(assets/${source ? source.value : 'nine.png'}) ${slice} / ${width}px / ${outset}px ${repeat ? repeat.value : 'stretch'}`;
    box.style.borderImage = css;
    setText('biLiveCss', 'border-image: ' + css);
    logLine(css);
    refreshLonghands();
    return css;
}

function value(id, dflt) {
    const el = document.getElementById(id);
    return el ? Number(el.value) : dflt;
}

export function tickBorderImage() {
    refreshLonghands();
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el && el.textContent !== text) el.textContent = text;
}

export function initBorderImage() {
    buildSamples();
    refreshLonghands();
    for (const id of ['biLiveSlice', 'biLiveWidth', 'biLiveOutset', 'biLiveRepeat', 'biLiveSource']) {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', applyLive);
            el.addEventListener('change', applyLive);
        }
    }
    applyLive();
}

export { SAMPLES, LONGHANDS };
