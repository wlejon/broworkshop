// The species helper's pure parts and the subject box; no model loads.
import { check, eq, test, done, frames } from "/lib/kit/test.js";
import { speciesPrompt, squareInput } from "/app/species.js";
import { subjectBox } from "/app/crop.js";

frames(2);

test('BioCLIP prompt: full taxonomy, then the common name', () => {
    eq(speciesPrompt({ common: 'Mourning Dove', scientific: 'Zenaida macroura', kingdom: 'Animalia',
                       phylum: 'Chordata', class: 'Aves', order: 'Columbiformes', family: 'Columbidae' }),
       'a photo of Animalia Chordata Aves Columbiformes Columbidae Zenaida macroura with common name Mourning Dove.');
    // Kingdom and phylum default for rows that leave them out.
    eq(speciesPrompt({ common: 'Eastern Chipmunk', scientific: 'Tamias striatus', class: 'Mammalia',
                       order: 'Rodentia', family: 'Sciuridae' }),
       'a photo of Animalia Chordata Mammalia Rodentia Sciuridae Tamias striatus with common name Eastern Chipmunk.');
});

test('subject box: a blob in a 200 x 100 matte, grown and squared', () => {
    const w = 200, h = 100, alpha = new Float32Array(w * h);
    for (let y = 40; y < 60; y++) for (let x = 120; x < 160; x++) alpha[y * w + x] = 0.9;
    const b = subjectBox(alpha, w, h, { margin: 0.25 });
    eq([b.w, b.h], [60, 60], 'square of 40 * 1.5');
    check(b.x <= 120 && b.x + b.w >= 160 && b.y <= 40 && b.y + b.h >= 60, 'covers the blob');
    check(b.x >= 0 && b.y >= 0 && b.x + b.w <= w && b.y + b.h <= h, 'inside the frame');
});

test('subject box: specks and an empty matte are no subject', () => {
    const w = 100, h = 100, alpha = new Float32Array(w * h);
    eq(subjectBox(alpha, w, h), null, 'empty');
    alpha[5050] = 1;
    eq(subjectBox(alpha, w, h), null, 'one pixel');
});

test('subject box: a subject at the edge stays inside the frame', () => {
    const w = 100, h = 80, alpha = new Float32Array(w * h).fill(0);
    for (let y = 0; y < 70; y++) for (let x = 0; x < 60; x++) alpha[y * w + x] = 1;
    const b = subjectBox(alpha, w, h);
    eq([b.x, b.y, b.h], [0, 0, 80], 'clamped to the frame');
});

test('square input: a 300 x 150 RGB frame to the 224 square', () => {
    const w = 300, h = 150, rgb = new Uint8Array(w * h * 3);
    // Left third red, middle green, right blue: the centre square is all green.
    for (let i = 0; i < w * h; i++) {
        const x = i % w;
        rgb[i * 3 + (x < 100 ? 0 : x < 200 ? 1 : 2)] = 255;
    }
    const sq = squareInput({ width: w, height: h, channels: 3, pixels: rgb }, 224);
    eq([sq.width, sq.height, sq.data.length], [224, 224, 224 * 224 * 4]);
    const mid = (112 * 224 + 112) * 4;
    eq(Array.from(sq.data.slice(mid, mid + 4)), [0, 255, 0, 255], 'centre is the green third');
});

done();
