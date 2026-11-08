// The bunny's own motion oracle: what a rabbit's hop and bound do, measured
// on a run (lab/analyze.js calls a creature's `motion` with its series).
//
//   flights     spans with no foot down: their share of the run, the longest,
//               and how far the hips rise over one.
//   trunk       the hips-to-withers spacing along the heading: its swing
//               (stretched by the hind push, gathered as the hips catch up).
//   head        the head's height over the withers against its resting
//               carriage, and its bob against the withers' (a rabbit going
//               lifts its head, and carries it steadier than its chest).
//   hind ahead  where each hind foot lands along the heading against the fore
//               feet's last prints: a rabbit's hind feet land beside or ahead
//               of them, well ahead in the bound.
//
// Flags hold a steady gait to that: the bound flies, its hind feet land
// ahead, its trunk stretches and gathers; any gait's hind feet land no
// further back than the fore prints, its head is carried no lower against the
// withers than at rest and bobs no more than they do.

import { TELE, T } from "../../lab/contract.js";

const RUN_SPEED = 1.5;      // m/s from which a steady run is a bound
const HIND_BEHIND = 0.02;   // m a hind foot may land behind the fore prints at most
const r3 = (v) => Math.round(v * 1000) / 1000;

export function motion(rec, S, { steadyFrom, steady, headBob }) {
    const skel = rec.creature.skel, n = rec.steps, nf = skel.feet.length, ns = S.ns;
    const flags = [];
    const ti = (name) => skel.tracks.findIndex((t) => t.name === name);
    const hi = ti('hips'), wi = ti('withers'), di = ti('head');
    const yaw = (k) => rec.tele[k * TELE + T.YAW];
    const along = (k, p) => p[0] * Math.sin(yaw(k)) + p[2] * Math.cos(yaw(k));
    const toe = (k, i) => { const s = ((k * nf + i) * ns) * 3; return [S.sole[s], S.sole[s + 1], S.sole[s + 2]]; };
    const down = (k, i) => S.contact[k * nf + i] === 1;
    let speed = 0;
    for (let k = steadyFrom; k < n; k++) speed += rec.tele[k * TELE + T.SPEED];
    speed /= Math.max(1, n - steadyFrom);
    const moving = speed > 0.1;

    // --- flights -------------------------------------------------------------------
    let air = 0, longest = 0, rise = 0, run = 0, y0 = 0, ymax = 0;
    for (let k = steadyFrom; k < n; k++) {
        let any = false;
        for (let i = 0; i < nf; i++) if (down(k, i)) any = true;
        const y = S.tracks[k][hi][1];
        if (!any) {
            if (!run) { y0 = y; ymax = y; }
            run++; air++; ymax = Math.max(ymax, y);
        } else if (run) {
            longest = Math.max(longest, run); rise = Math.max(rise, ymax - y0); run = 0;
        }
    }
    const flights = { share: r3(air / Math.max(1, n - steadyFrom)), longestS: r3(longest * rec.dt), hipRise: r3(rise) };

    // --- trunk -----------------------------------------------------------------------
    let lo = 1e9, hiS = -1e9;
    for (let k = steadyFrom; k < n; k++) {
        const d = along(k, S.tracks[k][wi]) - along(k, S.tracks[k][hi]);
        lo = Math.min(lo, d); hiS = Math.max(hiS, d);
    }
    const trunk = { spacing: [r3(lo), r3(hiS)], swing: r3(hiS - lo) };

    // --- head ------------------------------------------------------------------------
    let over = 0, minOver = 1e9;
    for (let k = steadyFrom; k < n; k++) {
        const o = S.tracks[k][di][1] - S.tracks[k][wi][1];
        over += o; minOver = Math.min(minOver, o);
    }
    // At rest, on all fours, by the skeleton.
    const restY = (t) => { const b = skel.bones[skel.tracks[t].boneIndex]; return b.head[1] + (b.tail[1] - b.head[1]) * skel.tracks[t].at; };
    const head = { overWithers: r3(over / Math.max(1, n - steadyFrom)), minOverWithers: r3(minOver), rest: r3(restY(di) - restY(wi)) };

    // --- hind feet landing against the fore prints --------------------------------------
    const last = new Array(nf).fill(null);
    const ahead = [];
    for (let k = Math.max(1, steadyFrom); k < n; k++) {
        for (let i = 0; i < nf; i++) {
            if (!down(k, i) || down(k - 1, i)) continue;
            const f = skel.feet[i];
            if (!f.hind) { last[i] = toe(k, i); continue; }
            const prints = skel.feet.map((g, j) => (!g.hind && last[j] ? along(k, last[j]) : null)).filter((v) => v !== null);
            if (prints.length) ahead.push(along(k, toe(k, i)) - Math.min(...prints));
        }
    }
    const mean = ahead.length ? ahead.reduce((a, b) => a + b, 0) / ahead.length : null;
    const hind = { landings: ahead.length, aheadMean: mean === null ? null : r3(mean), aheadMin: ahead.length ? r3(Math.min(...ahead)) : null };

    // --- flags (a steady gait) ------------------------------------------------------------
    if (steady && moving) {
        const bound = speed > RUN_SPEED;
        if (bound && flights.share < 0.05) flags.push(`rabbit: a bound at ${speed.toFixed(1)} m/s off the ground only ${(100 * flights.share).toFixed(0)}% of the time`);
        if (bound && trunk.swing < 0.01) flags.push(`rabbit: the trunk stretches and gathers by only ${(100 * trunk.swing).toFixed(1)} cm in the bound`);
        if (bound && mean !== null && mean < 0) flags.push(`rabbit: in the bound the hind feet land ${(-100 * mean).toFixed(1)} cm behind the fore prints on average`);
        if (hind.aheadMin !== null && hind.aheadMin < -HIND_BEHIND) flags.push(`rabbit: a hind foot lands ${(-100 * hind.aheadMin).toFixed(1)} cm behind the fore prints`);
        if (head.overWithers < head.rest) flags.push(`rabbit: the head is carried ${(100 * (head.rest - head.overWithers)).toFixed(1)} cm lower against the withers than at rest`);
        if (headBob && headBob.ratio > 1) flags.push(`rabbit: the head bobs ${headBob.ratio.toFixed(2)} times as much as the withers`);
    }
    return { speed: r3(speed), flights, trunk, head, hind, flags };
}
