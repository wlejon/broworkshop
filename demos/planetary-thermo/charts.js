// 2D warming/latitudinal telemetry charts & 3D planetary manifold overlay renderer.

import { CONTINENT_COASTLINES, latLonToEarth } from "/app/data.js";

const TAU = Math.PI * 2.0;

export function evalObsManifold(m, obs) {
    if (m === 0) {
        const a = Math.max(-12.0, Math.min(12.0, obs.anom_c));
        const r = 1.0 + a * 0.015;
        return [obs.ex * r, obs.ey * r, obs.ez * r];
    }
    if (m === 1) {
        const angle = (obs.doy / 365.25) * TAU;
        const contYear = ((obs.year - 1900.0) + obs.doy / 365.25) / 125.0;
        const yHelix = (contYear - 0.5) * 2.2;
        const a = Math.max(-12.0, Math.min(12.0, obs.anom_c));
        const radius = Math.max(0.18, 0.72 + a * 0.035);
        return [Math.cos(angle) * radius, yHelix, Math.sin(angle) * radius];
    }
    if (m === 2) {
        return [
            (obs.tmin_c - 5.0) * 0.035,
            (obs.tmax_c - 15.0) * 0.035,
            obs.lat / 55.0,
        ];
    }
    const a = Math.max(-12.0, Math.min(12.0, obs.anom_c));
    const contYear = ((obs.year - 1900.0) + obs.doy / 365.25) / 125.0;
    return [
        (contYear - 0.5) * 2.4,
        a * 0.08,
        (obs.lat / 90.0) * 1.1,
    ];
}

