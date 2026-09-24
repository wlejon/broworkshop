// 2D drawing of the isosurface sweep: the field slice as background, the
// marching-squares case strip, the history behind the cursor, and the
// current cell's in-flight micro-step.

import { MSQ_TABLE, CASE_COLOR, easeOutCubic, easeInOutCubic, edgePoints, solveVertex } from "./field.js";

const INSIDE = '#7ab0ff', OUTSIDE = '#ffb37a';
const DUAL_CSS = {
    dualContour: { line: '#ff9ed2', vert: '#ffd9ee', rgb: '255,158,210' },
    surfaceNets: { line: '#a7e1ff', vert: '#dffaff', rgb: '167,225,255' },
};

/** Paint the slice's signed field into `ctx` (an n x n canvas): blue inside, amber outside. */
export function paintField(ctx, slice) {
    const n = slice.n;
    if (ctx.canvas.width !== n) { ctx.canvas.width = n; ctx.canvas.height = n; }
    const img = ctx.createImageData(n, n);
    const lo = slice.mn - slice.iso, hi = slice.mx - slice.iso;
    for (let i = 0; i < n * n; i++) {
        const d = slice.signed[i];
        let r, g, b;
        if (d < 0) {
            const t = 1 - -d / Math.max(1e-6, -lo);
            r = 18 + t * 30; g = 40 + t * 50; b = 90 + t * 30;
        } else {
            const t = 1 - d / Math.max(1e-6, hi);
            r = 90 + t * 50; g = 55 + t * 35; b = 24 + t * 18;
        }
        img.data[i * 4] = r | 0; img.data[i * 4 + 1] = g | 0; img.data[i * 4 + 2] = b | 0; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
}

/** The largest centred square under a `padTop` band. */
export function fitSlice(W, H, padTop) {
    const usableH = H - padTop;
    const side = Math.min(W - 8, usableH - 8);
    return { ox: ((W - side) / 2) | 0, oy: padTop + (((usableH - side) / 2) | 0), side };
}

/** The 16-case table; pulses the entry being looked up. Returns the strip's bottom y. */
export function drawCaseStrip(ctx, W, sw, now) {
    const stripH = 42, padY = 4;
    const cellW = Math.max(14, ((W - 8) / 16) | 0);
    const phase = sw.phase;
    const hi = sw.currentCell >= 0 && phase && (phase.id === 'lookup' || phase.id === 'emit')
        ? sw.slice.cases[sw.currentCell] : -1;
    const ex = [0.5, 0, 1, 0.5, 0.5, 1, 0, 0.5];
    for (let i = 0; i < 16; i++) {
        const x0 = 4 + i * cellW, isHi = i === hi;
        ctx.fillStyle = CASE_COLOR[i];
        ctx.globalAlpha = isHi ? 0.6 + 0.35 * Math.sin(now / 90) : 0.18;
        ctx.fillRect(x0, padY, cellW - 1, stripH - padY);
        ctx.globalAlpha = 1;
        if (isHi) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(x0 + 0.5, padY + 0.5, cellW - 2, stripH - padY - 1);
        }
        const cx = x0 + 4, cy = padY + 4, cw = cellW - 9, ch = stripH - padY - 14;
        [[0, 0, 1], [1, 0, 2], [1, 1, 4], [0, 1, 8]].forEach(([u, v, bit]) => {
            ctx.fillStyle = i & bit ? INSIDE : OUTSIDE;
            ctx.beginPath();
            ctx.arc(cx + u * cw, cy + v * ch, 1.6, 0, Math.PI * 2);
            ctx.fill();
        });
        const segs = MSQ_TABLE[i];
        if (segs.length) {
            ctx.strokeStyle = isHi ? '#ffffff' : CASE_COLOR[i];
            ctx.lineWidth = isHi ? 2.2 : 1.4;
            ctx.beginPath();
            for (let s = 0; s < segs.length; s += 2) {
                const a = segs[s], b = segs[s + 1];
                ctx.moveTo(cx + ex[a * 2] * cw, cy + ex[a * 2 + 1] * ch);
                ctx.lineTo(cx + ex[b * 2] * cw, cy + ex[b * 2 + 1] * ch);
            }
            ctx.stroke();
        }
        ctx.fillStyle = isHi ? '#fff' : '#777';
        ctx.font = '9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(String(i), x0 + cellW / 2, padY + stripH - 3);
        ctx.textAlign = 'start';
    }
    ctx.strokeStyle = '#1c1c22';
    ctx.beginPath();
    ctx.moveTo(0, padY + stripH + 2);
    ctx.lineTo(W, padY + stripH + 2);
    ctx.stroke();
    return padY + stripH + 6;
}

