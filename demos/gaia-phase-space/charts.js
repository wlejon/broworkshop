// 2D chart strip (HR density + Toomre/Metallicity) & 3D manifold overlay renderer.

import { POP_COLORS } from "/app/data.js";

const KM_S_TO_KPC_MYR = 0.0010227;
const V0_SQ = 0.056298;

function mwAccelJS(px, py, pz) {
    const r2 = px * px + py * py;
    const invD = 1.0 / (r2 + 0.85);
    const ax = -V0_SQ * px * invD;
    const ay = -V0_SQ * py * invD;
    const rXy = Math.sqrt(r2);
    const hzScale = Math.exp(Math.max(-1.2, Math.min(1.4, (8.122 - rXy) * 0.10)));
    const kz = 0.0072 * hzScale / (1.0 + 0.45 * pz * pz);
    return [ax, ay, -kz * pz];
}

export function evalStarOrbitPos(star, timeMyr) {
    let px = star.gx, py = star.gy, pz = star.gz;
    if (Math.abs(timeMyr) <= 0.005) return [px, py, pz];
    let pvx = star.vx * KM_S_TO_KPC_MYR;
    let pvy = star.vy * KM_S_TO_KPC_MYR;
    let pvz = star.vz * KM_S_TO_KPC_MYR;
    const dt = timeMyr / 6.0;
    const hdt = 0.5 * dt;
    let a = mwAccelJS(px, py, pz);
    for (let s = 0; s < 6; s++) {
        pvx += a[0] * hdt; pvy += a[1] * hdt; pvz += a[2] * hdt;
        px += pvx * dt; py += pvy * dt; pz += pvz * dt;
        a = mwAccelJS(px, py, pz);
        pvx += a[0] * hdt; pvy += a[1] * hdt; pvz += a[2] * hdt;
    }
    return [px, py, pz];
}

export function evalStarManifold(m, star, timeMyr) {
    if (m === 0) {
        const [px, py, pz] = evalStarOrbitPos(star, timeMyr);
        return [px * 0.14, pz * 0.14, py * 0.14];
    }
    if (m === 1) {
        return [(star.bp_rp - 1.1) * 0.85, (4.5 - star.mg) * 0.18, (star.fe_h + 0.5) * 0.7];
    }
    if (m === 2) {
        const fh = Math.max(-2.5, Math.min(0.6, star.fe_h));
        return [(star.v_phi - 150.0) / 140.0, (star.v_perp - 90.0) / 110.0, fh * 0.55];
    }
    const rXy = Math.hypot(star.gx, star.gy);
    return [star.gz * 0.8, star.vz / 65.0, (rXy - 8.1) * 0.25];
}

