// The batch processor without models (--no-models): synthetic JPEGs with
// fake EXIF capture times in a scratch folder -> records, keys, the
// incremental skip, a changed and a removed photo, RAW+JPEG pairs, a corrupt
// file, burst grouping and keepers, and the refusal of an output dir inside
// the photo folder. Plus the pure parts: EXIF time parsing and grouping with
// a scene split as the app uses them (bro.vision.wildlife), base64.
// tests/test_process_ml.js runs the models.
import { check, eq, near, test, done, throws } from "/lib/kit/test.js";
import { runBatch, scanPhotos, isInside, sceneNcc, labelCounts } from "/app/batch.js";
import { readJsonl, toBase64, fromBase64 } from "/app/store.js";
import { writeExifJpeg, texture } from "/app/tests/synth.js";

const fs = require('fs');
const os = require('os');

// The records' form of the temp dir: its real path with forward slashes.
const root = fs.realpathSync(os.tmpdir()).replace(/\\/g, '/').replace(/\/+$/, '') + '/birds-test-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
const input = root + '/card', output = root + '/out';
fs.mkdirSync(input + '/sub', { recursive: true });
const quiet = () => {};
const { groupBursts, parseExifTime } = bro.vision.wildlife;

// The card: burst A (3 frames, 0.2 / 0.25 s apart, the middle one sharp),
// a single shot B, burst C (2 frames 0.4 s apart) in a subfolder, a RAW+JPEG
// pair D, a JPEG with no EXIF, a corrupt JPEG, a video.
const W = 320, H = 240;
const A = ['A1', 'A2', 'A3'].map((n) => input + '/' + n + '.JPG');
writeExifJpeg(A[0], texture(W, H, 1, 3), W, H, { date: '2026:10:05 11:34:38', subsec: '10', offset: '-05:00' });
writeExifJpeg(A[1], texture(W, H, 1, 0), W, H, { date: '2026:10:05 11:34:38', subsec: '30', offset: '-05:00' });
writeExifJpeg(A[2], texture(W, H, 1, 2), W, H, { date: '2026:10:05 11:34:38', subsec: '55', offset: '-05:00' });
writeExifJpeg(input + '/B.JPG', texture(W, H, 2, 0), W, H, { date: '2026:10:05 11:34:45', subsec: '00', offset: '-05:00' });
writeExifJpeg(input + '/sub/C1.jpg', texture(W, H, 3, 1), W, H, { date: '2026:10:05 11:35:20', subsec: '00', offset: '-05:00' });
writeExifJpeg(input + '/sub/C2.jpg', texture(W, H, 3, 0), W, H, { date: '2026:10:05 11:35:20', subsec: '40', offset: '-05:00' });
writeExifJpeg(input + '/D.JPG', texture(W, H, 4, 0), W, H, { date: '2026:10:05 11:40:00', subsec: '00', offset: '-05:00' });
fs.writeFileSync(input + '/D.CR3', 'not really a raw file', 'utf-8');
writeExifJpeg(input + '/E.jpg', texture(W, H, 5, 0), W, H, null);
fs.writeFileSync(input + '/broken.JPG', 'garbage, not a JPEG at all', 'utf-8');
// A JPEG cut off a third of the way into its image data (EXIF intact).
writeExifJpeg(input + '/trunc.JPG', texture(W, H, 6, 0), W, H, { date: '2026:10:05 12:00:00', subsec: '00' });
{
    const whole = new Uint8Array(fs.readFileSync(input + '/trunc.JPG'));
    fs.writeFileSync(input + '/trunc.JPG', whole.slice(0, Math.floor(whole.length / 3)));
}
fs.writeFileSync(input + '/clip.MP4', 'not a video either', 'utf-8');

const recs = () => [...readJsonl(output + '/records.jsonl').values()];
const burstsArr = () => String(fs.readFileSync(output + '/bursts.jsonl', 'utf-8')).trim().split('\n').map((l) => JSON.parse(l));
const meta = () => JSON.parse(String(fs.readFileSync(output + '/meta.json', 'utf-8')));
const byName = (name) => recs().find((r) => r.path.endsWith('/' + name));

test('EXIF times: sub-second, offsets, no offset, junk', () => {
    eq(parseExifTime('2026-10-05T11:34:38.56-05:00'), Date.UTC(2026, 9, 5, 16, 34, 38, 560));
    eq(parseExifTime('2026-10-05T11:34:38+02:00'), Date.UTC(2026, 9, 5, 9, 34, 38));
    eq(parseExifTime('2026-10-05T11:34:38.5'), Date.UTC(2026, 9, 5, 11, 34, 38, 500));
    eq(parseExifTime('2026-10-05T11:34:38.123456Z'), Date.UTC(2026, 9, 5, 11, 34, 38) + 123.456);
    eq(parseExifTime('not a date'), null);
    eq(parseExifTime(undefined), null);
});