function segPath(ctx, map, ex, segs, t) {
    for (let s = 0; s < segs.length; s += 2) {
        const a = segs[s], b = segs[s + 1];
        const p0 = map(ex[a * 2], ex[a * 2 + 1]), p1 = map(ex[b * 2], ex[b * 2 + 1]);
        ctx.moveTo(p0[0], p0[1]);
        ctx.lineTo(p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t);
    }
}

function vertexAt(sw, cellIdx) {
    const n = sw.slice.n, v = sw.vertices[cellIdx];
    return v && [cellIdx % (n - 1) + v.u, ((cellIdx / (n - 1)) | 0) + v.v];
}

/** Everything committed on this slice. map(x, y) takes grid coordinates to pixels. */
export function drawEmitted(ctx, map, sw) {
    const s = sw.slice;
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    if (sw.algo === 'marchingCubes') {
        for (const e of sw.emittedMC) {
            ctx.strokeStyle = CASE_COLOR[e.code];
            ctx.beginPath();
            segPath(ctx, map, edgePoints(s, e.cx, e.cy), MSQ_TABLE[e.code], 1);
            ctx.stroke();
        }
        return;
    }
    const css = DUAL_CSS[sw.algo];
    ctx.strokeStyle = css.line;
    ctx.beginPath();
    for (const t of sw.threads) {
        const a = vertexAt(sw, t.a), b = vertexAt(sw, t.b);
        if (!a || !b) continue;
        const p0 = map(a[0], a[1]), p1 = map(b[0], b[1]);
        ctx.moveTo(p0[0], p0[1]);
        ctx.lineTo(p1[0], p1[1]);
    }
    ctx.stroke();
    ctx.fillStyle = css.vert;
    for (const k in sw.vertices) {
        const v = vertexAt(sw, +k), p = map(v[0], v[1]);
        ctx.beginPath();
        ctx.arc(p[0], p[1], 2.2, 0, Math.PI * 2);
        ctx.fill();
    }
}