export function buildLatProfile(snap, filterMaskBits, yearLo, yearHi, maxSamples = 220000) {
    const NBINS = 18; // -90..+90 in 10 deg bands
    const earlySum = new Float64Array(NBINS);
    const earlyCnt = new Int32Array(NBINS);
    const modernSum = new Float64Array(NBINS);
    const modernCnt = new Int32Array(NBINS);
    const activeSum = new Float64Array(NBINS);
    const activeCnt = new Int32Array(NBINS);

    const nRows = snap.rowCount;
    const step = Math.max(1, Math.floor(nRows / maxSamples));
    const nChunks = snap.chunkCount;

    let arcticSum = 0, arcticN = 0;
    let tropicsSum = 0, tropicsN = 0;
    let shSum = 0, shN = 0;
    let totSum = 0, totN = 0;

    for (let ci = 0; ci < nChunks; ci++) {
        const rc = snap.chunkRowCount(ci);
        const cOrd = snap.chunkColumnView(ci, 'ord');
        const cLat = snap.chunkColumnView(ci, 'lat');
        const cYr = snap.chunkColumnView(ci, 'year');
        const cAnom = snap.chunkColumnView(ci, 'anom_c');

        for (let r = 0; r < rc; r += step) {
            const idx = cOrd[r] >>> 0;
            const la = cLat[r];
            const yr = cYr[r];
            const an = cAnom[r];

            let b = Math.floor((la + 90.0) / 10.0);
            if (b < 0) b = 0;
            else if (b >= NBINS) b = NBINS - 1;

            if (yr <= 1960) {
                earlySum[b] += an;
                earlyCnt[b]++;
            }
            if (yr >= 1990) {
                modernSum[b] += an;
                modernCnt[b]++;
            }

            const inMask = !filterMaskBits || ((filterMaskBits[idx >>> 5] >>> (idx & 31)) & 1) !== 0;
            const inYear = yr >= yearLo && yr <= yearHi;
            if (inMask && inYear) {
                activeSum[b] += an;
                activeCnt[b]++;
                totSum += an;
                totN++;
                if (la > 60.0) { arcticSum += an; arcticN++; }
                else if (Math.abs(la) <= 23.5) { tropicsSum += an; tropicsN++; }
                else if (la < -23.5) { shSum += an; shN++; }
            }
        }
    }

    const earlyMean = new Float32Array(NBINS);
    const modernMean = new Float32Array(NBINS);
    const activeMean = new Float32Array(NBINS);
    for (let b = 0; b < NBINS; b++) {
        earlyMean[b] = earlyCnt[b] > 0 ? earlySum[b] / earlyCnt[b] : NaN;
        modernMean[b] = modernCnt[b] > 0 ? modernSum[b] / modernCnt[b] : NaN;
        activeMean[b] = activeCnt[b] > 0 ? activeSum[b] / activeCnt[b] : NaN;
    }

    return {
        NBINS,
        earlyMean,
        modernMean,
        activeMean,
        earlyCnt,
        modernCnt,
        activeCnt,
        arcticMean: arcticN > 0 ? arcticSum / arcticN : NaN,
        tropicsMean: tropicsN > 0 ? tropicsSum / tropicsN : NaN,
        shMean: shN > 0 ? shSum / shN : NaN,
        activeMeanAll: totN > 0 ? totSum / totN : NaN,
    };
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

function anomBarColor(val, dim) {
    const a = dim ? 0.25 : 0.92;
    if (val < 0) return `rgba(62, 168, 255, ${a})`;
    if (val < 0.75) return `rgba(255, 182, 66, ${a})`;
    return `rgba(255, 82, 58, ${a})`;
}

export function drawWarmingChart(canvas, decadeGroups, filteredGroups, state) {
    if (!canvas) return;
    const [w, h] = syncCanvasSize(canvas);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#090e18';
    ctx.fillRect(0, 0, w, h);

    const padL = 34, padR = 12, padT = 18, padB = 18;
    const pw = Math.max(12, w - padL - padR);
    const ph = Math.max(12, h - padT - padB);

    const minY = -1.0, maxY = 2.4;
    const yToPx = (val) => {
        const clamped = Math.max(minY, Math.min(maxY, val));
        return padT + (1.0 - (clamped - minY) / (maxY - minY)) * ph;
    };

    // Gridlines
    ctx.font = '10px ui-monospace, monospace';
    ctx.lineWidth = 1;
    for (const gv of [-0.5, 0.0, 1.0, 2.0]) {
        const gy = yToPx(gv);
        ctx.strokeStyle = gv === 0 ? 'rgba(170, 200, 240, 0.42)' : 'rgba(110, 145, 200, 0.14)';
        ctx.beginPath();
        ctx.moveTo(padL, gy);
        ctx.lineTo(padL + pw, gy);
        ctx.stroke();
        ctx.fillStyle = '#7f93b5';
        ctx.textAlign = 'right';
        ctx.fillText((gv >= 0 ? '+' : '') + gv.toFixed(1), padL - 4, gy + 3);
    }

    const sorted = (decadeGroups || []).slice().sort((a, b) => a.decade - b.decade);
    if (sorted.length === 0) return;

    const filtMap = new Map();
    if (filteredGroups) {
        for (const g of filteredGroups) filtMap.set(g.decade, g.avgVal);
    }

    const zeroY = yToPx(0.0);
    const slotW = pw / sorted.length;
    const barW = Math.max(6, slotW * 0.58);

    // Highlight [yearLo, yearHi] window behind bars
    if (state.yearLo > 1900 || state.yearHi < 2025) {
        const x0 = padL + Math.max(0, (state.yearLo - 1900) / 130.0) * pw;
        const x1 = padL + Math.min(1, (state.yearHi - 1900 + 5) / 130.0) * pw;
        ctx.fillStyle = 'rgba(102, 242, 184, 0.09)';
        ctx.fillRect(x0, padT, Math.max(4, x1 - x0), ph);
        ctx.strokeStyle = 'rgba(102, 242, 184, 0.55)';
        ctx.strokeRect(x0, padT, Math.max(4, x1 - x0), ph);
    }

    const trendPts = [];
    for (let i = 0; i < sorted.length; i++) {
        const d = sorted[i];
        const cx = padL + (i + 0.5) * slotW;
        const val = Number.isFinite(d.avgVal) ? d.avgVal : 0;
        const inWin = d.decade + 9 >= state.yearLo && d.decade <= state.yearHi;
        const vy = yToPx(val);
        const top = Math.min(zeroY, vy);
        const bh = Math.max(1.5, Math.abs(vy - zeroY));

        ctx.fillStyle = anomBarColor(val, !inWin);
        ctx.fillRect(cx - barW * 0.5, top, barW, bh);

        if (filtMap.has(d.decade) && filteredGroups !== decadeGroups) {
            const fv = filtMap.get(d.decade);
            const fvy = yToPx(fv);
            ctx.fillStyle = '#66f2b8';
            ctx.beginPath();
            ctx.arc(cx, fvy, 2.6, 0, TAU);
            ctx.fill();
        }

        trendPts.push([cx, vy]);

        if (i === 0 || i === 3 || i === 6 || i === 9 || i === sorted.length - 1) {
            ctx.fillStyle = inWin ? '#cfe0ff' : '#657590';
            ctx.textAlign = 'center';
            ctx.fillText(String(d.decade), cx, h - 4);
        }
    }

    // Smooth warming trend polyline
    if (trendPts.length > 1) {
        ctx.strokeStyle = '#ffe299';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        for (let i = 0; i < trendPts.length; i++) {
            const [px, py] = trendPts[i];
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(130, 165, 220, 0.28)';
    ctx.lineWidth = 1;
    ctx.strokeRect(padL, padT, pw, ph);
}

export function drawLatChart(canvas, profile, state) {
    if (!canvas || !profile) return;
    const [w, h] = syncCanvasSize(canvas);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#090e18';
    ctx.fillRect(0, 0, w, h);

    const padL = 34, padR = 12, padT = 18, padB = 18;
    const pw = Math.max(12, w - padL - padR);
    const ph = Math.max(12, h - padT - padB);

    const minY = -1.2, maxY = 4.2;
    const yToPx = (val) => {
        const clamped = Math.max(minY, Math.min(maxY, val));
        return padT + (1.0 - (clamped - minY) / (maxY - minY)) * ph;
    };

    ctx.font = '10px ui-monospace, monospace';
    ctx.lineWidth = 1;
    for (const gv of [0.0, 1.5, 3.0]) {
        const gy = yToPx(gv);
        ctx.strokeStyle = gv === 0 ? 'rgba(170, 200, 240, 0.42)' : 'rgba(110, 145, 200, 0.14)';
        ctx.beginPath();
        ctx.moveTo(padL, gy);
        ctx.lineTo(padL + pw, gy);
        ctx.stroke();
        ctx.fillStyle = '#7f93b5';
        ctx.textAlign = 'right';
        ctx.fillText((gv >= 0 ? '+' : '') + gv.toFixed(1), padL - 4, gy + 3);
    }

    const NB = profile.NBINS;
    const plotCurve = (arr, color, fillAlpha) => {
        const pts = [];
        for (let b = 0; b < NB; b++) {
            const v = arr[b];
            if (!Number.isFinite(v)) continue;
            const px = padL + ((b + 0.5) / NB) * pw;
            const py = yToPx(v);
            pts.push([px, py]);
        }
        if (pts.length < 2) return;
        if (fillAlpha > 0) {
            const zy = yToPx(0);
            ctx.fillStyle = `rgba(255, 118, 68, ${fillAlpha})`;
            ctx.beginPath();
            ctx.moveTo(pts[0][0], zy);
            for (const [px, py] of pts) ctx.lineTo(px, py);
            ctx.lineTo(pts[pts.length - 1][0], zy);
            ctx.closePath();
            ctx.fill();
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
            if (i === 0) ctx.moveTo(pts[i][0], pts[i][1]);
            else ctx.lineTo(pts[i][0], pts[i][1]);
        }
        ctx.stroke();
    };

    plotCurve(profile.earlyMean, 'rgba(95, 175, 255, 0.80)', 0.0);
    plotCurve(profile.modernMean, '#ff9848', 0.14);
    const filteredActive = state.yearLo > 1900 || state.yearHi < 2025 || state.anomMin > -11.99 || state.anomMax < 11.99 || state.latMin > -89.99 || state.latMax < 89.99;
    if (filteredActive) {
        plotCurve(profile.activeMean, '#66f2b8', 0.12);
    }

    // Probe latitude marker
    if (state.probeHits && state.probeHits.length > 0) {
        const pLat = state.probeHits[0].lat;
        const px = padL + ((pLat + 90.0) / 180.0) * pw;
        ctx.strokeStyle = '#66f2b8';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(px, padT);
        ctx.lineTo(px, padT + ph);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    ctx.strokeStyle = 'rgba(130, 165, 220, 0.28)';
    ctx.lineWidth = 1;
    ctx.strokeRect(padL, padT, pw, ph);

    ctx.fillStyle = '#7f93b5';
    ctx.textAlign = 'center';
    for (const [lbl, lat] of [['-90°S', -90], ['-30°', -30], ['EQ', 0], ['+30°', 30], ['+60°', 60], ['+90°N', 84]]) {
        const x = padL + ((lat + 90.0) / 180.0) * pw;
        ctx.fillText(lbl, x, h - 4);
    }

    ctx.textAlign = 'right';
    ctx.fillStyle = '#5fafff';
    ctx.fillText('1900–60', padL + pw - 110, 13);
    ctx.fillStyle = '#ff9848';
    ctx.fillText('1990–25', padL + pw - 56, 13);
    if (filteredActive) {
        ctx.fillStyle = '#66f2b8';
        ctx.fillText('Active', padL + pw - 8, 13);
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

function drawGlobePolyline(ctx, view, w, h, latLonPts, closed = false) {
    const frontCut = view.dist + 0.06;
    ctx.beginPath();
    let drawing = false;
    const count = closed ? latLonPts.length + 1 : latLonPts.length;
    for (let i = 0; i < count; i++) {
        const pt = latLonPts[i % latLonPts.length];
        const e = latLonToEarth(pt[0], pt[1]);
        const p = view.project(e[0] * 1.004, e[1] * 1.004, e[2] * 1.004, w, h);
        if (!p || p.depth > frontCut) {
            drawing = false;
            continue;
        }
        if (!drawing) { ctx.moveTo(p.x, p.y); drawing = true; }
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
    ctx.textAlign = 'left';

    if (m === 0 && t > 0.45) {
        const alpha = Math.min(1, (t - 0.45) / 0.55);
        // Subtle lat parallels: Equator & Arctic Circle (+66.5N)
        const latRing = (latDeg) => {
            const pts = [];
            for (let i = 0; i <= 72; i++) pts.push([latDeg, -180 + i * 5]);
            return pts;
        };
        ctx.lineWidth = 1;
        ctx.strokeStyle = `rgba(110, 175, 255, ${(0.28 * alpha).toFixed(2)})`;
        drawGlobePolyline(ctx, view, w, h, latRing(0), true);
        ctx.strokeStyle = `rgba(255, 165, 90, ${(0.36 * alpha).toFixed(2)})`;
        drawGlobePolyline(ctx, view, w, h, latRing(66.5), true);

        // Simplified continental coastlines on front hemisphere
        ctx.strokeStyle = `rgba(165, 210, 255, ${(0.36 * alpha).toFixed(2)})`;
        for (const poly of CONTINENT_COASTLINES) {
            drawGlobePolyline(ctx, view, w, h, poly, false);
        }

        const north = view.project(0, 1.12, 0, w, h);
        if (north && north.depth < view.dist + 0.35 && alpha > 0.7) {
            drawTag(ctx, 'Arctic Amplification (+66.5°N)', north.x + 12, north.y - 6, '#ffc880');
        }
    } else if (m === 1 && t > 0.5) {
        for (const [txt, x, y, z] of [
            ['1900 (Century Base)', 0.92, -1.10, 0.0],
            ['1960 Mid-Century', 1.05, -0.02, -0.35],
            ['2025 (Present Peak)', 0.92, 1.08, 0.0],
        ]) {
            const p = view.project(x, y, z, w, h);
            if (p) drawTag(ctx, txt, p.x, p.y, '#cbe0ff');
        }
    } else if (m === 2 && t > 0.5) {
        for (const [txt, x, y, z] of [
            ['Tropical Regime', 0.95, 0.72, 0.0],
            ['Temperate Mid-Lat', -0.45, 0.35, 0.95],
            ['Polar Cryosphere', -1.25, -1.15, 1.35],
        ]) {
            const p = view.project(x, y, z, w, h);
            if (p) drawTag(ctx, txt, p.x, p.y, '#cbe0ff');
        }
    } else if (m === 3 && t > 0.5) {
        for (const [txt, x, y, z] of [
            ['1900', -1.25, -0.08, -0.95],
            ['2025', 1.18, 0.12, -0.15],
            ['Arctic Amplification (+90°N)', 0.45, 0.56, 1.08],
        ]) {
            const p = view.project(x, y, z, w, h);
            if (p) drawTag(ctx, txt, p.x, p.y, '#cbe0ff');
        }
    }

    // Spatial Probe hits overlay
    if (state.probeHits && state.probeHits.length > 0 && t > 0.65) {
        const hit0 = state.probeHits[0];
        const centerObs = Object.assign({}, hit0, {
            ex: state.probePt[0],
            ey: state.probePt[1],
            ez: state.probePt[2],
        });
        const c3 = m === 0
            ? [state.probePt[0], state.probePt[1], state.probePt[2]]
            : evalObsManifold(m, centerObs);
        const cp = view.project(c3[0], c3[1], c3[2], w, h);
        if (cp) {
            ctx.strokeStyle = '#66f2b8';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(cp.x, cp.y, 15, 0, TAU);
            ctx.stroke();
        }
        for (let i = 0; i < state.probeHits.length; i++) {
            const s = state.probeHits[i];
            const p3 = evalObsManifold(m, s);
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
            ctx.fillStyle = s.anom_c >= 0 ? '#ff7c4d' : '#4ec3ff';
            ctx.beginPath();
            ctx.arc(sp.x, sp.y, i === 0 ? 4.2 : 2.8, 0, TAU);
            ctx.fill();
            if (i === 0) {
                const sign = s.anom_c >= 0 ? '+' : '';
                drawTag(ctx, `#1 ${s.lat.toFixed(1)}°,${s.lon.toFixed(1)}° (${s.year}) ${sign}${s.anom_c.toFixed(1)}°C`, sp.x + 10, sp.y + 12, '#eafff5');
            }
        }
    }
}
