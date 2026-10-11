// The batch processor with its models (tagged ml): synthetic JPEGs through
// OWLv2 and BioCLIP 2 -> records with the detector's answer and, for a frame
// where it finds something at threshold 0, the species top 5, the subject
// square and its sharpness; meta names the models; a re-run skips; another
// species model is another config, so everything is processed again.
// Skips without the weights.
import { check, eq, test, done, skip } from "/lib/kit/test.js";
import { runBatch } from "/app/batch.js";
import { readJsonl } from "/app/store.js";
import { writeExifJpeg, texture } from "/app/tests/synth.js";

const fs = require('fs');
const os = require('os');

if (!globalThis.bro || !bro.vision || !bro.vision.wildlife) skip('no bro.vision.wildlife');
for (const model of ['bioclip-2', 'bioclip'])
    if (!bro.vision.wildlife.available({ model }))
        skip('models not found (missing ' + bro.vision.wildlife.locate({ model }).missing.join(', ') + ')');

const root = os.tmpdir().replace(/\/+$/, '') + '/birds-ml-test-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
const input = root + '/card', output = root + '/out';
fs.mkdirSync(input, { recursive: true });
const quiet = () => {};

// A sky-to-grass gradient, and the same with a dark brown ellipse.
function frame(w, h, blob) {
    const px = new Uint8Array(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3;
        const inside = blob && ((x - 420) / 60) ** 2 + ((y - 220) / 40) ** 2 < 1;
        px[i] = inside ? 90 : 120 - (y >> 3);
        px[i + 1] = inside ? 60 : 160 + (y >> 4);
        px[i + 2] = inside ? 40 : 220 - (y >> 1);
    }
    return px;
}
writeExifJpeg(input + '/empty.jpg', frame(640, 400, false), 640, 400, { date: '2026:10:05 11:00:00', subsec: '00' });
writeExifJpeg(input + '/blob1.jpg', frame(640, 400, true), 640, 400, { date: '2026:10:05 11:00:10', subsec: '00' });
writeExifJpeg(input + '/blob2.jpg', frame(640, 400, true), 640, 400, { date: '2026:10:05 11:00:10', subsec: '20' });
writeExifJpeg(input + '/grain.jpg', texture(320, 240, 3, 0), 320, 240, { date: '2026:10:05 11:05:00', subsec: '00' });

const recs = () => [...readJsonl(output + '/records.jsonl').values()];
const by = (n) => recs().find((r) => r.path.endsWith('/' + n));

test('default threshold: an empty frame has no animal; records carry the detector\'s answer', () => {
    const r = runBatch({ input, output, workers: 2, log: quiet });
    eq(r.meta.run.processed, 4);
    const e = by('empty.jpg');
    eq(e.animal, false, 'no animal in an empty frame');
    eq([e.detections.length, e.species.length, e.subject], [0, 0, null], 'nothing classified');
    for (const x of recs()) check(typeof x.animal === 'boolean' && Array.isArray(x.detections), 'answer for ' + x.path);
    const m = r.meta.config;
    eq([m.detector.repo, m.classifier.repo, m.threshold], ['google/owlv2-base-patch16-ensemble', 'imageomics/bioclip-2', 0.15]);
    check(m.classifier.weightsBytes > 0 && m.speciesList.count > 500, 'model and list identity');
});

test('threshold 0: every frame is an animal, with a top 5, a subject and its sharpness', () => {
    const r = runBatch({ input, output, threshold: 0, log: quiet });
    eq(r.meta.run.processed, 4, 'a new threshold is a new config');
    const b = by('blob1.jpg');
    check(b.animal && b.detections.length >= 1, 'boxes');
    eq(b.species.length, 5, 'top 5');
    check(b.species[0].score >= b.species[4].score && b.species.every((s) => s.common && s.scientific), 'sorted, named');
    const sq = b.subject;
    check(sq && sq.w === sq.h && sq.x >= 0 && sq.y >= 0 && sq.x + sq.w <= 640 && sq.y + sq.h <= 400, 'subject square in the frame');
    check(b.sharpness.subject && b.sharpness.subject.pixels > 0, 'subject sharpness');
    const burst = r.bursts.find((x) => x.photos.length === 2);
    check(burst && burst.species && burst.species.agree >= 1, 'blob1 + blob2 are one burst with a consensus');
});

test('re-run skips; another species model reprocesses', () => {
    eq(runBatch({ input, output, threshold: 0, log: quiet }).meta.run.processed, 0, 'unchanged');
    const r = runBatch({ input, output, threshold: 0, model: 'bioclip', log: quiet });
    eq(r.meta.run.processed, 4, 'bioclip is another config');
    eq(r.meta.config.classifier.repo, 'imageomics/bioclip');
});

try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
done('birds process (models)');
