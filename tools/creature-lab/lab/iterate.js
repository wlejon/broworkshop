// The lab's text tools for iterating on a rig: what a sheet shows in a
// picture, these say in a few lines a terminal can be read in, fast enough to
// run after every edit.
//
//   score   one line a scenario: the metrics' flags, kinks a second, the
//           root's kinks, the mass against friction and free fall, the
//           corners the swing feet turn
//   sweep   score for each value of a knob, as one table
//   kinks   where the kinks are: by the foot event they fall at and the
//           bones they are in, the root's, or one bone's every kink
//   trace   frame by frame through a window: one leg (planted, its toe over
//           the ground, from its top, against where the rig says it is, each
//           bone's angle, a * where it kinks) or named bones' angles, the
//           foot event nearest, and the rig's creature::probe values

import { loadCreature } from "./creature.js";
import { runScenario, groundHeights, PROBE_N } from "./run.js";
import { TELE, T } from "./contract.js";
import { jointAngles, boneHead, boneTail } from "./skeleton.js";
import { naturalness, smoothness, seen, NATURAL, kinks, turnSpike, footEvents } from "./natural.js";
import { naturalRun } from "./natural-out.js";

const DEG = 180 / Math.PI;
const pad = (s, n) => String(s).padStart(n);
const padR = (s, n) => String(s).padEnd(n);
const pct = (x) => `${Math.round(100 * x)}%`;

// --- score ----------------------------------------------------------------------------

// One run's headline numbers (score and sweep run what natural does: a
// steady gait for 20 s, so their numbers are natural's). `analyzeRun` is the metrics' analysis
// (commands.js), passed in so this file does not import the commands.
export function scoreRun(rec, analyzeRun) {
    const m = analyzeRun(rec);
    const n = naturalness(rec);
    const sm = n.smoothness;
    return {
        scenario: rec.scenario.name,
        flags: m.flags.length,
        natural: n.flags.length,
        kinks: sm.spikesPerSecond,
        at: sm.at.slice(0, 2).map((a) => a.event).join(', '),
        root: sm.root.reduce((s, r) => s + r.spikes.length, 0),
        seen: seen(rec).count,
        friction: n.mass.frictionShare,
        pull: n.mass.pullShare,
        // Of its steps in the air, those not falling as a body falls; null
        // when it is hardly ever in the air (a walker's instant between
        // footfalls is not a flight to judge).
        flightOff: n.mass.flightSteps >= 0.03 * rec.steps ? n.mass.flightOff : null,
        corners: n.arcs.reduce((s, a) => s + a.corners.length, 0),
        jitter: n.variety.joints.filter((j) => j.verdict === 'jitters').length,
        metricFlags: m.flags,
    };
}

const COLS = [
    ['flags', 6, (r) => r.flags], ['natural', 8, (r) => r.natural], ['kinks/s', 8, (r) => r.kinks.toFixed(1)],
    ['root', 5, (r) => r.root], ['seen', 5, (r) => r.seen], ['friction', 9, (r) => pct(r.friction)], ['pull', 5, (r) => pct(r.pull)],
    ['flight', 7, (r) => (r.flightOff == null ? '-' : pct(r.flightOff))], ['corners', 8, (r) => r.corners], ['jitter', 7, (r) => r.jitter],
];

export function scoreHeader(first, w) {
    return padR(first, w) + COLS.map(([h, n]) => pad(h, n)).join('') + '  kinks most at';
}

export function scoreLine(first, w, r) {
    return padR(first, w) + COLS.map(([, n, f]) => pad(f(r), n)).join('') + `  ${r.at}`;
}

export function scoreTable(creature, scenarios, analyzeRun, { seed = 1 } = {}) {
    const rows = scenarios.map((sc) => scoreRun(naturalRun(creature, sc, { seed }), analyzeRun));
    const lines = [`${creature.label}`, scoreHeader('scenario', 14), ...rows.map((r) => scoreLine(r.scenario, 14, r))];
    for (const r of rows) for (const f of r.metricFlags) lines.push(`  ${r.scenario}: ${f}`);
    return { rows, lines };
}

// --- sweep ----------------------------------------------------------------------------

