// HiDPI 2D telemetry charts and 3D viewport overlay for Urban Mobility Twin.

import { h } from "/lib/kit/index.js";
import { MODES, MODE_HEX, DISTRICTS, DISTRICT_CENTERS } from "./data.js";

export function renderTopDelayedTable(wrap, rows) {
    wrap.innerHTML = '';
    const tblEl = h('table.living-table-grid');
    tblEl.appendChild(h('thead', null, h('tr', null,
        h('th', null, 'vid'),
        h('th', null, 'mode'),
        h('th', null, 'spd'),
        h('th', null, 'delay'),
        h('th', null, 'batt')
    )));
    const tbody = h('tbody');
    for (const r of (rows || []).slice(0, 6)) {
        const dlyCls = r.delay_min >= 22 ? 'mob-badge-crit' : 'mob-badge-warn';
        tbody.appendChild(h('tr', null,
            h('td', null, String(r.vid)),
            h('td', null, String(r.mode)),
            h('td', null, `${Math.round(r.speed)}`),
            h('td', { class: dlyCls }, `${r.delay_min.toFixed(1)}m`),
            h('td', null, `${Math.round(r.battery * 100)}%`)
        ));
    }
    tblEl.appendChild(tbody);
    wrap.appendChild(tblEl);
}

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
    return { w: cssW, h: cssH, ctx };
}

function fmtRev(usd) {
    if (!Number.isFinite(usd)) return '$0';
    if (usd >= 1e6) return '$' + (usd / 1e6).toFixed(2) + 'M';
    if (usd >= 1e3) return '$' + (usd / 1e3).toFixed(0) + 'k';
    return '$' + Math.round(usd);
}

export function drawModesChart(canvas, revenueRows) {
    const { w, h, ctx } = fitCanvas(canvas);
    ctx.clearRect(0, 0, w, h);

    const byMode = new Map();
    for (const r of (revenueRows || [])) {
        byMode.set(r.mode, r);
    }

    const padL = 16, padR = 16, padT = 30, padB = 22;
    const plotW = Math.max(20, w - padL - padR);
    const plotH = Math.max(12, h - padT - padB);
    const slotW = plotW / MODES.length;
    const barW = Math.max(18, Math.min(54, slotW * 0.54));

    let maxFleet = 1;
    for (const m of MODES) {
        const rec = byMode.get(m);
        if (rec && rec.fleetCnt > maxFleet) maxFleet = rec.fleetCnt;
    }

    ctx.font = '10px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center';

    for (let i = 0; i < MODES.length; i++) {
        const m = MODES[i];
        const rec = byMode.get(m) || { fleetCnt: 0, paidCnt: 0, activeRevenue: 0 };
        const cx = padL + slotW * (i + 0.5);
        const fleet = rec.fleetCnt || 0;
        const paid = rec.paidCnt || 0;
        const paidPct = fleet > 0 ? Math.round((paid / fleet) * 100) : 0;

        const fullH = (fleet / maxFleet) * plotH;
        const paidH = (paid / maxFleet) * plotH;

        ctx.fillStyle = 'rgba(130, 154, 196, 0.16)';
        ctx.fillRect(cx - barW * 0.5, padT + plotH - fullH, barW, fullH);

        ctx.fillStyle = MODE_HEX[i];
        ctx.fillRect(cx - barW * 0.5, padT + plotH - paidH, barW, paidH);

        ctx.fillStyle = '#dce8ff';
        ctx.fillText(m, cx, h - 6);

        ctx.fillStyle = '#9db4d8';
        const revLabel = `${fmtRev(rec.activeRevenue)} · ${paidPct}%`;
        ctx.fillText(revLabel, cx, Math.max(18, padT + plotH - fullH - 5));
    }
}

