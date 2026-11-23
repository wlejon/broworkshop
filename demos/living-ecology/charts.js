// HiDPI 2D charts (Species Biomass & Net Fitness from relational join + Energy×Stress Phase
// Density & ReactiveQuery chunk-reuse trace) and 3D viewport overlay annotations.

import { SPECIES_DEFS, ROLE_COLORS } from "/app/data.js";
import { evalOrganismManifold } from "/app/manifolds.js";

export function fitCanvas(canvas) {
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

export function buildPhaseGrid(organisms, maxSamples = 65536) {
    const PW = 64, PH = 36;
    const grid = new Float32Array(PW * PH);
    const nChunks = organisms.chunkCount;
    const total = Math.max(1, organisms.rowCount);
    const step = Math.max(1, Math.floor(total / maxSamples));
    let maxVal = 1.0;

    for (let ci = 0; ci < nChunks; ci++) {
        const rc = organisms.chunkRowCount(ci);
        if (rc === 0) continue;
        const eView = organisms.chunkColumnView(ci, 'energy');
        const sView = organisms.chunkColumnView(ci, 'stress');
        for (let r = 0; r < rc; r += step) {
            const e = eView[r];
            const s = sView[r];
            const gx = Math.floor(Math.max(0, Math.min(0.999, e / 1.65)) * PW);
            const gy = Math.floor((1.0 - Math.max(0, Math.min(0.999, s / 1.0))) * PH);
            const v = (grid[gy * PW + gx] += 1.0);
            if (v > maxVal) maxVal = v;
        }
    }
    return { PW, PH, grid, maxVal };
}

function phaseHeatColor(t) {
    const u = Math.pow(Math.max(0, Math.min(1, t)), 0.72);
    const r = Math.round(18 + 225 * Math.pow(u, 1.3));
    const g = Math.round(44 + 190 * Math.sin(u * Math.PI * 0.85));
    const b = Math.round(88 + 150 * (1.0 - u * 0.55));
    return `rgb(${r},${g},${b})`;
}

export function drawSpeciesChart(canvas, trophicRows) {
    if (!canvas) return;
    const [w, h] = fitCanvas(canvas);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#090e18';
    ctx.fillRect(0, 0, w, h);

    const padL = 24, padR = 10, padT = 18, padB = 18;
    const pw = Math.max(20, w - padL - padR);
    const ph = Math.max(20, h - padT - padB);

    const byId = new Map();
    if (trophicRows) {
        for (const r of trophicRows) byId.set(r.species_id | 0, r);
    }

    let maxBiomass = 1.0;
    let minFit = -1.2;
    let maxFit = 2.4;
    for (const sp of SPECIES_DEFS) {
        const r = byId.get(sp.species_id);
        if (r && r.totalBiomass > maxBiomass) maxBiomass = r.totalBiomass;
        if (r && Number.isFinite(r.avgFitness)) {
            if (r.avgFitness < minFit) minFit = r.avgFitness;
            if (r.avgFitness > maxFit) maxFit = r.avgFitness;
        }
    }

    const n = SPECIES_DEFS.length;
    const slotW = pw / n;
    const barW = Math.max(6, Math.min(28, slotW * 0.62));

    // Baseline & subtle gridlines
    ctx.strokeStyle = 'rgba(120, 155, 210, 0.20)';
    ctx.lineWidth = 1;
    for (let k = 0; k <= 2; k++) {
        const y = padT + (ph * k) / 2;
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(padL + pw, y);
        ctx.stroke();
    }

    ctx.font = '10px ui-monospace, monospace';
    for (let i = 0; i < n; i++) {
        const sp = SPECIES_DEFS[i];
        const row = byId.get(sp.species_id);
        const bio = row ? Math.max(0, row.totalBiomass || 0) : 0;
        const fit = row ? (row.avgFitness || 0) : 0;

        const cx = padL + slotW * (i + 0.5);
        const bx = cx - barW * 0.5;
        const bh = (bio / maxBiomass) * ph;
        const by = padT + ph - bh;

        ctx.fillStyle = sp.hex_col;
        ctx.globalAlpha = 0.84;
        ctx.fillRect(bx, by, barW, bh);
        ctx.globalAlpha = 1.0;

        // Fitness marker dot along normalized range
        const fitNorm = Math.max(0, Math.min(1, (fit - minFit) / Math.max(0.2, maxFit - minFit)));
        const fy = padT + ph * (1.0 - fitNorm);
        ctx.fillStyle = fit >= 0 ? '#7cf05e' : '#ff5a6e';
        ctx.strokeStyle = '#070b12';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, fy, 3.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#97abcc';
        ctx.textAlign = 'center';
        ctx.fillText(sp.code, cx, h - 4);
    }

    ctx.textAlign = 'left';
    ctx.fillStyle = '#7f93b5';
    ctx.fillText('biomass', 3, padT + 7);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#7cf05e';
    ctx.fillText('● fitness (e/metab - 1.5s)', padL + pw, padT - 4);
    ctx.textAlign = 'left';
}

export function drawPhaseAndReuseChart(canvas, phaseGrid, reuseHistory) {
    if (!canvas) return;
    const [w, h] = fitCanvas(canvas);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#090e18';
    ctx.fillRect(0, 0, w, h);

    const padL = 26, padT = 18, padB = 16;
    const splitX = Math.floor(w * 0.58);
    const pw = Math.max(20, splitX - padL - 10);
    const ph = Math.max(20, h - padT - padB);

    if (phaseGrid) {
        const cw = pw / phaseGrid.PW;
        const ch = ph / phaseGrid.PH;
        const denom = Math.log1p(phaseGrid.maxVal);
        for (let y = 0; y < phaseGrid.PH; y++) {
            for (let x = 0; x < phaseGrid.PW; x++) {
                const v = phaseGrid.grid[y * phaseGrid.PW + x];
                if (v <= 0.1) continue;
                ctx.fillStyle = phaseHeatColor(Math.log1p(v) / denom);
                ctx.fillRect(padL + x * cw, padT + y * ch, cw + 0.5, ch + 0.5);
            }
        }
    }

    // Critical thresholds: stress > 0.72 OR energy < 0.22
    const critY = padT + (1.0 - 0.72) * ph;
    const critX = padL + (0.22 / 1.65) * pw;
    ctx.strokeStyle = 'rgba(255, 84, 102, 0.78)';
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(padL, critY);
    ctx.lineTo(padL + pw, critY);
    ctx.moveTo(critX, padT);
    ctx.lineTo(critX, padT + ph);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = 'rgba(130, 165, 220, 0.28)';
    ctx.strokeRect(padL, padT, pw, ph);
    ctx.fillStyle = '#7f93b5';
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillText('1.0', 3, padT + 8);
    ctx.fillText('0.0', 3, padT + ph);
    ctx.fillText('energy 0', padL, h - 3);
    ctx.fillText('1.6', padL + pw - 18, h - 3);

    // Right subpanel: ReactiveQuery chunk-reuse trace (%)
    const rx = splitX + 10;
    const rw = Math.max(20, w - rx - 10);
    ctx.strokeStyle = 'rgba(130, 165, 220, 0.28)';
    ctx.strokeRect(rx, padT, rw, ph);

    const hist = reuseHistory || [];
    if (hist.length > 0) {
        ctx.fillStyle = 'rgba(47, 184, 120, 0.22)';
        ctx.strokeStyle = '#58d8ff';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        const stepX = hist.length > 1 ? (rw / (hist.length - 1)) : rw;
        for (let i = 0; i < hist.length; i++) {
            const x = rx + i * stepX;
            const y = padT + ph * (1.0 - Math.max(0, Math.min(1, hist[i].ratio)));
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.lineTo(rx + (hist.length - 1) * stepX, padT + ph);
        ctx.lineTo(rx, padT + ph);
        ctx.closePath();
        ctx.fill();

        const last = hist[hist.length - 1];
        const pct = Math.round(last.ratio * 100);
        ctx.fillStyle = '#8ef0c2';
        ctx.fillText(`reuse ${pct}% (${last.reused}/${last.total})`, rx + 4, padT + 11);
    } else {
        ctx.fillStyle = '#7f93b5';
        ctx.fillText('waiting for refresh…', rx + 6, padT + ph * 0.5);
    }
    ctx.fillStyle = '#7f93b5';
    ctx.fillText('ReactiveQuery chunks', rx, h - 3);
}

export function drawOverlay(canvas, view, state) {
    if (!canvas) return;
    const [w, h] = fitCanvas(canvas);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);

    const m = view.toManifold | 0;
    const t = view.smoothMorph;
    ctx.font = '11px ui-monospace, monospace';

    if (m === 0 && t > 0.45) {
        const labels = [
            ['Coral Reef Arc', 0.78, 0.16, 0.0],
            ['Thermal Vent Plume', 0.36, -0.45, 0.36],
            ['Pelagic Gyre', -0.58, 0.56, 0.42],
            ['Abyssal Trench', 0.0, -0.82, -0.64],
        ];
        ctx.fillStyle = `rgba(170, 215, 255, ${(0.55 * t).toFixed(2)})`;
        for (const [txt, x, y, z] of labels) {
            const p = view.project(x, y, z, w, h);
            if (p) ctx.fillText(txt, p.x, p.y);
        }
    } else if (m === 1 && t > 0.5) {
        const tiers = [
            ['Producers (Base)', 0.96, -0.74, 0.0, ROLE_COLORS[0]],
            ['Grazers (Tier 2)', 0.72, -0.25, 0.0, ROLE_COLORS[1]],
            ['Predators (Tier 3)', 0.48, 0.24, 0.0, ROLE_COLORS[2]],
            ['Decomposers (Apex)', 0.28, 0.73, 0.0, ROLE_COLORS[3]],
        ];
        for (const [txt, x, y, z, col] of tiers) {
            const p = view.project(x, y, z, w, h);
            if (p) {
                ctx.fillStyle = col;
                ctx.fillText(txt, p.x + 6, p.y);
            }
        }
    } else if (m === 2 && t > 0.5) {
        const critP = view.project(-0.45, 0.72 * 1.45 - 0.78, 0.0, w, h);
        if (critP) {
            ctx.fillStyle = '#ff7282';
            ctx.fillText('Critical Stress > 0.72', critP.x, critP.y - 6);
        }
        const thrivP = view.project(0.55, -0.55, 0.0, w, h);
        if (thrivP) {
            ctx.fillStyle = '#5ef2b8';
            ctx.fillText('High-Energy Thriving', thrivP.x, thrivP.y);
        }
    } else if (m === 3 && t > 0.5) {
        const topP = view.project(0.0, 0.92, 0.0, w, h);
        if (topP) {
            ctx.fillStyle = '#9be0ff';
            ctx.fillText('Age ↑ (7 yr) · Radius ∝ Energy', topP.x - 70, topP.y - 8);
        }
    }

    if (state.probePt && t > 0.55) {
        const anchor = state.probeHits && state.probeHits.length > 0
            ? evalOrganismManifold(m, state.probeHits[0])
            : (m === 0 ? state.probePt : null);
        if (anchor) {
            const cp = view.project(anchor[0], anchor[1], anchor[2], w, h);
            if (cp) {
                ctx.strokeStyle = state.lastActionKind === 'toxin' ? '#ff5c72' : '#66f2b8';
                ctx.lineWidth = 1.6;
                ctx.beginPath();
                ctx.arc(cp.x, cp.y, 15, 0, Math.PI * 2);
                ctx.stroke();
            }
            if (state.probeHits) {
                for (let i = 0; i < state.probeHits.length; i++) {
                    const row = state.probeHits[i];
                    const p3 = evalOrganismManifold(m, row);
                    const sp = view.project(p3[0], p3[1], p3[2], w, h);
                    if (!sp) continue;
                    if (cp) {
                        ctx.strokeStyle = 'rgba(102, 242, 184, 0.32)';
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        ctx.moveTo(cp.x, cp.y);
                        ctx.lineTo(sp.x, sp.y);
                        ctx.stroke();
                    }
                    const roleIdx = Math.min(3, Math.floor((row.species_id | 0) / 3));
                    ctx.fillStyle = ROLE_COLORS[roleIdx] || '#66f2b8';
                    ctx.beginPath();
                    ctx.arc(sp.x, sp.y, i === 0 ? 4.2 : 2.8, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }
    }
}
