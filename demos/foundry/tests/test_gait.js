// The test stand's motion, measured: through a whole cycle of each gait no
// foot goes under the floor, a planted foot moves back at the speed the
// machine moves forward (it does not slide), and the legs stay their length.
import { check, done, frames, shot } from "/lib/kit/test.js";
import { poseAt } from "/lib/mech/gait.js";
import { hullBasis, hullCorners, hullToLocal } from "/lib/mech/skeleton.js";
import { add, sub, len, qrot, mirrorV } from "/lib/mech/vec.js";

const F = globalThis.__foundry;
frames(20);
const d = F.design, r = F.report;
const feet = r.insts.filter((it) => it.seg.role === 'foot');
const corners = (it, pose) => {
    const B = hullBasis(it.seg), t = pose[it.id];
    return hullCorners(it.seg).map((c) => { let p = hullToLocal(B, c); if (it.side < 0) p = mirrorV(p); return add(t.pos, qrot(t.rot, p)); });
};
const lowest = (it, pose) => Math.min(...corners(it, pose).map((p) => p[1]));

for (const gait of ['stand', 'walk', 'sprint']) {
    const g0 = poseAt(d, r, gait, 0);
    const speed = g0.speed, period = gait === 'stand' ? 1 : (gait === 'sprint' ? r.move.stride : 1.25 * r.move.legLength) / speed;
    const root = r.insts[0].id;
    console.log(`  ${gait}: hips ride ${(r.rest.pos[root][1] - g0.pose[root].pos[1]).toFixed(2)} m low of ${r.move.legLength.toFixed(1)} m of leg, stride ${r.move.stride.toFixed(1)} m`);
    let minY = Infinity, maxSlide = 0, maxStretch = 0, planted = 0;
    const N = 240, dt = period / N;
    let prev = null;
    for (let i = 0; i <= N; i++) {
        const g = poseAt(d, r, gait, i * dt);
        for (const it of feet) {
            const y = lowest(it, g.pose);
            minY = Math.min(minY, y);
            if (prev) {
                // A corner on the ground in both samples should have gone back by speed * dt.
                const a = corners(it, prev.pose), b = corners(it, g.pose);
                let on = false;
                for (let k = 0; k < a.length; k++) {
                    if (a[k][1] > 0.004 || b[k][1] > 0.004) continue;
                    on = true;
                    maxSlide = Math.max(maxSlide, Math.abs(b[k][2] - a[k][2] - speed * dt) / Math.max(1e-6, speed * dt || 1));
                }
                if (on) planted++;
            }
        }
        for (const it of r.insts) {
            if (!it.parent) continue;
            const want = len(it.seg.attach), got = len(sub(g.pose[it.id].pos, g.pose[it.parent].pos));
            maxStretch = Math.max(maxStretch, Math.abs(got - want));
        }
        prev = g;
    }
    console.log(`${gait}: speed ${speed.toFixed(1)} m/s, period ${period.toFixed(2)} s, lowest foot ${minY.toFixed(3)} m, slide ${(maxSlide * 100).toFixed(1)}%, stretch ${maxStretch.toFixed(4)} m, planted samples ${planted}`);
    check(minY > -0.25, gait + ': no foot goes under the floor');
    check(maxStretch < 1e-3, gait + ': every joint stays where it is attached');
    if (gait !== 'stand') { check(planted > N * 0.5, gait + ': a foot is on the ground most of the time'); check(maxSlide < 0.08, gait + ': planted feet do not slide'); }
}
for (const gait of ['hover', 'burn']) {
    const g = poseAt(d, r, gait, 1.0);
    check(g.air && Math.min(...feet.map((it) => lowest(it, g.pose))) > 2, gait + ': it is off the ground');
    check(Object.values(g.jets).some((v) => v > 0.2), gait + ': jets are lit');
}

// Frames of a running stride, to look at.
F.setMode('test'); F.setGait('sprint');
F.vp.reframe([0, 24, 0], 120, { yaw: Math.PI * 1.5, pitch: -0.04 });
for (let i = 0; i < 4; i++) { frames(9); shot('gait-run-' + i, '#stage'); }
F.setGait('walk');
for (let i = 0; i < 2; i++) { frames(22); shot('gait-walk-' + i, '#stage'); }
F.setGait('burn'); frames(20); shot('gait-burn', '#stage');
done('foundry gait');
