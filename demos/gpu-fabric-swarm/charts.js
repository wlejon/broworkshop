// Crisp HiDPI 2D charts (aspect-ratio matched via clientWidth/clientHeight)
// for species census (ReactiveQuery groupBy) and 16-chunk dirty/reuse map.

import { SPECIES_DEFS, CHUNK_COUNT } from "./data.js";

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

export function drawSpeciesCensusChart(canvas, rows) {
  const { w, h, ctx } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);

  const byId = new Map();
  for (const r of rows || []) byId.set(r.species_id | 0, r);

  const padL = 14, padR = 14, padT = 26, padB = 26;
  const plotW = Math.max(40, w - padL - padR);
  const plotH = Math.max(24, h - padT - padB);
  const n = SPECIES_DEFS.length;
  const slotW = plotW / n;
  const barW = Math.min(72, slotW * 0.62);

  let maxCount = 1;
  for (const s of SPECIES_DEFS) {
    const r = byId.get(s.id);
    if (r && r.count > maxCount) maxCount = r.count;
  }

  for (let i = 0; i < n; i++) {
    const s = SPECIES_DEFS[i];
    const r = byId.get(s.id);
    const cnt = r ? (r.count | 0) : 0;
    const avgE = r ? Number(r.avgEnergy || 0) : 0;
    const cx = padL + i * slotW + slotW * 0.5;
    const bh = (cnt / maxCount) * plotH;
    const bx = cx - barW * 0.5;
    const by = padT + plotH - bh;

    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fillRect(bx, padT, barW, plotH);

    ctx.fillStyle = s.hex;
    ctx.globalAlpha = 0.86;
    ctx.fillRect(bx, by, barW, bh);
    ctx.globalAlpha = 1.0;

    ctx.fillStyle = '#e6eeff';
    ctx.font = '600 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${cnt.toLocaleString()} · E=${avgE.toFixed(2)}`, cx, Math.max(padT + 10, by - 4));

    ctx.fillStyle = '#9bb0d0';
    ctx.font = '11px sans-serif';
    ctx.fillText(s.name, cx, h - 8);
  }
}

export function drawChunkReuseChart(canvas, dirtyChunkIndices, writebackCount) {
  const { w, h, ctx } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);

  const dirtySet = new Set(dirtyChunkIndices || []);
  const padL = 14, padR = 14, padT = 28, padB = 26;
  const plotW = Math.max(40, w - padL - padR);
  const plotH = Math.max(24, h - padT - padB);
  const gap = 5;
  const cellW = Math.max(6, (plotW - gap * (CHUNK_COUNT - 1)) / CHUNK_COUNT);

  for (let c = 0; c < CHUNK_COUNT; c++) {
    const x = padL + c * (cellW + gap);
    const isDirty = dirtySet.has(c);

    ctx.fillStyle = isDirty ? '#ff9f43' : '#234a6e';
    ctx.fillRect(x, padT, cellW, plotH);
    ctx.strokeStyle = isDirty ? '#ffd18c' : '#3d78ad';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, padT + 0.5, cellW - 1, plotH - 1);

    ctx.fillStyle = isDirty ? '#09101a' : '#cfe3ff';
    ctx.font = '600 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(isDirty ? 'DIRTY' : 'REUSE', x + cellW * 0.5, padT + plotH * 0.5 + 3);

    ctx.fillStyle = '#8fa4c6';
    ctx.font = '10px monospace';
    ctx.fillText(`c${c}`, x + cellW * 0.5, h - 8);
  }

  ctx.fillStyle = '#9bb0d0';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'right';
  const reused = CHUNK_COUNT - dirtySet.size;
  ctx.fillText(
    `Writebacks: ${writebackCount} · Dirty ${dirtySet.size}/${CHUNK_COUNT} · Reused ${reused}/${CHUNK_COUNT}`,
    w - padR,
    15
  );
}
