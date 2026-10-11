// The species helper's pure parts and the subject square; no model loads.
import { check, eq, test, done, frames } from "/lib/kit/test.js";
import { speciesPrompt, squareInput } from "/app/species.js";
import { subjectSquare, cropImage } from "/app/detect.js";

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

test('subject square: a 40 x 20 box in a 200 x 100 frame, grown and squared', () => {
    const w = 200, h = 100;
    const b = subjectSquare([120, 40, 40, 20], w, h, { margin: 0.25 });
    eq([b.w, b.h], [60, 60], 'square of 40 * 1.5');
    check(b.x <= 120 && b.x + b.w >= 160 && b.y <= 40 && b.y + b.h >= 60, 'covers the box');
    check(b.x >= 0 && b.y >= 0 && b.x + b.w <= w && b.y + b.h <= h, 'inside the frame');
    eq(subjectSquare([120, 40, 40, 20], w, h).w, 52, 'default margin 15%');
});

test('subject square: an empty box is no subject', () => {
    eq(subjectSquare([10, 10, 0, 5], 100, 100), null, 'zero width');
});

test('subject square: a subject at the edge stays inside the frame', () => {
    const b = subjectSquare([0, 0, 60, 70], 100, 80);
    eq([b.x, b.y, b.h], [0, 0, 80], 'clamped to the frame');
});

test('crop: an RGB frame cropped to RGBA', () => {
    const w = 4, h = 2, rgb = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) rgb[i * 3] = i * 10;
    const c = cropImage({ width: w, height: h, channels: 3, pixels: rgb }, { x: 1, y: 1, w: 2, h: 1 });
    eq([c.width, c.height], [2, 1]);
    eq(Array.from(c.data), [50, 0, 0, 255, 60, 0, 0, 255], 'pixels (1,1) and (2,1)');
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