export function drawDistrictsChart(canvas, districtRows, delayBins) {
    const { w, h, ctx } = fitCanvas(canvas);
    ctx.clearRect(0, 0, w, h);

    const byDist = new Map();
    for (const r of (districtRows || [])) {
        const key = r['right.district'] ?? r.district;
        if (key != null) byDist.set(key, r);
    }

    const splitX = Math.round(w * 0.54);
    const padL = 12, padT = 26, padB = 10;
    const leftW = Math.max(40, splitX - padL - 12);
    const rowH = Math.max(14, (h - padT - padB) / DISTRICTS.length);

    ctx.font = '10px ui-monospace, Consolas, monospace';
    for (let i = 0; i < DISTRICTS.length; i++) {
        const dName = DISTRICTS[i];
        const rec = byDist.get(dName);
        const ratio = rec ? Math.max(0, Math.min(1.2, rec.avgRatio || 0)) : 0;
        const y0 = padT + i * rowH;

        ctx.textAlign = 'left';
        ctx.fillStyle = '#b9cae8';
        ctx.fillText(dName, padL, y0 + 11);

        const barX = padL + 64;
        const barMaxW = Math.max(24, leftW - 108);
        const barY = y0 + 3;
        const barH = Math.max(7, rowH - 8);

        ctx.fillStyle = 'rgba(120, 145, 190, 0.14)';
        ctx.fillRect(barX, barY, barMaxW, barH);

        const fillCol = ratio >= 0.72 ? '#36e896' : (ratio >= 0.48 ? '#ffbe3b' : '#ff5b57');
        ctx.fillStyle = fillCol;
        ctx.fillRect(barX, barY, Math.min(1.0, ratio) * barMaxW, barH);

        ctx.textAlign = 'right';
        ctx.fillStyle = '#dce8ff';
        ctx.fillText(`${Math.round(ratio * 100)}%`, padL + leftW, y0 + 11);
    }

    // Divider
    ctx.strokeStyle = 'rgba(110, 145, 200, 0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(splitX, 18);
    ctx.lineTo(splitX, h - 8);
    ctx.stroke();

    // Right: SLA Delay Histogram
    const bins = delayBins || [0, 0, 0, 0];
    const binLabels = ['0-5m', '5-12m', '12-22m', '22m+'];
    const binColors = ['#36e896', '#69c9ff', '#ffbe3b', '#ff5b57'];
    let maxB = 1;
    for (let i = 0; i < 4; i++) {
        if (bins[i] > maxB) maxB = bins[i];
    }

    const rPadL = splitX + 12;
    const rW = Math.max(30, w - rPadL - 12);
    const rPlotH = Math.max(12, h - 30 - 20);
    const slotW = rW / 4;
    const bw = Math.max(12, Math.min(34, slotW * 0.58));

    ctx.textAlign = 'center';
    for (let i = 0; i < 4; i++) {
        const cx = rPadL + slotW * (i + 0.5);
        const val = bins[i] || 0;
        const bh = (val / maxB) * rPlotH;
        ctx.fillStyle = binColors[i];
        ctx.fillRect(cx - bw * 0.5, 28 + rPlotH - bh, bw, bh);

        ctx.fillStyle = '#a8bee2';
        ctx.fillText(binLabels[i], cx, h - 6);
        ctx.fillStyle = '#dce8ff';
        const lbl = val >= 1000 ? (val / 1000).toFixed(1) + 'k' : String(val);
        ctx.fillText(lbl, cx, Math.max(18, 28 + rPlotH - bh - 4));
    }
}

export function drawCityOverlay(canvas, view, hubRows, state) {
    const { w, h, ctx } = fitCanvas(canvas);
    ctx.clearRect(0, 0, w, h);

    ctx.font = '10px ui-monospace, Consolas, monospace';
    if ((view.toManifold === 0 || view.toManifold === 1) && view.smoothMorph > 0.72) {
        ctx.fillStyle = 'rgba(176, 210, 255, 0.65)';
        ctx.textAlign = 'center';
        for (const d of DISTRICT_CENTERS) {
            const p = view.project(d.pos[0], d.pos[1] + (view.toManifold === 1 ? 0.28 : 0.06), d.pos[2], w, h);
            if (p) ctx.fillText(d.name, p.x, p.y);
        }

        // Subtle cyan rings around a few key hubs
        ctx.strokeStyle = 'rgba(56, 224, 255, 0.34)';
        ctx.lineWidth = 1;
        for (let i = 0; i < hubRows.length; i += 3) {
            const hb = hubRows[i];
            const p = view.project(hb.x, hb.y, hb.z, w, h);
            if (p) {
                ctx.beginPath();
                ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
                ctx.stroke();
            }
        }
    }

    if (state.lastBrushPt && (view.toManifold === 0 || view.toManifold === 1)) {
        const bp = state.lastBrushPt;
        const p = view.project(bp[0], bp[1], bp[2], w, h);
        if (p) {
            const colorMap = {
                probe: 'rgba(92, 198, 255, 0.88)',
                incident: 'rgba(255, 86, 82, 0.92)',
                corridor: 'rgba(54, 232, 150, 0.92)',
                cull: 'rgba(255, 190, 59, 0.92)',
            };
            ctx.strokeStyle = colorMap[state.lastBrushKind] || 'rgba(140, 200, 255, 0.85)';
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.arc(p.x, p.y, state.lastBrushKind === 'probe' ? 9 : 16, 0, Math.PI * 2);
            ctx.stroke();
        }
    }
}
