// 2D evolutionary telemetry charts (Clade Fitness + Bitwise Trait Prevalence, Phenotype Distribution +
// Timeline Branch Delta) and 3D manifold overlay renderer for Evolutionary Biosphere.

import { NICHES, PHYLA, TRAIT_FLAGS } from "/app/data.js";

const TAU = Math.PI * 2.0;

export function evalCreatureManifold(m, row) {
    if (m === 0) {
        return [row.x, row.y, row.z];
    }
    if (m === 1) {
        const f = Math.max(0.0, Math.min(1.0, row.fitness));
        return [row.gene_a * 0.72, (f - 0.45) * 2.1, row.gene_b * 0.72];
    }
    if (m === 2) {
        const f = Math.max(0.0, Math.min(1.0, row.fitness));
        const theta = (Math.abs(row.gene_a) < 1e-5 && Math.abs(row.gene_b) < 1e-5)
            ? 0.0
            : Math.atan2(row.gene_b, row.gene_a) + (row.clade_id / 32.0) * 0.42;
        const r = (1.0 - f) * 1.12 + 0.06;
        const yCone = (f - 0.38) * 2.1;
        return [Math.cos(theta) * r, yCone, Math.sin(theta) * r];
    }
    const f = Math.max(0.0, Math.min(1.0, row.fitness));
    const gen = Math.max(0.0, Math.min(36.0, row.generation || 0));
    const ang = (row.clade_id / 32.0) * TAU + gen * 0.18 + row.gene_a * 0.22;
    const rad = 0.25 + (row.clade_id / 32.0) * 0.76 + (1.0 - f) * 0.16;
    const ySpire = (gen / 36.0 - 0.42) * 2.1;
    return [Math.cos(ang) * rad, ySpire, Math.sin(ang) * rad];
}

