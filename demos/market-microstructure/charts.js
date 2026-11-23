// HiDPI 2D telemetry charts, Top-K sidebar tables, and 3D viewport overlay
// for Market Microstructure Observatory.

import { h } from "/lib/kit/index.js";
import {
    SECTORS,
    SECTOR_HEX,
    DESK_TYPES,
    STRATEGIES,
    INSTRUMENT_DEFS,
    canyonCenterX,
} from "./data.js";

function fmtUsd(val) {
    if (!Number.isFinite(val)) return '$0';
    const abs = Math.abs(val);
    const sign = val < 0 ? '-' : '';
    if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}k`;
    return `${sign}$${Math.round(abs)}`;
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

export function renderTopWhalesTable(wrap, rows) {
    wrap.innerHTML = '';
    const tbl = h('table.living-table-grid');
    tbl.appendChild(h('thead', null, h('tr', null,
        h('th', null, 'ord'),
        h('th', null, 'sym'),
        h('th', null, 'side'),
        h('th', null, 'notl'),
        h('th', null, 'venue')
    )));
    const tbody = h('tbody');
    for (const r of (rows || []).slice(0, 5)) {
        const inst = INSTRUMENT_DEFS[r.sym_id | 0] || INSTRUMENT_DEFS[0];
        const isBid = (r.side | 0) === 0;
        const vLabel = r.venue_id == null ? 'OTC' : `#${r.venue_id}`;
        tbody.appendChild(h('tr', null,
            h('td', null, String(r.order_id)),
            h('td', null, inst.symbol),
            h('td', { class: isBid ? 'mm-bid' : 'mm-ask' }, isBid ? 'BID' : 'ASK'),
            h('td', { class: 'mm-gold' }, fmtUsd(r.notional)),
            h('td', null, vLabel)
        ));
    }
    tbl.appendChild(tbody);
    wrap.appendChild(tbl);
}

export function renderTopAgentsTable(wrap, rows) {
    wrap.innerHTML = '';
    const tbl = h('table.living-table-grid');
    tbl.appendChild(h('thead', null, h('tr', null,
        h('th', null, 'ag'),
        h('th', null, 'desk'),
        h('th', null, 'lev'),
        h('th', null, 'mgn'),
        h('th', null, 'pnl')
    )));
    const tbody = h('tbody');
    for (const r of (rows || []).slice(0, 5)) {
        const mgnCls = r.margin_ratio > 0.78 ? 'mm-crit' : (r.margin_ratio > 0.60 ? 'mm-warn' : '');
        const deskShort = String(r.desk_type || '').replace('_AGG', '').replace('_LO', '');
        tbody.appendChild(h('tr', null,
            h('td', null, String(r.agent_id)),
            h('td', null, deskShort),
            h('td', { class: r.leverage >= 4.0 ? 'mm-warn' : '' }, `${r.leverage.toFixed(1)}x`),
            h('td', { class: mgnCls }, `${Math.round(r.margin_ratio * 100)}%`),
            h('td', { class: r.pnl < 0 ? 'mm-crit' : 'mm-bid' }, fmtUsd(r.pnl))
        ));
    }
    tbl.appendChild(tbody);
    wrap.appendChild(tbl);
}

