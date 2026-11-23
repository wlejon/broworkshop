// 2D chart strip (BAO Spherical Shell Correlation + N(z) Lookback Histogram)
// and 3D manifold / BAO Acoustic Radar overlay renderer.

import { SPEC_COLORS, lookbackGyr } from "/app/data.js";

export function evalGalaxyManifold(m, g) {
    if (m === 0 || m === 3) {
        return [g.cx * 0.0008, g.cz * 0.0008, g.cy * 0.0008];
    }
    if (m === 1) {
        const ra = Math.atan2(g.cy, g.cx);
        const rc = 0.25 + 0.35 * g.z;
        return [Math.cos(ra) * rc, (g.z - 1.2) * 0.85, Math.sin(ra) * rc];
    }
    return [(g.g_r - 0.8) * 1.1, (g.z - 1.0) * 0.9, (g.r_z - 0.5) * 1.1];
}

export function buildRedshiftHistogram(snap, filterMaskBits = null, maxSamples = 260000) {
    const BINS = 35; // z = 0.0 .. 3.5 (dz = 0.1)
    const zAll = new Float32Array(BINS);
    const zActive = new Float32Array(BINS);
    const zBySpec = [
        new Float32Array(BINS),
        new Float32Array(BINS),
        new Float32Array(BINS),
        new Float32Array(BINS),
    ];

    const nRows = snap.rowCount;
    const step = Math.max(1, Math.floor(nRows / maxSamples));
    const nChunks = snap.chunkCount;

    for (let ci = 0; ci < nChunks; ci++) {
        const rc = snap.chunkRowCount(ci);
        const cOrd = snap.chunkColumnView(ci, 'ord');
        const cZ = snap.chunkColumnView(ci, 'z');
        const cSpec = snap.chunkColumnView(ci, 'spectype');
        for (let r = 0; r < rc; r += step) {
            const zv = cZ[r];
            const b = Math.floor((zv / 3.5) * BINS);
            if (b < 0 || b >= BINS) continue;
            zAll[b] += 1.0;

            const idx = cOrd[r] >>> 0;
            const active = !filterMaskBits || ((filterMaskBits[idx >>> 5] >>> (idx & 31)) & 1) !== 0;
            if (active) {
                zActive[b] += 1.0;
                const sp = Math.max(0, Math.min(3, cSpec[r] | 0));
                zBySpec[sp][b] += 1.0;
            }
        }
    }

    let maxBin = 1.0;
    for (let b = 0; b < BINS; b++) {
        if (zAll[b] > maxBin) maxBin = zAll[b];
    }
    return { BINS, zAll, zActive, zBySpec, maxBin };
}

function syncCanvasSize(canvas) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = Math.max(16, Math.round(canvas.clientWidth || canvas.width || 16));
    const cssH = Math.max(16, Math.round(canvas.clientHeight || canvas.height || 16));
    const bw = Math.round(cssW * dpr);
    const bh = Math.round(cssH * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return [cssW, cssH];
}