// `sweep` NAME=a,b,c: each value over the rig as it is (and the other
// --knob overrides), per scenario.
export async function sweepTable(spec, sweep, scenarios, analyzeRun, { knobs = null, seed = 1 } = {}) {
    const [name, list] = String(sweep).split('=');
    if (!name || !list) throw new Error(`--sweep wants NAME=a,b,c, not '${sweep}'`);
    const values = list.split(',').map(Number);
    if (values.some((v) => !Number.isFinite(v))) throw new Error(`--sweep: '${list}' is not numbers`);
    const runs = [{ label: 'rig', creature: await loadCreature(spec, knobs) }];
    for (const v of values) runs.push({ label: `${name}=${v}`, creature: await loadCreature(spec, { ...(knobs || {}), [name]: v }) });
    return { name, values, ...compareTable(runs, scenarios, analyzeRun, { seed }) };
}

// score for several creatures (versions: a snapshot and the rig, or knob
// values), a table a scenario with a row each.
export function compareTable(runs, scenarios, analyzeRun, { seed = 1 } = {}) {
    const w = Math.max(...runs.map((r) => r.label.length)) + 2;
    const lines = [], out = {};
    for (const sc of scenarios) {
        lines.push(scoreHeader(sc, w));
        out[sc] = {};
        for (const r of runs) {
            const s = scoreRun(naturalRun(r.creature, sc, { seed }), analyzeRun);
            out[sc][r.label] = s;
            lines.push(scoreLine(r.label, w, s));
        }
    }
    return { scores: out, lines };
}

// --- kinks ----------------------------------------------------------------------------

// Where a run's kinks are. opts.bone: that bone's every kink; opts.at: the
// bones kinking at that event.
export function kinkReport(rec, { bone = null, at = null, top = 6 } = {}) {
    const sm = smoothness(rec);
    const L = [`${rec.scenario.name}: ${sm.spikesPerSecond} kinks a second`];
    if (bone) {
        const j = sm.joints.find((x) => x.bone === bone);
        if (!j) throw new Error(`kinks: no bone '${bone}' moves (have ${sm.joints.map((x) => x.bone).join(', ')})`);
        L.push(`  ${bone} (axis ${j.axis}, range ${j.range}°, median acceleration off its line ${j.medAcc} deg/s2): ${j.spikes.length} kinks`);
        for (const s of j.spikes) L.push(`    ${s.t.toFixed(2)} s  ${pad(s.jump, 7)}  ${s.at}`);
        return { lines: L, smoothness: sm };
    }
    // event -> bone -> spikes
    const byEv = new Map();
    for (const j of sm.joints) for (const s of j.spikes) {
        if (at && s.at !== at) continue;
        const m = byEv.get(s.at) || new Map();
        byEv.set(s.at, m);
        const a = m.get(j.bone) || [];
        a.push(s.jump);
        m.set(j.bone, a);
    }
    const evs = [...byEv].map(([ev, m]) => [ev, [...m].sort((a, b) => b[1].length - a[1].length), [...m.values()].reduce((s, a) => s + a.length, 0)])
        .sort((a, b) => b[2] - a[2]);
    for (const [ev, bones, n] of evs.slice(0, at ? 1 : top)) {
        const med = (a) => [...a].sort((p, q) => p - q)[a.length >> 1];
        L.push(`  ${padR(ev, 9)} ${pad(n, 5)}: ${bones.slice(0, at ? 99 : 6).map(([b, a]) => `${b} ${a.length} (~${Math.round(med(a) / 1000)}k)`).join(', ')}`);
    }
    const rk = sm.root.filter((r) => r.spikes.length);
    L.push(rk.length ? `  root: ${rk.map((r) => { const s = r.spikes.reduce((a, b) => (b.jump / b.limit > a.jump / a.limit ? b : a)); return `${r.channel} ${r.spikes.length} (worst ${s.jump} over its limit of ${s.limit}, at ${s.t} s)`; }).join(', ')}` : '  root: smooth');
    // When: the joints' kinks and the root's in each half second of the run
    // (a scenario of several parts kinks in some of them, not all).
    const half = (spikes) => { const c = new Array(Math.ceil(rec.steps * rec.dt * 2)).fill(0); for (const s of spikes) c[Math.min(c.length - 1, Math.floor(s.t * 2))]++; return c; };
    const jc = half(sm.joints.flatMap((j) => j.spikes)), rc = half(sm.root.flatMap((r) => r.spikes));
    // What of it can be seen (natural.js seen): the jolts, largest first.
    const sn = seen(rec);
    L.push(sn.count ? `  seen: ${sn.count} jolts (a point over ${NATURAL.seen} thousandths of its ${sn.height} m off its path in a step):` : `  seen: none (no point over ${NATURAL.seen} thousandths of its ${sn.height} m off its path in a step)`);
    for (const m of sn.moments.slice(0, 8)) L.push(`    ${m.t.toFixed(3)} s  ${pad(m.size.toFixed(1), 5)}  ${padR(m.at, 8)}  ${m.bones.join(', ')}`);
    L.push(`  by half second, joints: ${jc.join(' ')}`);
    L.push(`  by half second, root:   ${rc.join(' ')}`);
    // The moments: kinks within two steps of each other are one event of the
    // rig's (a rule switching, a target moving), and the moments most bones
    // kink at together are the ones to trace. `+root` where the root's place
    // kinks too.
    const all = sm.joints.flatMap((j) => j.spikes.map((s) => ({ k: Math.round(s.t / rec.dt), bone: j.bone, at: s.at })))
        .concat(sm.root.flatMap((r) => r.spikes.map((s) => ({ k: Math.round(s.t / rec.dt), bone: 'root', at: s.at }))))
        .sort((a, b) => a.k - b.k);
    const moments = [];
    for (const e of all) {
        const m = moments[moments.length - 1];
        if (m && e.k - m.k1 <= 2) { m.k1 = e.k; m.bones.add(e.bone); } else moments.push({ k0: e.k, k1: e.k, bones: new Set([e.bone]), at: e.at });
    }
    moments.sort((a, b) => b.bones.size - a.bones.size);
    const inTop = moments.slice(0, 14);
    const share = Math.round(100 * inTop.reduce((s, m) => s + m.bones.size, 0) / Math.max(1, moments.reduce((s, m) => s + m.bones.size, 0)));
    L.push(`  ${moments.length} moments; the ${inTop.length} most bones kink at together (${share}% of all):`);
    for (const m of inTop) {
        const names = [...m.bones].filter((b) => b !== 'root');
        L.push(`    ${(m.k0 * rec.dt).toFixed(3)}${m.k1 > m.k0 ? `-${(m.k1 * rec.dt).toFixed(3)}` : '      '} s  ${pad(names.length, 2)} bones${m.bones.has('root') ? ' +root' : '      '}  ${padR(m.at, 8)}  ${names.slice(0, 7).join(' ')}`);
    }
    return { lines: L, smoothness: sm };
}

