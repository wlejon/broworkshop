// The lab's oracle: each deliberately broken deer is reported for what is
// broken (and the deer as it is is not), reruns are bit-identical, and the
// ground the GPU rig stands on is the ground the CPU measures.
//   scripts/validate.sh tools/creature-lab/tests/test_oracle.js

import { check, eq, test, done } from "/lib/kit/test.js";
import { loadCreature } from "/app/lab/creature.js";
import { runScenario } from "/app/lab/run.js";
import { analyzeRun } from "/app/lab/commands.js";
import { readApp } from "/app/lab/creature.js";
import { groundEnv } from "/app/lab/scenarios.js";
import { groundHeights } from "/app/lab/run.js";

globalThis.creatureLab?.dispose?.();

const runs = {};
async function report(spec, sc) {
    const key = spec + '/' + sc;
    if (!runs[key]) runs[key] = analyzeRun(runScenario(await loadCreature(spec), sc));
    return runs[key];
}
const has = (r, re) => r.flags.some((f) => re.test(f));

await test('the deer walks and trots clean', async () => {
    for (const sc of ['walk', 'trot']) {
        const r = await report('deer', sc);
        eq(r.flags, [], `deer ${sc} flags`);
    }
});

await test('slip: planted hooves sliding are reported on every foot', async () => {
    const r = await report('deer:slip', 'walk');
    for (const f of ['LH', 'LF', 'RF', 'RH']) {
        check(has(r, new RegExp(`^slip: ${f} `)), `slip flag for ${f}: ${r.flags.join(' | ')}`);
        check(r.feet[f].slipping >= r.feet[f].stances / 2, `${f}: ${r.feet[f].slipping} of ${r.feet[f].stances} stances slip`);
        check(r.feet[f].slipMax > 0.05, `${f} slid ${r.feet[f].slipMax} m`);
    }
});

await test('sink: a hoof planted under the ground is reported', async () => {
    const r = await report('deer:sink', 'walk');
    check(has(r, /^penetration: LF toe/), `penetration flag: ${r.flags.join(' | ')}`);
    check(r.feet.LF.sinkMax > 0.05 && r.feet.LF.sinkShare > 0.3, `LF sinks ${r.feet.LF.sinkMax} m, ${r.feet.LF.sinkShare} of the run`);
    check(r.feet.LH.sinkMax < 0.008 && r.feet.RF.sinkMax < 0.008, 'the other hooves stay up');
});

await test('overbend: a joint driven past its limit is reported', async () => {
    const r = await report('deer:overbend', 'walk');
    check(has(r, /^limit: mtL\.x past its range/), `limit flag: ${r.flags.join(' | ')}`);
    check(r.joints.mtL.x.over > 0 && r.joints.mtL.x.excess > 20, `mtL past by ${r.joints.mtL.x.excess} deg`);
    eq(r.joints.mtR.x.over, 0, 'the right hock stays in range');
});

await test('stumble: a beat that jumps between strides is reported', async () => {
    const r = await report('deer:stumble', 'walk');
    check(has(r, /^footfall: RH's touchdown wanders/), `footfall flag: ${r.flags.join(' | ')}`);
    check(r.footfalls.legs.RH.offsetSpread > 0.04, `RH offset spread ${r.footfalls.legs.RH.offsetSpread}`);
    check(r.footfalls.legs.LH.offsetSpread < 0.02, 'the other legs keep their beat');
});

await test('reruns are bit-identical', async () => {
    const deer = await loadCreature('deer');
    for (const sc of ['trot', 'rough-walk', 'startle']) {
        const a = runScenario(deer, sc), b = runScenario(await loadCreature('deer'), sc);
        const same = (x, y) => {
            const u = new Uint32Array(x.buffer, x.byteOffset, x.length), v = new Uint32Array(y.buffer, y.byteOffset, y.length);
            if (u.length !== v.length) return false;
            for (let i = 0; i < u.length; i++) if (u[i] !== v[i]) return false;
            return true;
        };
        check(same(a.pose, b.pose), `${sc}: poses differ between runs`);
        check(same(a.tele, b.tele), `${sc}: telemetry differs between runs`);
        eq(JSON.stringify(analyzeRun(a).flags), JSON.stringify(analyzeRun(b).flags), `${sc} flags`);
    }
});

await test('the GPU rig and the CPU measures see one ground', async () => {
    // The ground module run on the GPU against the same module on the CPU.
    const k = bro.kernel.compile(`
        from creature::ground import height;
        @kernel @grid(1)
        fn k_h(g: grid<1>, env: read_store<f32, 1>, xz: read_store<f32, 1>, out: write_store<f32, 1>) {
            let i = g.x();
            out[i] = height(env, xz[2 * i], xz[2 * i + 1]);
        }`, { file: 'ground-check.bk', modules: { 'creature::ground': readApp('lab/ground.bk') } }).kernel('k_h');
    const env = groundEnv({ slope: 12, uphill: 30, rough: 0.06, wavelength: 1.4, seed: 3 });
    const n = 4096, xz = new Float32Array(2 * n);
    for (let i = 0; i < n; i++) { xz[2 * i] = ((i * 37) % 200) * 0.31 - 30; xz[2 * i + 1] = ((i * 91) % 300) * 0.27 - 40; }
    const bufs = [bro.kernel.createBuffer(env), bro.kernel.createBuffer(xz), bro.kernel.createBuffer(n * 4)];
    k.dispatch(n, ...bufs);
    const gpu = bufs[2].read(new Float32Array(n));
    const cpu = groundHeights(env, xz);
    let worst = 0;
    for (let i = 0; i < n; i++) worst = Math.max(worst, Math.abs(gpu[i] - cpu[i]));
    for (const b of bufs) b.destroy();
    check(worst < 1e-3, `GPU and CPU ground differ by ${worst} m`);
});

done('creature-lab oracle');