export function buildFitnessHistogram(snap, bins = 16, maxSamples = 65536) {
    const counts = new Float32Array(bins);
    if (!snap || snap.rowCount === 0) return { bins, counts, total: 0, mean: 0 };
    const step = Math.max(1, Math.floor(snap.rowCount / maxSamples));
    let total = 0;
    let sum = 0;
    for (let ci = 0; ci < snap.chunkCount; ci++) {
        const rc = snap.chunkRowCount(ci);
        const fitView = snap.chunkColumnView(ci, 'fitness');
        for (let r = 0; r < rc; r += step) {
            const f = fitView[r];
            if (!Number.isFinite(f)) continue;
            let b = Math.floor(Math.max(0, Math.min(0.9999, f)) * bins);
            counts[b]++;
            total++;
            sum += f;
        }
    }
    if (total > 0) {
        for (let b = 0; b < bins; b++) counts[b] /= total;
    }
    return { bins, counts, total, mean: total > 0 ? sum / total : 0 };
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

export function drawTraitsChart(canvas, phylumRows, traitCounts, totalRows) {
    if (!canvas) return;
    const [w, h] = syncCanvasSize(canvas);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#090e18';
    ctx.fillRect(0, 0, w, h);

    const padT = 20, padB = 18;
    const midX = Math.floor(w * 0.52);
    const ph = Math.max(12, h - padT - padB);

    // Left section: Phylum Mean Fitness (from leftJoin clades)
    const pPadL = 12, pPadR = 14;
    const pW = Math.max(24, midX - pPadL - pPadR);
    ctx.font = '9.5px ui-monospace, monospace';

    const phyMap = new Map();
    for (const r of (phylumRows || [])) {
        const name = r['right.phylum'] || r.phylum || '';
        if (name) phyMap.set(name, r);
    }

    const barGap = 2;
    const slotW = pW / PHYLA.length;
    const barW = Math.max(8, slotW * 0.62);

    ctx.strokeStyle = 'rgba(110, 145, 200, 0.14)';
    ctx.beginPath();
    ctx.moveTo(pPadL, padT + ph * 0.5);
    ctx.lineTo(pPadL + pW, padT + ph * 0.5);
    ctx.stroke();

    for (let i = 0; i < PHYLA.length; i++) {
        const phy = PHYLA[i];
        const rec = phyMap.get(phy.name);
        const avgFit = rec && Number.isFinite(rec.avgFitness) ? rec.avgFitness : 0.62;
        const avgDist = rec && Number.isFinite(rec.avgDist) ? rec.avgDist : 0.45;
        const cx = pPadL + (i + 0.5) * slotW;
        const bh = Math.max(2, Math.min(1.0, avgFit) * ph);
        const by = padT + ph - bh;

        ctx.fillStyle = phy.color;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(cx - barW * 0.5, by, barW, bh);
        ctx.globalAlpha = 1.0;

        // Distance marker dot (lower distance = tighter adaptation)
        const distNorm = Math.min(1.0, avgDist / 1.5);
        const dy = padT + ph - distNorm * ph;
        ctx.fillStyle = '#fff0a8';
        ctx.beginPath();
        ctx.arc(cx, dy, 2.3, 0, TAU);
        ctx.fill();

        ctx.fillStyle = '#9db3d8';
        ctx.textAlign = 'center';
        ctx.fillText(phy.name.slice(0, 5), cx, h - 5);
    }

    // Divider
    ctx.strokeStyle = 'rgba(120, 160, 220, 0.22)';
    ctx.beginPath();
    ctx.moveTo(midX, padT - 4);
    ctx.lineTo(midX, h - 6);
    ctx.stroke();

    // Right section: Bitwise Trait Prevalence (bitAnd traits_mask)
    const tPadL = midX + 54;
    const tPadR = 38;
    const tW = Math.max(20, w - tPadL - tPadR);
    const rowH = ph / TRAIT_FLAGS.length;
    const denom = Math.max(1, totalRows || 131072);

    for (let i = 0; i < TRAIT_FLAGS.length; i++) {
        const tf = TRAIT_FLAGS[i];
        const cnt = traitCounts ? (traitCounts[tf.bit] || 0) : 0;
        const frac = Math.max(0, Math.min(1, cnt / denom));
        const ry = padT + i * rowH + 2;
        const bh = Math.max(4, rowH - 5);

        ctx.fillStyle = '#141d2e';
        ctx.fillRect(tPadL, ry, tW, bh);
        ctx.fillStyle = tf.color;
        ctx.fillRect(tPadL, ry, Math.max(2, tW * frac), bh);

        ctx.fillStyle = '#a7bce0';
        ctx.textAlign = 'right';
        ctx.fillText(tf.short, tPadL - 5, ry + bh - 1);

        ctx.fillStyle = '#d6e6ff';
        ctx.textAlign = 'left';
        ctx.fillText(`${Math.round(frac * 100)}%`, tPadL + tW + 4, ry + bh - 1);
    }
}

export function drawPhenotypeChart(canvas, liveHist, branchHist, auditInfo) {
    if (!canvas || !liveHist) return;
    const [w, h] = syncCanvasSize(canvas);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#090e18';
    ctx.fillRect(0, 0, w, h);

    const padL = 32, padR = 12, padT = 20, padB = 18;
    const pw = Math.max(12, w - padL - padR);
    const ph = Math.max(12, h - padT - padB);

    const N = liveHist.bins;
    let maxVal = 0.14;
    for (let b = 0; b < N; b++) {
        if (liveHist.counts[b] > maxVal) maxVal = liveHist.counts[b];
        if (branchHist && branchHist.counts[b] > maxVal) maxVal = branchHist.counts[b];
    }
    maxVal *= 1.12;

    ctx.font = '9.5px ui-monospace, monospace';
    ctx.lineWidth = 1;
    for (const frac of [0.05, 0.10, 0.15]) {
        if (frac > maxVal) continue;
        const gy = padT + (1.0 - frac / maxVal) * ph;
        ctx.strokeStyle = 'rgba(110, 145, 200, 0.14)';
        ctx.beginPath();
        ctx.moveTo(padL, gy);
        ctx.lineTo(padL + pw, gy);
        ctx.stroke();
        ctx.fillStyle = '#7f93b5';
        ctx.textAlign = 'right';
        ctx.fillText(`${Math.round(frac * 100)}%`, padL - 4, gy + 3);
    }

    // Endangered threshold zone (< 0.25 fitness)
    const dangerX = padL + 0.25 * pw;
    ctx.fillStyle = 'rgba(255, 92, 92, 0.08)';
    ctx.fillRect(padL, padT, dangerX - padL, ph);

    const slotW = pw / N;
    const barW = Math.max(4, slotW * 0.72);
    for (let b = 0; b < N; b++) {
        const v = liveHist.counts[b];
        const bh = (v / maxVal) * ph;
        const cx = padL + (b + 0.5) * slotW;
        const fMid = (b + 0.5) / N;
        ctx.fillStyle = fMid < 0.25 ? '#ff6961' : (fMid > 0.72 ? '#4be8a8' : '#53b4ff');
        ctx.globalAlpha = 0.82;
        ctx.fillRect(cx - barW * 0.5, padT + ph - bh, barW, bh);
    }
    ctx.globalAlpha = 1.0;

    // Endangered dashed threshold line
    ctx.strokeStyle = 'rgba(255, 118, 108, 0.65)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(dangerX, padT);
    ctx.lineTo(dangerX, padT + ph);
    ctx.stroke();
    ctx.setLineDash([]);

    // Overlay audited / saved .brotable v3 baseline curve
    if (branchHist) {
        ctx.strokeStyle = '#ffd86b';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        for (let b = 0; b < N; b++) {
            const cx = padL + (b + 0.5) * slotW;
            const cy = padT + ph - (branchHist.counts[b] / maxVal) * ph;
            if (b === 0) ctx.moveTo(cx, cy);
            else ctx.lineTo(cx, cy);
        }
        ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(130, 165, 220, 0.28)';
    ctx.lineWidth = 1;
    ctx.strokeRect(padL, padT, pw, ph);

    ctx.fillStyle = '#7f93b5';
    ctx.textAlign = 'center';
    for (const t of [0.0, 0.25, 0.50, 0.75, 1.0]) {
        ctx.fillText(t.toFixed(2), padL + t * pw, h - 4);
    }

    ctx.textAlign = 'right';
    ctx.fillStyle = '#62c4ff';
    ctx.fillText(`Live μ=${liveHist.mean.toFixed(3)}`, padL + pw - 4, 13);
    if (auditInfo && auditInfo.ok) {
        const dSign = auditInfo.deltaAvg >= 0 ? '+' : '';
        ctx.fillStyle = '#ffd86b';
        ctx.fillText(
            `Branch Δ=${dSign}${auditInfo.deltaAvg.toFixed(4)} (${auditInfo.mappedIndexes} idx mmap)`,
            padL + pw - 96,
            13
        );
    }
}

function drawTag(ctx, text, x, y, fg = '#dce8ff') {
    const padX = 5;
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(7, 11, 20, 0.78)';
    ctx.fillRect(x - 2, y - 10, tw + padX * 2, 14);
    ctx.fillStyle = fg;
    ctx.fillText(text, x + padX - 2, y + 1);
}

export function drawOverlay(canvas, view, state) {
    const [w, h] = syncCanvasSize(canvas);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);

    const m = view.toManifold | 0;
    const t = view.smoothMorph;
    ctx.font = '10.5px ui-monospace, monospace';
    ctx.textAlign = 'left';

    if (m === 0 && t > 0.6) {
        for (let i = 0; i < NICHES.length; i++) {
            const ni = NICHES[i];
            const p = view.project(ni.center[0], ni.center[1] + 0.16, ni.center[2], w, h);
            if (p && p.depth < view.dist + 0.85) {
                drawTag(ctx, ni.name, p.x, p.y, '#9fd0ff');
            }
        }
    } else if (m === 1 && t > 0.6) {
        for (const [txt, x, y, z] of [
            ['Adaptive Peak (+fit)', 0.0, 1.12, 0.0],
            ['Gene A Axis', 1.35, -0.5, 0.0],
            ['Gene B Axis', 0.0, -0.5, 1.35],
        ]) {
            const p = view.project(x, y, z, w, h);
            if (p) drawTag(ctx, txt, p.x, p.y, '#cbe0ff');
        }
    } else if (m === 2 && t > 0.6) {
        for (const [txt, x, y, z] of [
            ['Fitness Summit (1.0)', 0.0, 1.30, 0.0],
            ['Genetic Drift Base', 1.15, -0.78, 0.0],
        ]) {
            const p = view.project(x, y, z, w, h);
            if (p) drawTag(ctx, txt, p.x, p.y, '#cbe0ff');
        }
    } else if (m === 3 && t > 0.6) {
        for (const [txt, x, y, z] of [
            ['Primordial Founders (Gen 0, parent=NULL)', 0.72, -0.88, 0.0],
            ['Latest Speciation Crown', 0.72, 0.92, 0.0],
        ]) {
            const p = view.project(x, y, z, w, h);
            if (p) drawTag(ctx, txt, p.x, p.y, '#cbe0ff');
        }
    }

    // Recent brush strike flash ring (Mutagen cyan / Asteroid crimson)
    if (state.brushFlash && state.brushFlash.ttl > 0 && t > 0.5) {
        const bf = state.brushFlash;
        const p3 = evalCreatureManifold(m, bf.anchorRow);
        const sp = view.project(p3[0], p3[1], p3[2], w, h);
        if (sp) {
            ctx.strokeStyle = bf.kind === 'asteroid'
                ? `rgba(255, 86, 72, ${Math.min(1, bf.ttl).toFixed(2)})`
                : `rgba(70, 232, 255, ${Math.min(1, bf.ttl).toFixed(2)})`;
            ctx.lineWidth = 2.0;
            ctx.beginPath();
            ctx.arc(sp.x, sp.y, 18 + (1.0 - bf.ttl) * 24, 0, TAU);
            ctx.stroke();
        }
    }

    // Spatial Probe hits overlay
    if (state.probeHits && state.probeHits.length > 0 && t > 0.65) {
        const centerPt = state.probePt;
        const cp = m === 0
            ? view.project(centerPt[0], centerPt[1], centerPt[2], w, h)
            : view.project(...evalCreatureManifold(m, state.probeHits[0]), w, h);
        if (cp) {
            ctx.strokeStyle = '#66f2b8';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(cp.x, cp.y, 14, 0, TAU);
            ctx.stroke();
        }
        for (let i = 0; i < state.probeHits.length; i++) {
            const r = state.probeHits[i];
            const p3 = evalCreatureManifold(m, r);
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
            ctx.fillStyle = r.fitness >= 0.7 ? '#66f2b8' : '#ffb84d';
            ctx.beginPath();
            ctx.arc(sp.x, sp.y, i === 0 ? 4.2 : 2.6, 0, TAU);
            ctx.fill();
            if (i === 0) {
                drawTag(ctx, `#${r.id} ${r.taxon_name} fit=${r.fitness.toFixed(2)}`, sp.x + 10, sp.y + 12, '#eafff5');
            }
        }
    }
}
