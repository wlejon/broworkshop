// Crisp HiDPI 2D charts for Parquet Earth Atlas (matched to CSS aspect ratio).

import { REGION_DEFS } from "./data.js";

function fitCanvas(canvas) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(16, Math.round(canvas.clientWidth || 320));
  const h = Math.max(16, Math.round(canvas.clientHeight || 120));
  const bw = Math.round(w * dpr);
  const bh = Math.round(h * dpr);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w, h, ctx };
}

export function drawRegionalChart(canvas, groupRows) {
  const { w, h, ctx } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);

  const byId = new Map();
  for (const r of groupRows || []) byId.set(r.region_id | 0, r);

  const n = REGION_DEFS.length;
  const padL = 12, padR = 12, padT = 26, padB = 26;
  const plotW = Math.max(40, w - padL - padR);
  const plotH = Math.max(24, h - padT - padB);
  const slotW = plotW / n;
  const barW = Math.max(8, slotW * 0.64);

  let maxCnt = 1;
  for (const reg of REGION_DEFS) {
    const r = byId.get(reg.id);
    if (r && r.count > maxCnt) maxCnt = r.count;
  }

  for (let i = 0; i < n; i++) {
    const reg = REGION_DEFS[i];
    const r = byId.get(reg.id);
    const cnt = r ? (r.count | 0) : 0;
    const avgM = r ? Number(r.avgMag || 0) : 0;
    const cx = padL + i * slotW + slotW * 0.5;
    const bh = (cnt / maxCnt) * plotH;
    const bx = cx - barW * 0.5;
    const by = padT + plotH - bh;

    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fillRect(bx, padT, barW, plotH);

    ctx.fillStyle = reg.hex;
    ctx.globalAlpha = 0.88;
    ctx.fillRect(bx, by, barW, bh);
    ctx.globalAlpha = 1.0;

    ctx.fillStyle = '#dfe9ff';
    ctx.font = '600 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(avgM > 0 ? avgM.toFixed(1) : '—', cx, Math.max(padT + 9, by - 4));

    ctx.fillStyle = '#92a7ca';
    ctx.font = '9px sans-serif';
    ctx.fillText(reg.name.split(' ')[0].slice(0, 6), cx, h - 8);
  }
}

export function drawMagnitudeHistogram(canvas, histCounts, binLabels) {
  const { w, h, ctx } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);

  const n = histCounts.length || 1;
  const padL = 16, padR = 16, padT = 26, padB = 26;
  const plotW = Math.max(40, w - padL - padR);
  const plotH = Math.max(24, h - padT - padB);
  const slotW = plotW / n;
  const barW = Math.max(10, slotW * 0.68);
  const maxVal = Math.max(1, ...histCounts);

  for (let i = 0; i < n; i++) {
    const v = histCounts[i] | 0;
    const cx = padL + i * slotW + slotW * 0.5;
    const bh = (v / maxVal) * plotH;
    const bx = cx - barW * 0.5;
    const by = padT + plotH - bh;

    const t = i / Math.max(1, n - 1);
    ctx.fillStyle = t < 0.45 ? '#28e0ff' : (t < 0.75 ? '#ffbf3c' : '#ff4fd8');
    ctx.fillRect(bx, by, barW, bh);

    ctx.fillStyle = '#dce8ff';
    ctx.font = '600 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v), cx, Math.max(padT + 9, by - 4));

    ctx.fillStyle = '#92a7ca';
    ctx.font = '10px monospace';
    ctx.fillText(binLabels[i], cx, h - 8);
  }
}