export function buildDensityGrids(snap, filterMaskBits = null, maxSamples = 260000) {
    const HR_W = 104, HR_H = 44;
    const TM_W = 76, TM_H = 44;
    const FEH_BINS = 40;

    const hrGrid = new Float32Array(HR_W * HR_H);
    const toomreGrid = new Float32Array(TM_W * TM_H);
    const fehHist = new Float32Array(FEH_BINS);
    const fehFiltered = new Float32Array(FEH_BINS);

    const nRows = snap.rowCount;
    const step = Math.max(1, Math.floor(nRows / maxSamples));
    const nChunks = snap.chunkCount;

    let maxHr = 1, maxTm = 1, maxFeh = 1;

    for (let ci = 0; ci < nChunks; ci++) {
        const rc = snap.chunkRowCount(ci);
        const cOrd = snap.chunkColumnView(ci, 'ord');
        const cBprp = snap.chunkColumnView(ci, 'bp_rp');
        const cMg = snap.chunkColumnView(ci, 'mg');
        const cVp = snap.chunkColumnView(ci, 'v_phi');
        const cVpp = snap.chunkColumnView(ci, 'v_perp');
        const cFeh = snap.chunkColumnView(ci, 'fe_h');

        for (let r = 0; r < rc; r += step) {
            const idx = cOrd[r] >>> 0;
            const active = !filterMaskBits || ((filterMaskBits[idx >>> 5] >>> (idx & 31)) & 1) !== 0;

            const bp = cBprp[r];
            const mg = cMg[r];
            const vp = cVp[r];
            const vpp = cVpp[r];
            const feh = cFeh[r];

            const hx = Math.floor(((bp + 0.4) / 3.8) * HR_W);
            const hy = Math.floor(((mg + 3.0) / 17.5) * HR_H);
            if (hx >= 0 && hx < HR_W && hy >= 0 && hy < HR_H) {
                const w = active ? 1.0 : 0.04;
                const v = (hrGrid[hy * HR_W + hx] += w);
                if (v > maxHr) maxHr = v;
            }

            const tx = Math.floor(((vp + 180.0) / 500.0) * TM_W);
            const ty = Math.floor((1.0 - Math.min(1.0, Math.max(0.0, vpp / 310.0))) * (TM_H - 1));
            if (tx >= 0 && tx < TM_W && ty >= 0 && ty < TM_H) {
                const w = active ? 1.0 : 0.04;
                const v = (toomreGrid[ty * TM_W + tx] += w);
                if (v > maxTm) maxTm = v;
            }

            const fb = Math.floor(((feh + 2.5) / 3.1) * FEH_BINS);
            if (fb >= 0 && fb < FEH_BINS) {
                const v = (fehHist[fb] += 1.0);
                if (v > maxFeh) maxFeh = v;
                if (active) fehFiltered[fb] += 1.0;
            }
        }
    }

    return {
        HR_W, HR_H, hrGrid, maxHr,
        TM_W, TM_H, toomreGrid, maxTm,
        FEH_BINS, fehHist, fehFiltered, maxFeh,
    };
}

function hrColor(t, bpFrac) {
    const u = Math.pow(Math.max(0, Math.min(1, t)), 0.72);
    // Blend from cool blue (bpFrac=0) -> cream -> amber-red (bpFrac=1), scaled by density u
    let r = 120, g = 180, b = 255;
    if (bpFrac < 0.38) {
        const s = bpFrac / 0.38;
        r = 110 + 135 * s;
        g = 175 + 70 * s;
        b = 255;
    } else if (bpFrac < 0.72) {
        const s = (bpFrac - 0.38) / 0.34;
        r = 245 + 10 * s;
        g = 245 - 65 * s;
        b = 255 - 165 * s;
    } else {
        const s = (bpFrac - 0.72) / 0.28;
        r = 255 - 15 * s;
        g = 180 - 100 * s;
        b = 90 - 45 * s;
    }
    const lum = 0.22 + 0.78 * u;
    return `rgb(${Math.round(r * lum)},${Math.round(g * lum)},${Math.round(b * lum)})`;
}

