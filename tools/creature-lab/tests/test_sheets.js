// Every sheet renders headless for a gait and an action, A/B included, each
// with something drawn on it; the same sheet rendered twice is the same
// bytes; and the edit -> sheet loop (load the creature afresh, run, draw)
// stays within seconds. Sheets land in tests/out/creature-lab/test/.
//   scripts/validate.sh tools/creature-lab/tests/test_sheets.js

import { check, eq, test, done } from "/lib/kit/test.js";
import { runCommand, KINDS } from "/app/lab/commands.js";

globalThis.creatureLab?.dispose?.();
const fs = require('fs');
const OUT = 'tests/out/creature-lab/test';
const root = `${bro.app.cwd.replace(/\\/g, '/')}/${OUT}`;

function png(path) {
    const raw = fs.readFileSync(path);
    const img = bro.image.decodeOriented(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
    return { raw, img };
}

// Something drawn: the sheet is not one colour, and enough of it is ink.
function inked(img) {
    const p = img.pixels;
    let dark = 0, n = 0;
    for (let i = 0; i < p.length; i += 4 * 97) { n++; if (p[i] + p[i + 1] + p[i + 2] < 450) dark++; }
    return dark / n;
}

const timings = {};
await test('every sheet for a gait and an action', async () => {
    for (const sc of ['trot', 'startle']) {
        const t0 = Date.now();
        const out = await runCommand(['sheets', 'deer', sc, '--out', OUT]);
        timings[sc] = Date.now() - t0;
        for (const kind of KINDS) {
            const path = `${root}/deer/${sc}-${kind}.png`;
            check(out.written.includes(path), `${kind} written for ${sc}`);
            const { img } = png(path);
            check(img.width >= 1200 && img.height >= 1000, `${sc} ${kind} is ${img.width}x${img.height}`);
            const ink = inked(img);
            check(ink > 0.006,`${sc} ${kind}: only ${(ink * 100).toFixed(1)}% drawn`);
        }
        const m = JSON.parse(fs.readFileSync(`${root}/deer/${sc}-metrics.json`, 'utf-8'));
        eq(m.scenario, sc, 'metrics scenario');
        check(Array.isArray(m.flags) && m.feet.LH && m.joints.femurL && m.footfalls, 'metrics sections');
    }
});

await test('a sheet rendered twice is the same bytes', async () => {
    const a = `${root}/deer/trot-charts.png`, t = `${root}/deer/trot-turnaround.png`;
    const before = [png(a).raw, png(t).raw];
    await runCommand(['charts', 'deer', 'trot', '--out', OUT]);
    await runCommand(['turnaround', 'deer', 'trot', '--out', OUT]);
    const after = [png(a).raw, png(t).raw];
    for (let i = 0; i < 2; i++) {
        eq(after[i].length, before[i].length, 'size');
        check(Buffer.compare(after[i], before[i]) === 0, `${[a, t][i]} changed between renders`);
    }
});

await test('A/B sheets: interleaved and overlaid, metrics side by side', async () => {
    const out = await runCommand(['ab', 'deer', 'deer:stumble', 'walk', '--out', OUT, '--diff']);
    const dir = `${root}/deer-vs-deer_stumble`;
    for (const f of ['walk-turnaround.png', 'walk-trajectory.png', 'walk-charts.png', 'walk-range-a.png', 'walk-range-b.png', 'walk-metrics.json', 'diff/comparison.json']) {
        check(fs.existsSync(`${dir}/${f}`), `${f} written`);
    }
    const ta = png(`${dir}/walk-turnaround.png`).img, t1 = png(`${root}/deer/trot-turnaround.png`).img;
    check(ta.height > 1.8 * t1.height, `interleaved rows: ${ta.height} vs one run's ${t1.height}`);
    const m = JSON.parse(fs.readFileSync(`${dir}/walk-metrics.json`, 'utf-8'));
    eq(m.A.flags.length, 0, 'A clean');
    check(m.B.flags.some((f) => /RH's touchdown wanders/.test(f)), 'B\'s stumble listed');
    check(out.written.length >= 6, 'files listed');
});

test('edit -> sheet in seconds', () => {
    // Each `sheets` call above loaded the creature afresh (rig compiled, body
    // sculpted), ran the scenario and drew four sheets and the metrics.
    console.log(`  sheets: trot ${timings.trot} ms, startle ${timings.startle} ms`);
    check(timings.trot < 15000 && timings.startle < 15000, 'four sheets and metrics under 15 s');
});

done('creature-lab sheets');