export function drawSectorDepthChart(canvas, sectorRows) {
    const { w, h, ctx } = fitCanvas(canvas);
    ctx.clearRect(0, 0, w, h);

    const bySector = new Map();
    for (const r of (sectorRows || [])) {
        const key = r['right.sector'] ?? r.sector;
        if (key != null) bySector.set(key, r);
    }

    const padL = 14, padR = 14, padT = 26, padB = 18;
    const plotW = Math.max(20, w - padL - padR);
    const plotH = Math.max(16, h - padT - padB);
    const slotW = plotW / SECTORS.length;
    const barW = Math.max(16, Math.min(48, slotW * 0.52));

    let maxNot = 1;
    let maxImb = 1;
    for (const s of SECTORS) {
        const rec = bySector.get(s);
        if (rec) {
            if (rec.totalNotional > maxNot) maxNot = rec.totalNotional;
            const imb = Math.abs(rec.netNotionalImbalance || 0);
            if (imb > maxImb) maxImb = imb;
        }
    }

    ctx.font = '10px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center';

    for (let i = 0; i < SECTORS.length; i++) {
        const sec = SECTORS[i];
        const rec = bySector.get(sec) || { totalNotional: 0, netNotionalImbalance: 0, toxicOrMarginCnt: 0 };
        const cx = padL + slotW * (i + 0.5);
        const totH = Math.max(3, (rec.totalNotional / maxNot) * (plotH - 14));
        const topY = padT + (plotH - 14) - totH;

        ctx.fillStyle = 'rgba(120, 148, 194, 0.16)';
        ctx.fillRect(cx - barW * 0.5, padT, barW, plotH - 14);

        ctx.fillStyle = SECTOR_HEX[i];
        ctx.globalAlpha = 0.78;
        ctx.fillRect(cx - barW * 0.5, topY, barW, totH);
        ctx.globalAlpha = 1.0;

        // Bid/Ask Imbalance micro-bar directly under sector column
        const imbNorm = Math.max(-1, Math.min(1, (rec.netNotionalImbalance || 0) / maxImb));
        const imbY = padT + plotH - 10;
        const halfBar = barW * 0.5;
        ctx.fillStyle = 'rgba(130, 154, 196, 0.22)';
        ctx.fillRect(cx - halfBar, imbY, barW, 5);
        ctx.fillStyle = imbNorm >= 0 ? '#36e8d4' : '#ff6c42';
        if (imbNorm >= 0) {
            ctx.fillRect(cx, imbY, imbNorm * halfBar, 5);
        } else {
            const bw = (-imbNorm) * halfBar;
            ctx.fillRect(cx - bw, imbY, bw, 5);
        }

        ctx.fillStyle = '#dce8ff';
        ctx.fillText(sec.replace('_ETF', ''), cx, h - 5);

        ctx.fillStyle = '#a8bee2';
        ctx.fillText(fmtUsd(rec.totalNotional), cx, Math.max(18, topY - 4));
    }
}

export function drawDeskStressChart(canvas, deskRows, feeRows) {
    const { w, h, ctx } = fitCanvas(canvas);
    ctx.clearRect(0, 0, w, h);

    const byDesk = new Map();
    for (const r of (deskRows || [])) {
        const key = r['right.desk_type'] ?? r.desk_type;
        if (key != null) byDesk.set(key, r);
    }

    const splitX = Math.round(w * 0.56);
    const padL = 10, padT = 24, padB = 8;
    const leftW = Math.max(40, splitX - padL - 10);
    const rowH = Math.max(14, (h - padT - padB) / DESK_TYPES.length);
    const barX = padL + 72;
    const barMaxW = Math.max(24, leftW - 114);
    const maxLev = 6.5;

    ctx.font = '10px ui-monospace, Consolas, monospace';
    for (let i = 0; i < DESK_TYPES.length; i++) {
        const dName = DESK_TYPES[i];
        const rec = byDesk.get(dName);
        const lev = rec ? Math.max(0, Math.min(maxLev, rec.avgLeverage || 0)) : 0;
        const mgn = rec ? (rec.avgMarginRatio || 0) : 0;
        const y0 = padT + i * rowH;

        ctx.textAlign = 'left';
        ctx.fillStyle = '#b9cae8';
        ctx.fillText(dName.replace('_AGG', ''), padL, y0 + 11);

        const barY = y0 + 3;
        const barH = Math.max(6, rowH - 7);
        ctx.fillStyle = 'rgba(120, 145, 190, 0.14)';
        ctx.fillRect(barX, barY, barMaxW, barH);

        ctx.fillStyle = mgn > 0.72 ? '#ff5b6b' : (mgn > 0.55 ? '#ffbe3b' : '#36e896');
        ctx.fillRect(barX, barY, (lev / maxLev) * barMaxW, barH);

        ctx.textAlign = 'right';
        ctx.fillStyle = '#dce8ff';
        ctx.fillText(`${lev.toFixed(1)}x`, padL + leftW, y0 + 11);
    }

    // 4.0x Margin Squeeze line
    const sqX = barX + (4.0 / maxLev) * barMaxW;
    ctx.strokeStyle = 'rgba(255, 190, 59, 0.65)';
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.moveTo(sqX, padT);
    ctx.lineTo(sqX, h - 8);
    ctx.stroke();
    ctx.setLineDash([]);

    // Divider
    ctx.strokeStyle = 'rgba(110, 145, 200, 0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(splitX, 18);
    ctx.lineTo(splitX, h - 8);
    ctx.stroke();

    // Right: Dark-Pool vs Lit Fee Attribution by Strategy (leftJoin venues + coalesce)
    const byStrat = new Map();
    for (const r of (feeRows || [])) {
        if (r.strategy != null) byStrat.set(r.strategy, r);
    }

    const rPadL = splitX + 10;
    const rW = Math.max(30, w - rPadL - 10);
    const rPlotH = Math.max(12, h - 28 - 20);
    const slotW = rW / STRATEGIES.length;
    const bw = Math.max(12, Math.min(30, slotW * 0.56));
    let maxOrd = 1;
    for (const st of STRATEGIES) {
        const rec = byStrat.get(st);
        if (rec && rec.orderCnt > maxOrd) maxOrd = rec.orderCnt;
    }

    ctx.textAlign = 'center';
    for (let i = 0; i < STRATEGIES.length; i++) {
        const st = STRATEGIES[i];
        const rec = byStrat.get(st) || { orderCnt: 0, litCnt: 0, darkCnt: 0, totalFeeUsd: 0 };
        const cx = rPadL + slotW * (i + 0.5);
        const totH = Math.max(2, (rec.orderCnt / maxOrd) * rPlotH);
        const litH = rec.orderCnt > 0 ? (rec.litCnt / rec.orderCnt) * totH : 0;
        const darkH = Math.max(0, totH - litH);
        const baseY = 28 + rPlotH;

        ctx.fillStyle = '#38d8ff';
        ctx.fillRect(cx - bw * 0.5, baseY - litH, bw, litH);
        ctx.fillStyle = '#9b6bff';
        ctx.fillRect(cx - bw * 0.5, baseY - totH, bw, darkH);

        ctx.fillStyle = '#a8bee2';
        ctx.fillText(st.slice(0, 4), cx, h - 5);
        ctx.fillStyle = '#dce8ff';
        ctx.fillText(fmtUsd(rec.totalFeeUsd), cx, Math.max(18, baseY - totH - 4));
    }
}