test('paths: inside, base64 round trip', () => {
    check(isInside('/a/b/c', '/a/b') && isInside('/a/b', '/a/b/') && !isInside('/a/bc', '/a/b'), 'isInside');
    const bytes = new Uint8Array(257).map((_, i) => (i * 37) & 255);
    for (const n of [0, 1, 2, 3, 100, 257]) eq(Array.from(fromBase64(toBase64(bytes.subarray(0, n)))), Array.from(bytes.subarray(0, n)), 'base64 ' + n);
});

test('scan: JPEG and CR3, pairs, recursion, other files counted', () => {
    const s = scanPhotos(input);
    eq(s.shots.length, 10, 'shots');
    eq(s.skipped, { '.mp4': 1 }, 'skipped');
    const d = s.shots.find((x) => x.path.endsWith('/D.JPG'));
    check(d && d.pair && d.pair.endsWith('/D.CR3'), 'the CR3 is the JPEG\'s pair');
    check(!s.shots.some((x) => x.path.endsWith('.CR3')), 'a paired CR3 is not a shot of its own');
});

test('grouping: gap, scene split, keeper, consensus', () => {
    const rec = (path, t, opts) => Object.assign({ path, time: t, animal: false, species: [],
        sharpness: { frame: { tenengrad: 1, laplacianVar: 1 }, subject: null } }, opts || {});
    const sp = (common, score) => ({ common, scientific: common + ' sp.', score });
    const rs = [
        rec('a', 0, { animal: true, species: [sp('Robin', 0.9), sp('Jay', 0.1)], sharpness: { frame: { tenengrad: 9 }, subject: { tenengrad: 5 } } }),
        rec('b', 300, { animal: true, species: [sp('Jay', 0.6), sp('Robin', 0.4)], sharpness: { frame: { tenengrad: 1 }, subject: { tenengrad: 7 } } }),
        rec('c', 600, { animal: true, species: [sp('Robin', 0.8)], sharpness: { frame: { tenengrad: 1 }, subject: { tenengrad: 6 } } }),
        rec('d', 5000),
        rec('e', 5200, { error: 'decode failed' }),
        rec('f', 5400),
    ];
    const g = groupBursts(rs, { gapS: 1 });
    eq(g.map((b) => b.photos.length), [3, 2], 'sizes; the error is left out');
    eq(g[0].species.common, 'Robin', 'score-weighted consensus');
    eq(g[0].species.agree, 2, 'frames naming it first');
    near(g[0].species.share, (0.9 + 0.4 + 0.8) / 3, 1e-4, 'share');
    eq(g[0].keeper, 'b', 'the sharpest subject, not the sharpest frame');
    eq(g[1].species, null, 'no animal, no species');
    eq(groupBursts(rs, { gapS: 0.25 }).length, 5, 'a tighter gap splits');
    const split = groupBursts(rs, { gapS: 1, sameScene: (p, c) => ({ ncc: c.path === 'c' ? 0.2 : 0.9, split: c.path === 'c' }) });
    eq(split.map((b) => b.count), [2, 1, 2], 'scene split');
    eq(split[1].startedBy, 'scene', 'started by the scene change');
    eq(split[0].minNcc, 0.9, 'ncc kept');

    // Labels: the burst's consensus share 0.7 is unidentified at 0.85, labelled at 0.65;
    // its three frames (and 'g', alone at 0.9) follow; the no-animal burst counts nowhere.
    const lone = rec('g', 9000, { animal: true, species: [sp('Wren', 0.9)] });
    const all = rs.concat([lone]);
    const gb = groupBursts(all, { gapS: 1 });
    const at85 = labelCounts(all, gb, 0.85), at65 = labelCounts(all, gb, 0.65);
    eq(at85, { threshold: 0.85, photos: { animal: 4, labelled: 1, unidentified: 3 },
               bursts: { animal: 2, labelled: 1, unidentified: 1 } }, 'at 0.85');
    eq([at65.photos.labelled, at65.bursts.labelled], [4, 2], 'at 0.65 everything is named');
});

test('scene NCC: a frame and itself shifted vs another scene', () => {
    // Grain (many degrees of freedom): two unrelated frames cannot be made to
    // correlate by any shift.
    let s = 99;
    const noise = () => Uint8Array.from({ length: 96 * 64 }, () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) >>> 24);
    const la = noise(), lb = noise(), ls = new Uint8Array(la.length);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 96; x++) ls[y * 96 + x] = la[y * 96 + Math.min(95, x + 2)];
    const ta = { width: 96, height: 64, luma: la };
    check(sceneNcc(ta, { width: 96, height: 64, luma: ls }) > 0.9, 'shifted copy is the same scene');
    check(sceneNcc(ta, { width: 96, height: 64, luma: lb }) < 0.5, 'another texture is not');
    eq(sceneNcc(ta, { width: 64, height: 96, luma: ls }), -1, 'portrait after landscape');
});

