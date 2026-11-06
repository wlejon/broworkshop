// The turnaround sheet: 8 views 45 degrees apart (columns) by the phases of
// a cycle or the times of an action (rows), in flat neutral light, over the
// ground under the creature, with height lines every 0.5 m, a metre bar,
// and each hoof marked: filled where the rig has it planted, hollow in
// swing, ringed red where it is under the ground.

import { beginSheet, saveSheet, text, line, rect, dot, INK, DIM, FAINT, CELL, FOOT_COLORS } from "./page.js";
import { cellCamera, placement, drawCells, groundCells, groundUnder } from "./cells.js";
import { lastCycle, sampleRows, toRelative, planted } from "./cycle.js";
import { boneTail } from "./skeleton.js";
import { T, TELE, GAIT_NAMES, ACTION_NAMES } from "./contract.js";
import { groundHeights } from "./run.js";

const DEG = Math.PI / 180;
// Columns: where the camera stands, as the turn of the creature that shows it.
export const VIEWS = [
    { name: 'right', yaw: 0 }, { name: 'front-right', yaw: -45 }, { name: 'front', yaw: -90 },
    { name: 'front-left', yaw: -135 }, { name: 'left', yaw: 180 }, { name: 'back-left', yaw: 135 },
    { name: 'back', yaw: 90 }, { name: 'back-right', yaw: 45 },
];

// The creature's extent along its length in the rest pose, for framing.
export function restExtent(skel) {
    let z0 = Infinity, z1 = -Infinity, y1 = 0;
    for (const b of skel.bones) for (const p of [b.head, b.tail]) { z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); y1 = Math.max(y1, p[1]); }
    return { z0, z1, top: y1, len: z1 - z0, mid: (z0 + z1) / 2 };
}

export function turnaroundSheet(rec, { path, rows = 10, cycle = 'auto', title = '', cw = 240, ch = 215 } = {}) {
    const t0 = Date.now();
    const creature = rec.creature, skel = creature.skel;
    const cyc = cycle === false ? null : (cycle && cycle !== 'auto' ? cycle : lastCycle(rec));
    const samples = sampleRows(rec, rows, cyc);
    const ext = restExtent(skel);
    const LM = 112, TM = 78, BM = 30;
    const W = LM + VIEWS.length * cw + 12, H = TM + rows * ch + BM;
    const k = Math.min((cw - 20) / (ext.len * 1.25), (ch - 34) / (ext.top * 1.12));
    const S = beginSheet(W, H, { scene: true });
    const cam = cellCamera(S.scene, W, H, k, 6);
    const g = S.g;

    const cells = [];
    samples.forEach((smp, r) => {
        const ground = groundUnder(rec, smp.step);
        VIEWS.forEach((v, c) => {
            const base = [LM + c * cw + cw / 2, TM + r * ch + ch - 26];
            const A = cam.unproject(base[0], base[1]);
            cells.push({ rec, step: smp.step, ground, row: r, col: c, base, place: placement(A, v.yaw * DEG, [0, 0, ext.mid]) });
        });
    });
    S.add(drawCells(S.scene, creature, cells).node);
    S.add(S.scene.createMesh({ mesh: groundCells(cells, { len: ext.len * 1.25, z0: ext.mid }), color: [1, 1, 1], vertexColorTint: true, roughness: 1, castsShadow: false }));

    // Cells, labels, height lines.
    for (let r = 0; r < rows; r++) for (let c = 0; c < VIEWS.length; c++) {
        const x = LM + c * cw, y = TM + r * ch;
        rect(g, x, y, cw, ch, null, FAINT);
        const by = y + ch - 26;
        for (const h of [0.5, 1.0, 1.5]) {
            const yy = by - h * cam.vk;
            if (yy > y + 4) line(g, x + 4, yy, x + cw - 4, yy, h === 1.0 ? '#a8a49a' : '#c4c0b6', 1, [4, 4]);
        }
    }
    VIEWS.forEach((v, c) => text(g, v.name, LM + c * cw + cw / 2, TM - 8, { align: 'center', size: 14, weight: 650 }));
    samples.forEach((smp, r) => {
        const y = TM + r * ch;
        const o = smp.step * TELE;
        const gait = GAIT_NAMES[rec.tele[o + T.GAIT] | 0] || '?';
        const act = ACTION_NAMES[rec.tele[o + T.ACTION] | 0] || '?';
        text(g, smp.phase != null ? `phase ${smp.phase.toFixed(2)}` : `t ${smp.t.toFixed(2)} s`, 8, y + 22, { size: 14, weight: 650 });
        text(g, `t ${smp.t.toFixed(2)} s`, 8, y + 40, { size: 12, color: DIM });
        text(g, `${gait}${act !== 'move' ? ' / ' + act : ''}`, 8, y + 57, { size: 12, color: DIM });
        text(g, `${rec.tele[o + T.SPEED].toFixed(2)} m/s`, 8, y + 74, { size: 12, color: DIM });
        // Feet: which are down.
        skel.feet.forEach((f, i) => {
            const down = planted(rec, smp.step, i);
            dot(g, 14 + i * 20, y + 92, 6, down ? FOOT_COLORS[i] : null, FOOT_COLORS[i]);
            text(g, f.name, 14 + i * 20, y + 110, { size: 10, align: 'center', color: DIM });
        });
    });

    // Hoof marks: projected from each copy's pose.
    const nbFeet = skel.feet.length;
    const toes = [];
    for (const c of cells) for (const f of skel.feet) {
        const p = boneTail(rec.pose, c.step * rec.poseStride, skel.bones[f.boneIndex]);
        toes.push(p[0], p[2]);
    }
    const under = groundHeights(rec.env, new Float32Array(toes));
    cells.forEach((c, ci) => {
        skel.feet.forEach((f, i) => {
            const pw = boneTail(rec.pose, c.step * rec.poseStride, skel.bones[f.boneIndex]);
            const depth = under[ci * nbFeet + i] - pw[1];
            const s = cam.project(c.place.apply(toRelative(rec, c.step, c.ground, pw)));
            const down = planted(rec, c.step, i);
            dot(g, s[0], s[1], 3.2, down ? FOOT_COLORS[i] : null, FOOT_COLORS[i]);
            if (depth > 0.005) dot(g, s[0], s[1], 7, null, '#e00000');
        });
    });

    // Header: title, the metre bar, the key.
    const sc = rec.scenario;
    const cy = cyc ? `cycle ${cyc.period.toFixed(3)} s (${(1 / cyc.period).toFixed(2)} Hz), rows by phase from left-hind touchdown`
                   : `rows by time across the run`;
    text(g, title || `${creature.label} · ${sc.name} · turnaround`, 10, 24, { size: 18, weight: 700 });
    text(g, `${sc.about || ''} — ${cy}`, 10, 46, { size: 13, color: DIM });
    const bx = W - 30 - k;
    line(g, bx, 30, bx + k, 30, INK, 3);
    line(g, bx, 24, bx, 36, INK, 2);
    line(g, bx + k, 24, bx + k, 36, INK, 2);
    text(g, '1 m', bx + k / 2, 22, { align: 'center', size: 12 });
    text(g, 'dashed: 0.5 / 1.0 / 1.5 m over the ground under the hips · dots: hooves (filled planted, hollow in swing, red ring under ground)',
         10, H - 10, { size: 12, color: DIM });
    const out = saveSheet(path);
    return { ...out, ms: Date.now() - t0, rows: samples, cycle: cyc };
}
