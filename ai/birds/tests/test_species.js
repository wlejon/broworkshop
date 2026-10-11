// BioCLIP end to end on a synthetic image: load, embed a three-species list,
// classify, reuse the on-disk text cache. Skips without the converted weights
// (brolm/scripts/convert-openclip.py -> brovisionml-data/bioclip).
import { check, eq, near, test, done, skip } from "/lib/kit/test.js";
import { loadSpeciesModel } from "/app/species.js";
import { locate, searched } from "/app/models.js";

const fs = require('fs');
const dir = locate('bioclip');
if (!dir) skip('BioCLIP weights not found (' + searched('bioclip') + '; brolm/scripts/convert-openclip.py)');

const species = [
    { common: 'Mourning Dove', scientific: 'Zenaida macroura', class: 'Aves',
      order: 'Columbiformes', family: 'Columbidae' },
    { common: 'Great Blue Heron', scientific: 'Ardea herodias', class: 'Aves',
      order: 'Pelecaniformes', family: 'Ardeidae' },
    { common: 'Eastern Chipmunk', scientific: 'Tamias striatus', class: 'Mammalia',
      order: 'Rodentia', family: 'Sciuridae' },
];

// A synthetic 320 x 240 frame: a grey-brown ellipse on a blue-green gradient.
function frame() {
    const w = 320, h = 240, data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const inside = ((x - 160) / 70) ** 2 + ((y - 120) / 45) ** 2 < 1;
        data[i] = inside ? 140 : 40;
        data[i + 1] = inside ? 120 : 90 + (y >> 2);
        data[i + 2] = inside ? 100 : 160 - (x >> 2);
        data[i + 3] = 255;
    }
    return { width: w, height: h, data };
}

const cacheDir = (bro.app && bro.app.cacheDir ? bro.app.cacheDir : '/tmp') + '/birds-test-' + Date.now();
let first;

test('load, embed and classify', () => {
    first = loadSpeciesModel({ modelDir: dir, species, cacheDir });
    eq([first.dim, first.imageSize, first.cached], [512, 224, false]);
    const top = first.classify(frame(), { topK: 3 });
    eq(top.length, 3, 'topK');
    check(top[0].similarity >= top[1].similarity && top[1].similarity >= top[2].similarity, 'sorted');
    near(top.reduce((s, r) => s + r.score, 0), 1, 1e-4, 'probabilities over the whole list');
    check(top.every((r) => r.similarity > -1 && r.similarity < 1 && r.common && r.scientific), 'fields');
});

test('the text embeddings come back from the cache unchanged', () => {
    const again = loadSpeciesModel({ modelDir: dir, species, cacheDir });
    check(again.cached, 'cache hit');
    const a = first.classify(frame(), { topK: 3 }), b = again.classify(frame(), { topK: 3 });
    eq(a.map((r) => r.common), b.map((r) => r.common), 'same ranking');
    near(a[0].similarity, b[0].similarity, 1e-6, 'same similarity');
});

try { fs.rmSync(cacheDir, { recursive: true, force: true }); } catch (_) {}
done();
