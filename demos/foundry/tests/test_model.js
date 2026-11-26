// The starter mech, evaluated: it stands, walks, flies level and has nothing
// wrong with it; and the model answers edits the way a designer expects.
import { check, done } from "/lib/kit/test.js";
import { starterBiped } from "/lib/mech/starter.js";
import { evaluate } from "/lib/mech/evaluate.js";
import { clone, removeSegment } from "/lib/mech/design.js";
import { REGIME_KEYS, LINE_KINDS } from "/lib/mech/catalog.js";

const t0 = performance.now();
const d = starterBiped();
const t1 = performance.now();
const r = evaluate(d);
const t2 = performance.now();

const f = (v, n = 1) => (v === Infinity ? 'inf' : Number(v).toFixed(n));
console.log(`starter built in ${f(t1 - t0)} ms, evaluated in ${f(t2 - t1)} ms`);
console.log(`mass ${f(r.mass.total / 1e3)} t: frame ${f(r.mass.frame / 1e3)} armor ${f(r.mass.armor / 1e3)} act ${f(r.mass.actuators / 1e3)} lines ${f(r.mass.lines / 1e3)} modules ${f(r.mass.modules / 1e3)} (fuel ${f(r.mass.fuel / 1e3)}, ammo ${f(r.mass.ammo / 1e3)})`);
console.log(`height ${f(r.height)} m, com ${r.com.map((v) => f(v, 2))}, inertia ${r.inertia.map((v) => v.toExponential(2))}`);
for (const k of REGIME_KEYS) {
    const g = r.regimes[k];
    console.log(`  ${k.padEnd(7)} jets ${f(g.levels.jets, 2)} ` + LINE_KINDS.map((n) => `${n} ${f(g[n].demand)}/${f(g[n].supply)}${g[n].endurance !== Infinity ? ' (' + f(g[n].endurance, 0) + ' s)' : ''}`).join('  '));
}
console.log(`move: stands ${r.move.stands} walk ${f(r.move.walk)} sprint ${f(r.move.sprint)} m/s (${r.move.limit}) jump ${f(r.move.jump)} m, foot ${f(r.move.footPressure, 0)} kPa, balance ${r.move.balance ? [r.move.balance.front, r.move.balance.back, r.move.balance.side].map((v) => f(v)) : '-'}`);
if (r.move.limits) console.log('  limits: ' + r.move.limits.map((l) => `${l[0]} ${f(l[1])}`).join('; '));
console.log(`flight: thrust ${f(r.flight.thrust / 1e6)} MN, T/W ${f(r.flight.tw, 2)}, hover ok ${r.flight.hover.ok} throttle ${f(r.flight.hover.throttle, 2)} residual force ${f(r.flight.hover.force / 1e6, 2)} MN torque ${f(r.flight.hover.torque / 1e6)} MN m (gyro ${f(r.flight.hover.gyro / 1e6)}), top ${f(r.flight.topSpeed, 0)} m/s, authority ${r.flight.authority.map((v) => f(v))} deg/s2`);
console.log(`  jets: ` + r.flight.jets.map((j, i) => `${j.key} ${f(j.thrust / 1e6)}MN@${f(r.flight.hover.each[i], 2)}`).join(' '));
console.log(`weapons: ${f(r.dps, 0)} MW sustained, alpha ${f(r.alpha, 0)} MJ; ` + r.weapons.map((w) => `${w.key} ${f(w.rate, 0)}`).join(' '));
for (const id in r.joints) {
    const j = r.joints[id];
    console.log(`  joint ${id.padEnd(10)} hold ${f(j.hold / 1e6, 0)} have ${f(j.torqueHave / 1e6, 0)} | struct ${f(j.struct / 1e6, 0)} have ${f(j.structHave / 1e6, 0)}`);
}
console.log('protection: ' + r.protection.map((p) => `${p.label}@${p.seg} ${f(p.mm, 0)}mm ${p.faceName}`).join('; '));
for (const i of r.issues) console.log(`  ${i.level}: ${i.text}`);
for (const x of r.failures.slice(0, 8)) console.log(`  lose ${x.name}: ${x.lost.join(', ')}`);

check(r.issues.filter((i) => i.level === 'error').length === 0, 'the starter has no errors');
check(r.move.stands && r.move.sprint > r.move.walk && r.move.walk > 3, 'it stands, walks and runs');
check(r.flight.hover.ok && r.flight.tw > 1.1, 'it holds level in the air with thrust to spare');
check(r.height > 40 && r.height < 60, 'it is between 40 and 60 m tall');
check(isFinite(r.regimes.combat.power.endurance) === false && r.regimes.combat.coolant.sat >= 1, 'it holds combat power and heat');

// Armour is weight.
{
    const e = clone(d);
    for (const s of e.segments) for (const k in s.armor) s.armor[k].t *= 2;
    const r2 = evaluate(e, { failures: false });
    check(Math.abs((r2.mass.armor - 2 * r.mass.armor) / r.mass.armor) < 1e-6, 'twice the plate is twice the armour mass');
    check(r2.flight.tw < r.flight.tw, 'and less thrust to weight');
}
// A machine without its backpack loses lift and its trim.
{
    const e = clone(d);
    check(removeSegment(e, 'nacelle'), 'the lift nacelles come off');
    const r2 = evaluate(e, { failures: false });
    check(r2.flight.lift < r.flight.lift * 0.75, 'without it there is much less lift');
}
// The legs cannot be removed.
check(!removeSegment(clone(d), 'shin'), 'a biped keeps its legs');
// Losing a leg loses its footing.
check(r.failures.some((x) => x.seg === 'thigh' && x.lost.includes('its footing')), 'a thigh shot away drops it');
done();