function heatColor(t) {
    const u = Math.pow(Math.max(0, Math.min(1, t)), 0.75);
    const r = Math.round(32 + 218 * u);
    const g = Math.round(24 + 188 * Math.pow(u, 1.2));
    const b = Math.round(78 + 165 * Math.sin(u * Math.PI * 0.85));
    return `rgb(${r},${g},${b})`;
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

export function drawCharts(hrCanvas, toomreCanvas, grids, state) {
    if (hrCanvas && grids) {
        const [w, h] = syncCanvasSize(hrCanvas);
        const ctx = hrCanvas.getContext('2d');
        ctx.fillStyle = '#090e18';
        ctx.fillRect(0, 0, w, h);

        const padL = 26, padR = 8, padT = 15, padB = 15;
        const pw = Math.max(10, w - padL - padR);
        const ph = Math.max(10, h - padT - padB);
        const cw = pw / grids.HR_W;
        const ch = ph / grids.HR_H;
        const denom = Math.log1p(grids.maxHr);

        for (let y = 0; y < grids.HR_H; y++) {
            for (let x = 0; x < grids.HR_W; x++) {
                const v = grids.hrGrid[y * grids.HR_W + x];
                if (v <= 0.05) continue;
                ctx.fillStyle = hrColor(Math.log1p(v) / denom, x / (grids.HR_W - 1));
                ctx.fillRect(padL + x * cw, padT + y * ch, cw + 0.5, ch + 0.5);
            }
        }

        // Active M_G filter window
        const yMin = padT + ((state.mgMin + 3.0) / 17.5) * ph;
        const yMax = padT + ((state.mgMax + 3.0) / 17.5) * ph;
        if (state.mgMin > -5.9 || state.mgMax < 14.9) {
            ctx.strokeStyle = 'rgba(102, 242, 184, 0.85)';
            ctx.lineWidth = 1;
            ctx.strokeRect(padL, Math.max(padT, yMin), pw, Math.max(2, Math.min(padT + ph, yMax) - Math.max(padT, yMin)));
        }

        // Probe stars overlay
        if (state.probeHits) {
            ctx.fillStyle = '#66f2b8';
            ctx.strokeStyle = '#07111a';
            for (const s of state.probeHits) {
                const sx = padL + ((s.bp_rp + 0.4) / 3.8) * pw;
                const sy = padT + ((s.mg + 3.0) / 17.5) * ph;
                if (sx >= padL && sx <= padL + pw && sy >= padT && sy <= padT + ph) {
                    ctx.beginPath();
                    ctx.arc(sx, sy, 3.0, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                }
            }
        }

        ctx.strokeStyle = 'rgba(130, 165, 220, 0.28)';
        ctx.strokeRect(padL, padT, pw, ph);
        ctx.fillStyle = '#7f93b5';
        ctx.font = '10px ui-monospace, monospace';
        ctx.fillText('-3', 4, padT + 9);
        ctx.fillText('14', 4, padT + ph);
        ctx.fillText('BP-RP  0', padL, h - 3);
        ctx.fillText('3.0', padL + pw - 22, h - 3);
    }

    if (toomreCanvas && grids) {
        const [w, h] = syncCanvasSize(toomreCanvas);
        const ctx = toomreCanvas.getContext('2d');
        ctx.fillStyle = '#090e18';
        ctx.fillRect(0, 0, w, h);

        const padL = 26, padT = 15, padB = 15;
        const splitX = Math.floor(w * 0.64);
        const tw = Math.max(10, splitX - padL - 8);
        const th = Math.max(10, h - padT - padB);
        const cw = tw / grids.TM_W;
        const ch = th / grids.TM_H;
        const denom = Math.log1p(grids.maxTm);

        for (let y = 0; y < grids.TM_H; y++) {
            for (let x = 0; x < grids.TM_W; x++) {
                const v = grids.toomreGrid[y * grids.TM_W + x];
                if (v <= 0.05) continue;
                ctx.fillStyle = heatColor(Math.log1p(v) / denom);
                ctx.fillRect(padL + x * cw, padT + y * ch, cw + 0.5, ch + 0.5);
            }
        }

        // Toomre |V - V_LSR| = 180 km/s boundary ellipse
        const vlsrX = padL + ((232.0 + 180.0) / 500.0) * tw;
        const vlsrY = padT + th;
        const rx = (180.0 / 500.0) * tw;
        const ry = (180.0 / 310.0) * th;
        ctx.save();
        ctx.beginPath();
        ctx.rect(padL, padT, tw, th);
        ctx.clip();
        ctx.strokeStyle = 'rgba(130, 195, 255, 0.55)';
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.ellipse(vlsrX, vlsrY, rx, ry, 0, Math.PI, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        if (state.clusters) {
            ctx.font = '10px ui-monospace, monospace';
            for (const c of state.clusters) {
                const cx = padL + ((c.center.v_phi + 180.0) / 500.0) * tw;
                const cy = padT + (1.0 - Math.min(1, Math.max(0, c.center.v_perp / 310.0))) * th;
                if (cx >= padL && cx <= padL + tw && cy >= padT && cy <= padT + th) {
                    ctx.strokeStyle = '#ffd479';
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.fillStyle = '#ffd479';
                    ctx.fillText('C' + (c.id + 1), cx + 6, cy + 3);
                }
            }
        }

        if (state.probeHits) {
            ctx.fillStyle = '#66f2b8';
            for (const s of state.probeHits) {
                const sx = padL + ((s.v_phi + 180.0) / 500.0) * tw;
                const sy = padT + (1.0 - Math.min(1, Math.max(0, s.v_perp / 310.0))) * th;
                if (sx >= padL && sx <= padL + tw && sy >= padT && sy <= padT + th) {
                    ctx.beginPath();
                    ctx.arc(sx, sy, 2.8, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }

        ctx.strokeStyle = 'rgba(130, 165, 220, 0.28)';
        ctx.strokeRect(padL, padT, tw, th);
        ctx.fillStyle = '#7f93b5';
        ctx.font = '10px ui-monospace, monospace';
        ctx.fillText('300', 2, padT + 9);
        ctx.fillText('0', 12, padT + th);
        ctx.fillText('v_φ  0', padL + 10, h - 4);
        ctx.fillText('232', vlsrX - 10, h - 4);

        // Right subpanel: [Fe/H] Metallicity Distribution (sqrt-compressed for dynamic range)
        const fx0 = splitX + 10;
        const fw = Math.max(10, w - fx0 - 8);
        const bw = fw / grids.FEH_BINS;
        const fDenom = Math.sqrt(Math.max(1, grids.maxFeh));
        for (let b = 0; b < grids.FEH_BINS; b++) {
            const hAll = (Math.sqrt(grids.fehHist[b]) / fDenom) * th;
            const hFil = (Math.sqrt(grids.fehFiltered[b]) / fDenom) * th;
            ctx.fillStyle = 'rgba(120, 155, 210, 0.22)';
            ctx.fillRect(fx0 + b * bw, padT + th - hAll, Math.max(1, bw - 0.5), hAll);
            ctx.fillStyle = '#7ab8ff';
            ctx.fillRect(fx0 + b * bw, padT + th - hFil, Math.max(1, bw - 0.5), hFil);
        }
        if (state.fehMin > -2.49 || state.fehMax < 0.59) {
            const bx0 = fx0 + ((state.fehMin + 2.5) / 3.1) * fw;
            const bx1 = fx0 + ((state.fehMax + 2.5) / 3.1) * fw;
            ctx.strokeStyle = 'rgba(102, 242, 184, 0.85)';
            ctx.strokeRect(bx0, padT, Math.max(2, bx1 - bx0), th);
        }
        ctx.strokeStyle = 'rgba(130, 165, 220, 0.28)';
        ctx.strokeRect(fx0, padT, fw, th);
        ctx.fillStyle = '#7f93b5';
        ctx.fillText('[Fe/H] -2.5', fx0, h - 4);
        ctx.fillText('+0.6', fx0 + fw - 24, h - 4);
    }
}

export function drawOverlay(canvas, view, state) {
    const [w, h] = syncCanvasSize(canvas);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);

    const m = view.toManifold | 0;
    const t = view.smoothMorph;
    ctx.font = '11px ui-monospace, monospace';

    if (m === 0 && t > 0.35) {
        const alpha = Math.min(1, (t - 0.35) / 0.65) * 0.45;
        ctx.strokeStyle = `rgba(110, 170, 255, ${alpha.toFixed(2)})`;
        ctx.lineWidth = 1;
        for (const rKpc of [4.0, 8.122, 12.0]) {
            const rad = rKpc * 0.14;
            ctx.beginPath();
            let started = false;
            for (let i = 0; i <= 64; i++) {
                const ang = (i / 64) * Math.PI * 2.0;
                const p = view.project(rad * Math.cos(ang), 0, rad * Math.sin(ang), w, h);
                if (!p) { started = false; continue; }
                if (!started) { ctx.moveTo(p.x, p.y); started = true; }
                else ctx.lineTo(p.x, p.y);
            }
            ctx.stroke();
        }
        const gc = view.project(0, 0, 0, w, h);
        if (gc) {
            ctx.fillStyle = `rgba(255, 210, 130, ${(alpha * 1.8).toFixed(2)})`;
            ctx.fillText('GC (0,0)', gc.x + 6, gc.y - 4);
        }
        const sun = view.project(-8.122 * 0.14, 0.021 * 0.14, 0, w, h);
        if (sun) {
            ctx.strokeStyle = '#ffd479';
            ctx.beginPath();
            ctx.arc(sun.x, sun.y, 5, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = '#ffd479';
            ctx.fillText('Sol (-8.12 kpc)', sun.x + 8, sun.y + 3);
        }
    } else if (m === 1 && t > 0.5) {
        const labels = [
            ['Main Sequence', 0.1, -0.3, 0.0],
            ['Red Clump', 0.15, 0.72, 0.25],
            ['White Dwarfs', -0.82, -1.25, 0.1],
            ['Giants (RGB)', 0.55, 0.95, 0.0],
        ];
        ctx.fillStyle = 'rgba(180, 215, 255, 0.7)';
        for (const [txt, x, y, z] of labels) {
            const p = view.project(x, y, z, w, h);
            if (p) ctx.fillText(txt, p.x, p.y);
        }
    } else if (m === 2 && t > 0.5) {
        const gse = view.project(-1.07, 0.85, -0.72, w, h);
        if (gse) {
            ctx.strokeStyle = 'rgba(217, 119, 255, 0.7)';
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.arc(gse.x, gse.y, 26, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = '#e7a8ff';
            ctx.fillText('Gaia-Sausage-Enceladus (v_φ ≈ 0)', gse.x + 12, gse.y - 28);
        }
        const disk = view.project(0.58, -0.60, 0.0, w, h);
        if (disk) {
            ctx.fillStyle = '#8ec5ff';
            ctx.fillText('Thin Disk (v_φ ≈ 230)', disk.x + 8, disk.y + 4);
        }
    } else if (m === 3 && t > 0.5) {
        const p0 = view.project(0, 0, 0, w, h);
        if (p0) {
            ctx.strokeStyle = 'rgba(120, 210, 255, 0.45)';
            ctx.beginPath();
            ctx.arc(p0.x, p0.y, 8, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = '#9be0ff';
            ctx.fillText('Sgr Impact Phase Spiral (z, v_z)', p0.x + 12, p0.y - 10);
        }
    }

    if (state.probeHits && state.probeHits.length > 0 && t > 0.65) {
        const time = m === 0 ? state.timeMyr : 0.0;
        const centerStar = {
            gx: state.probePt[0], gy: state.probePt[1], gz: state.probePt[2],
            vx: state.probeHits[0].vx, vy: state.probeHits[0].vy, vz: state.probeHits[0].vz,
            v_phi: state.probeHits[0].v_phi, v_perp: state.probeHits[0].v_perp,
            bp_rp: state.probeHits[0].bp_rp, mg: state.probeHits[0].mg, fe_h: state.probeHits[0].fe_h,
        };
        const c3 = evalStarManifold(m, centerStar, time);
        const cp = view.project(c3[0], c3[1], c3[2], w, h);
        if (cp) {
            ctx.strokeStyle = '#66f2b8';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(cp.x, cp.y, 16, 0, Math.PI * 2);
            ctx.stroke();
        }
        for (let i = 0; i < state.probeHits.length; i++) {
            const s = state.probeHits[i];
            const p3 = evalStarManifold(m, s, time);
            const sp = view.project(p3[0], p3[1], p3[2], w, h);
            if (!sp) continue;
            if (cp) {
                ctx.strokeStyle = 'rgba(102, 242, 184, 0.35)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(cp.x, cp.y);
                ctx.lineTo(sp.x, sp.y);
                ctx.stroke();
            }
            ctx.fillStyle = POP_COLORS[s.pop] || '#66f2b8';
            ctx.beginPath();
            ctx.arc(sp.x, sp.y, i === 0 ? 4.0 : 2.8, 0, Math.PI * 2);
            ctx.fill();
            if (i === 0) {
                ctx.fillStyle = '#eafff5';
                ctx.fillText(`★ #1 Teff=${Math.round(s.teff)}K M_G=${s.mg.toFixed(1)}`, sp.x + 8, sp.y - 6);
            }
        }
    }
}