export function drawMarketOverlay(canvas, view, state) {
    const { w, h, ctx } = fitCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    ctx.font = '10px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center';

    if (view.toManifold === 0 && view.smoothMorph > 0.72) {
        ctx.fillStyle = 'rgba(178, 214, 255, 0.72)';
        for (let s = 0; s < INSTRUMENT_DEFS.length; s += 2) {
            const p = view.project(canyonCenterX(s), -0.52, 0.0, w, h);
            if (p) ctx.fillText(INSTRUMENT_DEFS[s].symbol, p.x, p.y);
        }
        const bidP = view.project(-1.26, -0.42, -0.58, w, h);
        const askP = view.project(-1.26, -0.42,  0.58, w, h);
        ctx.fillStyle = 'rgba(54, 232, 212, 0.72)';
        if (bidP) ctx.fillText('BID BOOK', bidP.x, bidP.y);
        ctx.fillStyle = 'rgba(255, 148, 66, 0.75)';
        if (askP) ctx.fillText('ASK BOOK', askP.x, askP.y);
    } else if (view.toManifold === 2 && view.smoothMorph > 0.72) {
        ctx.fillStyle = 'rgba(182, 214, 255, 0.72)';
        const pLo = view.project(-1.05, -0.95, 0.0, w, h);
        const pSq = view.project(0.18, -0.95, 0.0, w, h);
        const pHi = view.project(1.05, -0.95, 0.0, w, h);
        if (pLo) ctx.fillText('1.0x LEV', pLo.x, pLo.y);
        if (pSq) ctx.fillText('4.0x SQUEEZE', pSq.x, pSq.y);
        if (pHi) ctx.fillText('6.2x MAX', pHi.x, pHi.y);
    } else if (view.toManifold === 3 && view.smoothMorph > 0.72) {
        ctx.fillStyle = 'rgba(182, 214, 255, 0.76)';
        for (let i = 0; i < SECTORS.length; i++) {
            const p = view.project((i - 2.0) * 0.48, -0.56, 0.0, w, h);
            if (p) ctx.fillText(SECTORS[i], p.x, p.y);
        }
    }

    if (state.lastBrushPt && view.toManifold === 0) {
        const bp = state.lastBrushPt;
        const p = view.project(bp[0], bp[1], bp[2], w, h);
        if (p) {
            const colorMap = {
                probe: 'rgba(56, 216, 255, 0.88)',
                crash: 'rgba(255, 72, 118, 0.92)',
                sweep: 'rgba(255, 190, 59, 0.92)',
            };
            ctx.strokeStyle = colorMap[state.lastBrushKind] || 'rgba(140, 200, 255, 0.85)';
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.arc(p.x, p.y, state.lastBrushKind === 'probe' ? 9 : 16, 0, Math.PI * 2);
            ctx.stroke();
        }
    }
}