export function drawCharts(baoCanvas, zCanvas, zHist, state) {
    if (baoCanvas) {
        const [w, h] = syncCanvasSize(baoCanvas);
        const ctx = baoCanvas.getContext('2d');
        ctx.fillStyle = '#090e18';
        ctx.fillRect(0, 0, w, h);

        const padL = 34, padR = 10, padT = 16, padB = 16;
        const pw = Math.max(10, w - padL - padR);
        const ph = Math.max(10, h - padT - padB);

        // Acoustic horizon band 95..115 Mpc/h around r_s = 105 Mpc/h
        const x95 = padL + (95.0 / 220.0) * pw;
        const x105 = padL + (105.0 / 220.0) * pw;
        const x115 = padL + (115.0 / 220.0) * pw;
        ctx.fillStyle = 'rgba(102, 242, 184, 0.11)';
        ctx.fillRect(x95, padT, Math.max(4, x115 - x95), ph);

        ctx.strokeStyle = 'rgba(102, 242, 184, 0.45)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x105, padT);
        ctx.lineTo(x105, padT + ph);
        ctx.stroke();
        ctx.setLineDash([]);

        const bao = state.baoProbe;
        let minVal = -0.6;
        let maxVal = 1.4;
        if (bao && bao.shells && bao.shells.length > 0) {
            for (const s of bao.shells) {
                if (s.r2xi < minVal) minVal = s.r2xi;
                if (s.r2xi > maxVal) maxVal = s.r2xi;
            }
            const padRange = Math.max(0.4, (maxVal - minVal) * 0.15);
            minVal = Math.min(-0.35, minVal - padRange * 0.4);
            maxVal = Math.max(0.85, maxVal + padRange * 0.5);
        }

        const valToY = (v) => {
            const norm = (v - minVal) / Math.max(1e-4, maxVal - minVal);
            return padT + (1.0 - Math.max(0, Math.min(1, norm))) * ph;
        };
        const yZero = valToY(0.0);

        // Zero baseline (uniform Poisson expectation)
        ctx.strokeStyle = 'rgba(140, 170, 220, 0.35)';
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(padL, yZero);
        ctx.lineTo(padL + pw, yZero);
        ctx.stroke();
        ctx.setLineDash([]);

        // Subtle fiducial LCDM BAO template curve peaking at 105 Mpc/h
        ctx.strokeStyle = 'rgba(255, 212, 121, 0.32)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (let i = 0; i <= 44; i++) {
            const r = (i / 44) * 220.0;
            const d = (r - 105.0) / 13.0;
            const ref = 0.55 * Math.exp(-0.5 * d * d) + 0.12 * Math.exp(-r / 65.0);
            const px = padL + (r / 220.0) * pw;
            const py = valToY(ref * (maxVal * 0.55));
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.stroke();

        if (bao && bao.shells && bao.shells.length > 0) {
            const shells = bao.shells;
            // Shaded fill relative to baseline
            ctx.beginPath();
            ctx.moveTo(padL + (shells[0].rMid / 220.0) * pw, yZero);
            for (const s of shells) {
                ctx.lineTo(padL + (s.rMid / 220.0) * pw, valToY(s.r2xi));
            }
            ctx.lineTo(padL + (shells[shells.length - 1].rMid / 220.0) * pw, yZero);
            ctx.closePath();
            ctx.fillStyle = bao.isVoid ? 'rgba(94, 150, 255, 0.18)' : 'rgba(102, 242, 184, 0.18)';
            ctx.fill();

            // Main r^2 * xi(r) correlation polyline
            ctx.strokeStyle = bao.isVoid ? '#6ea8ff' : '#66f2b8';
            ctx.lineWidth = 2.0;
            ctx.beginPath();
            for (let i = 0; i < shells.length; i++) {
                const s = shells[i];
                const px = padL + (s.rMid / 220.0) * pw;
                const py = valToY(s.r2xi);
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.stroke();

            // Markers for each 10 Mpc/h radial bin
            for (const s of shells) {
                const px = padL + (s.rMid / 220.0) * pw;
                const py = valToY(s.r2xi);
                const isPeak = s.bin === bao.baoPeakBin;
                ctx.fillStyle = isPeak ? '#ffd479' : (s.r2xi >= 0 ? '#66f2b8' : '#7aa4ff');
                ctx.beginPath();
                ctx.arc(px, py, isPeak ? 4.0 : 2.1, 0, Math.PI * 2);
                ctx.fill();
                if (isPeak) {
                    ctx.strokeStyle = '#090e18';
                    ctx.lineWidth = 1.2;
                    ctx.stroke();
                    ctx.fillStyle = '#ffd479';
                    ctx.font = '10px ui-monospace, monospace';
                    ctx.fillText(`BAO ${Math.round(s.rMid)} Mpc/h`, Math.min(padL + pw - 86, px + 6), Math.max(padT + 10, py - 6));
                }
            }
        }

        ctx.strokeStyle = 'rgba(130, 165, 220, 0.28)';
        ctx.lineWidth = 1;
        ctx.strokeRect(padL, padT, pw, ph);

        ctx.fillStyle = '#7f93b5';
        ctx.font = '10px ui-monospace, monospace';
        ctx.fillText(maxVal.toFixed(1), 3, padT + 9);
        ctx.fillText('0', 18, Math.max(padT + 18, Math.min(padT + ph - 6, yZero + 3)));
        ctx.fillText('0', padL, h - 3);
        ctx.fillStyle = '#66f2b8';
        ctx.fillText('105', x105 - 10, h - 3);
        ctx.fillStyle = '#7f93b5';
        ctx.fillText('220 Mpc/h', padL + pw - 56, h - 3);
    }

    if (zCanvas && zHist) {
        const [w, h] = syncCanvasSize(zCanvas);
        const ctx = zCanvas.getContext('2d');
        ctx.fillStyle = '#090e18';
        ctx.fillRect(0, 0, w, h);

        const padL = 28, padR = 10, padT = 16, padB = 16;
        const pw = Math.max(10, w - padL - padR);
        const ph = Math.max(10, h - padT - padB);
        const bw = pw / zHist.BINS;
        const denom = Math.sqrt(Math.max(1, zHist.maxBin));

        for (let b = 0; b < zHist.BINS; b++) {
            const x = padL + b * bw;
            const hAll = (Math.sqrt(zHist.zAll[b]) / denom) * ph;
            ctx.fillStyle = 'rgba(120, 155, 210, 0.18)';
            ctx.fillRect(x, padT + ph - hAll, Math.max(1, bw - 1), hAll);

            let yCursor = padT + ph;
            for (let sp = 0; sp < 4; sp++) {
                const cnt = zHist.zBySpec[sp][b];
                if (cnt <= 0) continue;
                const hSeg = ((Math.sqrt(zHist.zActive[b]) / denom) * ph) * (cnt / Math.max(1e-6, zHist.zActive[b]));
                ctx.fillStyle = SPEC_COLORS[sp];
                ctx.fillRect(x, yCursor - hSeg, Math.max(1, bw - 1), hSeg);
                yCursor -= hSeg;
            }
        }

        // Active RangeIndex('z') shell window bracket
        if (state.zMin > 0.01 || state.zMax < 3.49) {
            const x0 = padL + (state.zMin / 3.5) * pw;
            const x1 = padL + (state.zMax / 3.5) * pw;
            ctx.strokeStyle = 'rgba(102, 242, 184, 0.9)';
            ctx.lineWidth = 1.4;
            ctx.strokeRect(x0, padT, Math.max(3, x1 - x0), ph);
        }

        ctx.strokeStyle = 'rgba(130, 165, 220, 0.28)';
        ctx.lineWidth = 1;
        ctx.strokeRect(padL, padT, pw, ph);

        ctx.fillStyle = '#7f93b5';
        ctx.font = '10px ui-monospace, monospace';
        ctx.fillText('N(z)', 2, padT + 9);
        ctx.fillText('z=0', padL, h - 3);
        ctx.fillText(`z=1 (${lookbackGyr(1.0).toFixed(1)}Gyr)`, padL + (1.0 / 3.5) * pw - 24, h - 3);
        ctx.fillText(`z=2 (${lookbackGyr(2.0).toFixed(1)}Gyr)`, padL + (2.0 / 3.5) * pw - 24, h - 3);
        ctx.fillText('3.5 (11.8Gyr)', padL + pw - 74, h - 3);
    }
}

function drawWorldCircle(ctx, view, w, h, cx, cy, cz, rad, axis = 'xz', steps = 48) {
    ctx.beginPath();
    let started = false;
    for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * Math.PI * 2.0;
        const ca = Math.cos(a) * rad;
        const sa = Math.sin(a) * rad;
        let wx = cx, wy = cy, wz = cz;
        if (axis === 'xz') { wx += ca; wz += sa; }
        else if (axis === 'xy') { wx += ca; wy += sa; }
        else { wy += ca; wz += sa; }
        const p = view.project(wx, wy, wz, w, h);
        if (!p) { started = false; continue; }
        if (!started) { ctx.moveTo(p.x, p.y); started = true; }
        else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
}

export function drawOverlay(canvas, view, state) {
    const [w, h] = syncCanvasSize(canvas);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);

    const m = view.toManifold | 0;
    const t = view.smoothMorph;
    ctx.font = '11px ui-monospace, monospace';

    if ((m === 0 || m === 3) && t > 0.35) {
        const alpha = Math.min(1, (t - 0.35) / 0.65) * 0.35;
        ctx.strokeStyle = `rgba(110, 170, 255, ${alpha.toFixed(2)})`;
        ctx.lineWidth = 1;
        drawWorldCircle(ctx, view, w, h, 0, 0, 0, 1000.0 * 0.0008, 'xz', 64);
        drawWorldCircle(ctx, view, w, h, 0, 0, 0, 2000.0 * 0.0008, 'xz', 64);

        const obs = view.project(0, 0, 0, w, h);
        if (obs) {
            ctx.strokeStyle = '#ffd479';
            ctx.beginPath();
            ctx.arc(obs.x, obs.y, 4, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = '#ffd479';
            ctx.fillText('Observer (z=0)', obs.x + 7, obs.y - 4);
        }

        // 3D BAO Spherical Shell Acoustic Radar overlay at active probe center
        if (state.baoProbe && t > 0.65) {
            const p = state.baoProbe.center;
            const wx = p[0] * 0.0008;
            const wy = p[2] * 0.0008;
            const wz = p[1] * 0.0008;

            // Outer 220 Mpc/h SpatialIndex query sphere
            ctx.strokeStyle = 'rgba(102, 185, 255, 0.32)';
            ctx.setLineDash([4, 3]);
            drawWorldCircle(ctx, view, w, h, wx, wy, wz, 220.0 * 0.0008, 'xz', 44);
            drawWorldCircle(ctx, view, w, h, wx, wy, wz, 220.0 * 0.0008, 'xy', 44);
            ctx.setLineDash([]);

            // 105 Mpc/h Big Bang BAO acoustic sound horizon shell
            ctx.strokeStyle = state.baoProbe.isVoid ? 'rgba(110, 185, 255, 0.85)' : 'rgba(102, 242, 184, 0.90)';
            ctx.lineWidth = 1.5;
            drawWorldCircle(ctx, view, w, h, wx, wy, wz, 105.0 * 0.0008, 'xz', 48);
            drawWorldCircle(ctx, view, w, h, wx, wy, wz, 105.0 * 0.0008, 'xy', 48);
            drawWorldCircle(ctx, view, w, h, wx, wy, wz, 105.0 * 0.0008, 'yz', 48);

            const cp = view.project(wx, wy, wz, w, h);
            if (cp) {
                ctx.fillStyle = state.baoProbe.isVoid ? '#9ec8ff' : '#66f2b8';
                ctx.beginPath();
                ctx.arc(cp.x, cp.y, 4.0, 0, Math.PI * 2);
                ctx.fill();
                const tag = state.baoProbe.isVoid
                    ? `Deep Void (${state.baoProbe.totalNeighbors} objs < 220 Mpc/h)`
                    : `BAO Shell 105 Mpc/h (${state.baoProbe.totalNeighbors} objs)`;
                ctx.fillText(tag, cp.x + 8, cp.y - 7);
            }
        }
    } else if (m === 1 && t > 0.45) {
        const alpha = Math.min(1, (t - 0.45) / 0.55) * 0.45;
        ctx.strokeStyle = `rgba(140, 195, 255, ${alpha.toFixed(2)})`;
        ctx.lineWidth = 1;
        for (const zMark of [0.5, 1.0, 2.0, 3.0]) {
            const rCone = 0.25 + 0.35 * zMark;
            const yCone = (zMark - 1.2) * 0.85;
            drawWorldCircle(ctx, view, w, h, 0, yCone, 0, rCone, 'xz', 56);
            const lp = view.project(rCone, yCone, 0, w, h);
            if (lp) {
                ctx.fillStyle = 'rgba(180, 220, 255, 0.75)';
                ctx.fillText(`z=${zMark.toFixed(1)} (${lookbackGyr(zMark).toFixed(1)} Gyr)`, lp.x + 6, lp.y + 3);
            }
        }
    } else if (m === 2 && t > 0.45) {
        const marks = [
            ['Red Sequence (LRGs)', 0.52, -0.35, 0.22, '#ffb570'],
            ['Blue Star-Forming Cloud', -0.42, -0.45, -0.25, '#78ccff'],
            ['High-z Quasars (QSO)', -0.58, 0.95, -0.22, '#e2a3ff'],
        ];
        for (const [txt, x, y, z, col] of marks) {
            const p = view.project(x, y, z, w, h);
            if (p) {
                ctx.fillStyle = col;
                ctx.fillText(txt, p.x, p.y);
            }
        }
    }
}