/** The cell under the cursor, drawn up to its current phase. */
export function drawCurrentCell(ctx, map, sw, now) {
    const cellIdx = sw.currentCell;
    if (cellIdx < 0) return;
    const s = sw.slice, n = s.n;
    const cx = cellIdx % (n - 1), cy = (cellIdx / (n - 1)) | 0;
    const pts = s.cellPts[cellIdx], code = s.cases[cellIdx];
    const phases = sw.phases, phase = sw.phase, phaseT = sw.phaseT, rank = sw.phaseIdx;
    const rankOf = (id) => phases.findIndex((p) => p.id === id);
    const reached = (id) => rank >= rankOf(id);
    const tIn = (id, ease) => (phase.id === id ? ease(phaseT) : 1);

    // Cell highlight, always.
    const p00 = map(cx, cy), p11 = map(cx + 1, cy + 1);
    const cw = p11[0] - p00[0], ch = p11[1] - p00[1];
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.4 + 0.35 * Math.sin(now / 120)).toFixed(2) + ')';
    ctx.lineWidth = 2;
    ctx.strokeRect(p00[0] - 1, p00[1] - 1, cw + 2, ch + 2);
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fillRect(p00[0], p00[1], cw, ch);

    // Corner signs from 'classify' on.
    if (reached('classify')) {
        ctx.globalAlpha = tIn('classify', easeOutCubic);
        for (const [dx, dy] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
            const p = map(cx + dx, cy + dy);
            ctx.fillStyle = s.signed[(cy + dy) * n + cx + dx] < 0 ? INSIDE : OUTSIDE;
            ctx.beginPath();
            ctx.arc(p[0], p[1], 3.6, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    if (sw.algo === 'marchingCubes') {
        if (phase.id === 'emit' && code !== 0 && code !== 15) {
            ctx.strokeStyle = CASE_COLOR[code];
            ctx.lineWidth = 2.4;
            ctx.lineCap = 'round';
            ctx.beginPath();
            segPath(ctx, map, edgePoints(s, cx, cy), MSQ_TABLE[code], easeInOutCubic(phaseT));
            ctx.stroke();
        }
        return;
    }
    if (!pts) return;
    const css = DUAL_CSS[sw.algo];
    const at = (u, v) => map(cx + u, cy + v);

    if (reached('crossings')) {
        const t = tIn('crossings', easeOutCubic);
        ctx.fillStyle = '#7ec8e3';
        ctx.globalAlpha = t;
        for (let j = 0; j < pts.length; j += 5) {
            const p = at(pts[j], pts[j + 1]);
            ctx.beginPath();
            ctx.arc(p[0], p[1], 3.0 * t + 1, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    let vertexPhase;
    if (sw.algo === 'surfaceNets') {
        vertexPhase = 'place';
        // Construction lines travel from each crossing to the centroid.
        if (reached('average')) {
            const t = tIn('average', easeInOutCubic);
            const v = solveVertex('surfaceNets', pts), cp = at(v.u, v.v);
            ctx.strokeStyle = 'rgba(167,225,255,' + (0.3 + 0.4 * t).toFixed(2) + ')';
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let j = 0; j < pts.length; j += 5) {
                const p0 = at(pts[j], pts[j + 1]);
                ctx.moveTo(p0[0], p0[1]);
                ctx.lineTo(p0[0] + (cp[0] - p0[0]) * t, p0[1] + (cp[1] - p0[1]) * t);
            }
            ctx.stroke();
        }
    } else {
        vertexPhase = 'solve';
        // Normals grow from each crossing, then the tangent constraint lines.
        if (reached('normals')) {
            const L = 0.32 * tIn('normals', easeOutCubic);
            ctx.strokeStyle = css.line;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            for (let j = 0; j < pts.length; j += 5) {
                const a = at(pts[j], pts[j + 1]);
                const b = at(pts[j] + pts[j + 2] * L, pts[j + 1] + pts[j + 3] * L);
                ctx.moveTo(a[0], a[1]);
                ctx.lineTo(b[0], b[1]);
            }
            ctx.stroke();
        }
        if (reached('constraints')) {
            const t = tIn('constraints', easeOutCubic), L = 0.55 * t;
            ctx.strokeStyle = 'rgba(255,158,210,' + (0.35 * (0.4 + 0.6 * t)).toFixed(2) + ')';
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let j = 0; j < pts.length; j += 5) {
                const tx = -pts[j + 3], ty = pts[j + 2];
                const a = at(pts[j] - tx * L, pts[j + 1] - ty * L);
                const b = at(pts[j] + tx * L, pts[j + 1] + ty * L);
                ctx.moveTo(a[0], a[1]);
                ctx.lineTo(b[0], b[1]);
            }
            ctx.stroke();
        }
        // The QEF vertex, with the plain centroid faded in for contrast.
        if (reached('solve')) {
            const t = tIn('solve', easeOutCubic);
            const v = solveVertex('dualContour', pts), vsn = solveVertex('surfaceNets', pts);
            const cp = at(v.u, v.v), sp = at(vsn.u, vsn.v);
            ctx.fillStyle = 'rgba(180,200,220,0.6)';
            ctx.beginPath();
            ctx.arc(sp[0], sp[1], 1.8, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,158,210,' + (0.6 * t).toFixed(2) + ')';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(sp[0], sp[1]);
            ctx.lineTo(cp[0], cp[1]);
            ctx.stroke();
        }
    }

    // The dual vertex pops in, then threads reach to the neighbours.
    if (reached(vertexPhase)) {
        const t = tIn(vertexPhase, easeOutCubic);
        const v = solveVertex(sw.algo, pts), cp = at(v.u, v.v);
        ctx.fillStyle = css.vert;
        ctx.beginPath();
        ctx.arc(cp[0], cp[1], 1.5 + 2.5 * t, 0, Math.PI * 2);
        ctx.fill();
    }
    if (phase.id === 'thread') {
        const v = solveVertex(sw.algo, pts), cp = at(v.u, v.v);
        const t = easeInOutCubic(phaseT);
        ctx.strokeStyle = css.line;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (const other of sw.activeNeighbors(cellIdx)) {
            const o = vertexAt(sw, other), op = map(o[0], o[1]);
            ctx.moveTo(cp[0], cp[1]);
            ctx.lineTo(cp[0] + (op[0] - cp[0]) * t, cp[1] + (op[1] - cp[1]) * t);
        }
        ctx.stroke();
    }
}

/** A full frame of the slice panel into `ctx` (W x H). */
export function drawSweep(ctx, W, H, sw, fieldCanvas, now) {
    ctx.clearRect(0, 0, W, H);
    const s = sw.slice;
    if (!s) return;
    const padTop = sw.algo === 'marchingCubes' ? drawCaseStrip(ctx, W, sw, now) : 0;
    const { ox, oy, side } = fitSlice(W, H, padTop);
    if (side <= 0) return;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(fieldCanvas, ox, oy, side, side);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(ox, oy, side, side);
    const k = side / s.n;
    const map = (x, y) => [ox + x * k, oy + y * k];
    drawEmitted(ctx, map, sw);
    drawCurrentCell(ctx, map, sw, now);
}