// --- trace ----------------------------------------------------------------------------

// Frame by frame from `from` to `to` s. opts.leg: a foot's name (LF); or
// opts.bones: bone names; `every` steps.
export function traceText(rec, { leg = null, bones = null, root = false, from = null, to = null, every = 1 } = {}) {
    const skel = rec.creature.skel, dt = rec.dt, n = rec.steps;
    if (!(Number.isInteger(every) && every >= 1)) throw new Error(`trace: --every counts steps (a whole number, 1 or more; a step is ${dt.toFixed(4)} s), got ${every}`);
    const k0 = Math.max(3, Math.round((from ?? rec.scenario.duration * 0.5) / dt));
    const k1 = Math.min(n - 3, Math.round((to ?? (k0 * dt + 0.25)) / dt));
    if (k1 < k0) throw new Error(`trace: nothing from ${(k0 * dt).toFixed(2)} s: the run is ${(n * dt).toFixed(2)} s long`);
    const near = footEvents(rec);
    const feet = skel.feet;
    let chain = [], foot = null, top = -1;
    if (leg) {
        foot = feet.find((f) => f.name === leg);
        if (!foot) throw new Error(`trace: no foot '${leg}' (have ${feet.map((f) => f.name).join(', ')})`);
        const L = skel.parts.legs[foot.index];
        chain = L.chain;
        top = L.top;
    }
    if (bones) {
        for (const b of bones) if (skel.index(b) < 0) throw new Error(`trace: no bone '${b}'`);
        chain = chain.concat(bones.map((b) => skel.index(b)));
    }
    if (!chain.length && !root) throw new Error('trace: name a leg (--leg LF), bones (--bones a,b) or the root (--root)');
    // The root bone's place against the plan's (telemetry's position), in the
    // heading's frame, mm: across and ahead; its height in the world; and
    // how far each step's place in the world is off the line through the
    // steps either side (a pop shows as one large value, a smooth path as
    // almost none).
    const r0 = skel.bones.find((b) => b.parentIndex < 0).index;
    const rootAt = (k) => {
        const p = boneHead(rec.pose, k * rec.poseStride, r0), tb = k * TELE, yaw = rec.tele[tb + T.YAW];
        const d = [p[0] - rec.tele[tb + T.POS], p[1] - rec.tele[tb + T.POS + 1], p[2] - rec.tele[tb + T.POS + 2]];
        return [1000 * (d[0] * Math.cos(yaw) - d[2] * Math.sin(yaw)), 1000 * d[1], 1000 * (d[0] * Math.sin(yaw) + d[2] * Math.cos(yaw))];
    };
    // Each bone's flexion (its local x, the leg's plane) through the run,
    // and the steps it kinks at.
    const ang = chain.map(() => new Float64Array(n));
    for (let k = 0; k < n; k++) {
        const ja = jointAngles(rec.pose, k * rec.poseStride, skel);
        chain.forEach((b, i) => { ang[i][k] = ja[b][0] * DEG; });
    }
    const kinked = ang.map((a) => new Set(kinks(a, dt, near, turnSpike(skel)).spikes.map((s) => Math.round(s.t / dt))));
    const near1 = (set, k) => set.has(k) || set.has(k - 1) || set.has(k + 1);
    // The probe slots written in the window.
    const P = rec.probe;
    const slots = [];
    if (P) for (let i = 0; i < PROBE_N; i++) { for (let k = k0; k <= k1; k++) if (P[k * PROBE_N + i] !== 0) { slots.push(i); break; } }
    const fx = (v, w = 7) => pad(v.toFixed(3), w);
    const head = ['t', 'feet'];
    if (foot) head.push('   h', '  reach', '  ahead', ' below', '   miss');
    if (root) head.push(' across', '     up', ' over', '  ahead', ' off line');
    head.push(...chain.map((b) => pad(skel.bones[b].name.slice(0, 8), 9)), ...slots.map((i) => pad(`p${i}`, 8)), '  event');
    const lines = [`${rec.creature.label} ${rec.scenario.name}: ${leg ? `leg ${leg} (top ${skel.bones[top].name})` : ''}${bones ? ` bones ${bones.join(', ')}` : ''}; angles are each bone's flexion (deg, local x), * where it kinks`,
        head.join('  ')];
    for (let k = k0; k <= k1; k += every) {
        const tb = k * TELE;
        const pat = feet.map((f, i) => (rec.tele[tb + T.FOOT + 4 * i] > 0.5 ? f.name : '.'.repeat(f.name.length))).join(' ');
        const row = [(k * dt).toFixed(3), pat];
        if (foot) {
            const o = k * rec.poseStride;
            const toe = boneTail(rec.pose, o, skel.bones[foot.boneIndex]);
            const tp = boneHead(rec.pose, o, top);
            const gh = groundHeights(rec.env, new Float32Array([toe[0], toe[2]]))[0];
            const yaw = rec.tele[tb + T.YAW];
            const d = [toe[0] - tp[0], toe[1] - tp[1], toe[2] - tp[2]];
            const c = [rec.tele[tb + T.FOOT + 4 * foot.index + 1], rec.tele[tb + T.FOOT + 4 * foot.index + 2], rec.tele[tb + T.FOOT + 4 * foot.index + 3]];
            row.push(fx(toe[1] - gh, 6), fx(Math.hypot(...d)), fx(d[0] * Math.sin(yaw) + d[2] * Math.cos(yaw)), fx(-d[1], 6),
                fx(Math.hypot(toe[0] - c[0], toe[1] - c[1], toe[2] - c[2])));
        }
        if (root) {
            const b = rootAt(k);
            const w = [-1, 0, 1].map((j) => boneHead(rec.pose, (k + j) * rec.poseStride, r0));
            row.push(pad(b[0].toFixed(1), 7), pad((1000 * w[1][1]).toFixed(1), 7), pad(b[1].toFixed(0), 5), pad(b[2].toFixed(1), 7),
                pad((1000 * Math.hypot(w[1][0] - (w[0][0] + w[2][0]) / 2, w[1][1] - (w[0][1] + w[2][1]) / 2, w[1][2] - (w[0][2] + w[2][2]) / 2)).toFixed(2), 9));
        }
        chain.forEach((b, i) => row.push(pad(ang[i][k].toFixed(1) + (near1(kinked[i], k) ? '*' : ' '), 9)));
        for (const i of slots) row.push(pad(P[k * PROBE_N + i].toPrecision(4), 8));
        row.push(`  ${near[k] || ''}`);
        lines.push(row.join('  '));
    }
    lines.push('feet: a name where it is down (the rig\'s claim); h: the toe over the ground; reach: toe from the leg\'s top; ahead/below: along the heading and down;');
    lines.push('miss: the toe from the place the rig\'s telemetry gives (its target while it swings)');
    if (root) lines.push('across/ahead: the root bone from the plan\'s place, mm, in the heading\'s frame; up: its height in the world, mm; over: mm it is above the plan\'s height; off line: mm its place in the world is from the line through the steps either side');
    return { lines };
}