test('refuses an output dir inside the photo folder', () => {
    throws(() => runBatch({ input, output: input + '/records', noModels: true, log: quiet }), /inside the photo folder/);
    throws(() => runBatch({ input, output: input, noModels: true, log: quiet }), /inside the photo folder/);
    throws(() => runBatch({ input: input + '/sub/..', output: input + '/sub/x', noModels: true, log: quiet }), /inside the photo folder/);
    check(!fs.existsSync(input + '/records') && !fs.existsSync(input + '/sub/x'), 'nothing written there');
});

test('first run: one record per photo, keys, errors, pairs, bursts', () => {
    const r = runBatch({ input, output, noModels: true, workers: 2, log: quiet });
    eq(r.meta.run.processed, 10, 'processed');
    const all = recs();
    eq(all.length, 10, 'records');
    for (const x of all) {
        const st = fs.statSync(x.path);
        eq(x.key, st.size + ':' + Math.round(st.mtimeMs), 'key ' + x.path);
        check(x.path.startsWith(input + '/'), 'absolute path');
    }
    const bad = byName('broken.JPG');
    check(bad.error && bad.stage === 'decode', 'corrupt file is an error record: ' + JSON.stringify(bad));
    eq(byName('D.JPG').pair, input + '/D.CR3', 'pair recorded');
    const a1 = byName('A1.JPG');
    eq(a1.exif.dateTaken, '2026-10-05T11:34:38.10-05:00', 'EXIF date with sub-seconds');
    eq(a1.timeSource, 'exif');
    eq(byName('E.jpg').timeSource, 'mtime', 'no EXIF: the file time');
    eq(a1.animal, null, 'no models: no animal answer');
    check(a1.sharpness.frame.tenengrad > 0 && a1.sharpness.scale === W, 'frame sharpness at the decode size');
    check(fs.readdirSync(input).every((f) => !/jsonl|summary|meta/.test(f)), 'nothing written beside the photos');
    const bs = burstsArr();
    const ba = bs.find((b) => b.photos.includes(A[0]));
    eq(ba.photos, A, 'burst A in time order');
    eq(ba.keeper, A[1], 'the sharp frame is the keeper');
    eq(bs.find((b) => b.photos.some((p) => p.endsWith('C1.jpg'))).count, 2, 'burst C across the subfolder');
    const good = all.filter((x) => !x.error).length;
    eq(bs.reduce((n, b) => n + b.count, 0), good, 'every good photo in one burst');
    // The truncated JPEG: decoded as far as it goes, or an error record; either way the run went on.
    const tr = byName('trunc.JPG');
    check(tr && (tr.error ? tr.stage === 'decode' : tr.width === W), 'truncated JPEG: ' + JSON.stringify(tr && (tr.error || tr.width)));
    const sum = String(fs.readFileSync(output + '/summary.md', 'utf-8'));
    check(/## Bursts/.test(sum) && /broken\.JPG/.test(sum) && /1 \.mp4/.test(sum), 'summary: bursts, failure, skipped');
    eq(meta().run.errors, all.length - good, 'meta counts the errors');
});

test('re-run: nothing changed, nothing processed', () => {
    const before = String(fs.readFileSync(output + '/records.jsonl', 'utf-8'));
    const r = runBatch({ input, output, noModels: true, workers: 2, log: quiet });
    eq([r.meta.run.processed, r.meta.run.reused], [0, 10]);
    eq(String(fs.readFileSync(output + '/records.jsonl', 'utf-8')), before, 'records unchanged');
});

test('a changed photo is processed again, a removed one dropped', () => {
    writeExifJpeg(input + '/B.JPG', texture(W + 16, H, 9, 0), W + 16, H, { date: '2026:10:05 11:34:45', subsec: '00' });
    fs.unlinkSync(input + '/E.jpg');
    const r = runBatch({ input, output, noModels: true, workers: 1, log: quiet });
    eq([r.meta.run.processed, r.meta.run.reused, r.meta.run.removed], [1, 8, 1]);
    eq(byName('B.JPG').width, W + 16, 'the new B');
    eq(recs().length, 9, 'one record per photo after compaction');
});

test('a torn last line from an interrupted run is ignored', () => {
    fs.appendFileSync(output + '/records.jsonl', '{"v":1,"path":"' + input + '/A1.JPG","ke', 'utf-8');
    const r = runBatch({ input, output, noModels: true, log: quiet });
    eq(r.meta.run.processed, 0, 'the earlier A1 line still holds');
    eq(recs().length, 9);
});

test('--force and a different config process everything again', () => {
    eq(runBatch({ input, output, noModels: true, force: true, log: quiet }).meta.run.processed, 9, 'force');
    eq(runBatch({ input, output, noModels: true, sharpSize: 200, log: quiet }).meta.run.processed, 9, 'new config');
    const r = runBatch({ input, output, noModels: true, sharpSize: 200, gapS: 0.1, log: quiet });
    eq(r.meta.run.processed, 0, 'burst options do not touch the records');
    eq(burstsArr().length, recs().filter((x) => !x.error).length, 'a 0.1 s gap: every good photo alone');
    eq(r.meta.history.length, 7, 'every run into the directory is in the history');
});

try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
done('birds process');
