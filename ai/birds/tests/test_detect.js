// OWLv2 end to end on synthetic frames: load, detect, the "no animal" answer.
// Skips without the weights (google/owlv2-base-patch16-ensemble as released;
// brovisionml-data/owlv2) or without bro.vision.loadOwlv2.
import { check, eq, test, done, skip } from "/lib/kit/test.js";
import { loadAnimalDetector, subjectSquare, ANIMAL_QUERIES } from "/app/detect.js";
import { locate, searched } from "/app/models.js";

if (!globalThis.bro || !bro.vision || typeof bro.vision.loadOwlv2 !== 'function') {
    skip('this build has no bro.vision.loadOwlv2');
}
const dir = locate('owlv2');
if (!dir) skip('OWLv2 weights not found (' + searched('owlv2') + ')');

// 640 x 400: a sky-to-grass gradient; with `blob`, a dark brown ellipse.
function frame(blob, channels) {
    const w = 640, h = 400, ch = channels || 4, data = new Uint8Array(w * h * ch);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * ch;
        const inside = blob && ((x - 420) / 60) ** 2 + ((y - 220) / 40) ** 2 < 1;
        data[i] = inside ? 90 : 120 - (y >> 3);
        data[i + 1] = inside ? 60 : 160 + (y >> 4);
        data[i + 2] = inside ? 40 : 220 - (y >> 1);
        if (ch === 4) data[i + 3] = 255;
    }
    return { width: w, height: h, channels: ch, [ch === 4 ? 'data' : 'pixels']: data };
}

let det;

test('load', () => {
    det = loadAnimalDetector({ weightsDir: dir });
    check(det.queries === ANIMAL_QUERIES, 'default queries');
    check(typeof det.device === 'string', 'device');
});

test('an empty frame has no animal at the default threshold', () => {
    eq(det.detect(frame(false)).length, 0, 'nothing over the threshold');
});

test('every box at threshold 0: sorted, labelled, inside the frame', () => {
    const hits = det.detect(frame(true), { threshold: 0, maxDetections: 10 });
    eq(hits.length, 10, 'maxDetections');
    for (let i = 0; i < hits.length; i++) {
        const [x, y, w, h] = hits[i].box;
        check(x >= 0 && y >= 0 && x + w <= 640.01 && y + h <= 400.01, 'box ' + i + ' in the frame');
        check(ANIMAL_QUERIES.includes(hits[i].label), 'label is a query: ' + hits[i].label);
        check(hits[i].score >= 0 && hits[i].score <= 1, 'score in [0, 1]');
        if (i) check(hits[i - 1].score >= hits[i].score, 'best first');
    }
    const sq = subjectSquare(hits[0].box, 640, 400);
    check(sq && sq.w === sq.h, 'a square crop of the best box');
});

test('RGB and RGBA rows give the same boxes; a custom query list', () => {
    const a = det.detect(frame(true, 4), { threshold: 0, maxDetections: 3, queries: ['a rock'] });
    const b = det.detect(frame(true, 3), { threshold: 0, maxDetections: 3, queries: ['a rock'] });
    eq(a.map((r) => r.box.map(Math.round)), b.map((r) => r.box.map(Math.round)), 'same boxes');
    check(a.every((r) => r.label === 'a rock'), 'labels from the given queries');
});

test('dispose', () => {
    det.dispose();
    let threw = false;
    try { det.detect(frame(false)); } catch (_) { threw = true; }
    check(threw, 'detect after dispose throws');
});

done();
