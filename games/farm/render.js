// render.js — draws a world snapshot to a 2D canvas context.
// Pure rendering: reads world state, NEVER mutates it.

import { GRID, REGIONS, PENS, COLORS, CROP_KINDS, RATES } from './defs.js';

// Reserve a strip on the right for the DOM HUD overlay.
const HUD_W = 270;

function computeBoard(W, H) {
    const margin = 24;
    const availW = W - HUD_W - margin * 2;
    const availH = H - margin * 2;
    const cell = Math.max(6, Math.floor(Math.min(availW / GRID.cols, availH / GRID.rows)));
    const w = cell * GRID.cols, h = cell * GRID.rows;
    return {
        ox: margin + Math.floor((availW - w) / 2),
        oy: margin + Math.floor((availH - h) / 2),
        cell, w, h,
    };
}

function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function lerpColor(a, b, t) {
    const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
    const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
    const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export function render(ctx, world, W, H) {
    const b = computeBoard(W, H);
    const px = (tx) => b.ox + tx * b.cell;
    const py = (ty) => b.oy + ty * b.cell;

    // Background
    ctx.fillStyle = '#10160f';
    ctx.fillRect(0, 0, W, H);

    // Grass field (checkered) across the board
    for (let r = 0; r < GRID.rows; r++) {
        for (let c = 0; c < GRID.cols; c++) {
            ctx.fillStyle = ((r + c) & 1) ? COLORS.grass : COLORS.grassAlt;
            ctx.fillRect(px(c), py(r), b.cell + 1, b.cell + 1);
        }
    }

    // Board border
    ctx.strokeStyle = '#0a0f0a';
    ctx.lineWidth = 2;
    ctx.strokeRect(b.ox - 1, b.oy - 1, b.w + 2, b.h + 2);

    drawRegions(ctx, world, b, px, py);
    drawCrops(ctx, world, b, px, py);
    drawTroughs(ctx, world, b, px, py);
    drawAnimals(ctx, world, b, px, py);
    drawNpcs(ctx, world, b, px, py);
}

function drawRegions(ctx, world, b, px, py) {
    for (const reg of REGIONS) {
        const x = px(reg.x0), y = py(reg.y0);
        const w = (reg.x1 - reg.x0) * b.cell, h = (reg.y1 - reg.y0) * b.cell;

        if (reg.type === 'pen') {
            ctx.fillStyle = COLORS.penFill;
            roundRect(ctx, x, y, w, h, 6); ctx.fill();
            ctx.strokeStyle = COLORS.penFence;
            ctx.lineWidth = 3;
            roundRect(ctx, x, y, w, h, 6); ctx.stroke();
            label(ctx, reg.label, x + 6, y + 14, '#fff', 12);
            continue;
        }
        if (reg.type === 'field') {
            ctx.fillStyle = COLORS.field;
            roundRect(ctx, x, y, w, h, 4); ctx.fill();
            ctx.strokeStyle = '#3a2c1c';
            ctx.lineWidth = 2;
            roundRect(ctx, x, y, w, h, 4); ctx.stroke();
            label(ctx, reg.label, x + 6, y + 14, '#e8d8b0', 12);
            continue;
        }
        // Buildings: labeled rounded rects
        const fill = COLORS[reg.type] || '#777';
        ctx.fillStyle = fill;
        roundRect(ctx, x, y, w, h, 5); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.45)';
        ctx.lineWidth = 2;
        roundRect(ctx, x, y, w, h, 5); ctx.stroke();
        // Roof accent
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        roundRect(ctx, x, y, w, Math.max(6, h * 0.28), 5); ctx.fill();
        label(ctx, reg.label, x + w / 2, y + h / 2 + 4, '#fff', 13, 'center');
    }
}

function drawTroughs(ctx, world, b, px, py) {
    const tw = b.cell * 1.6, th = b.cell * 0.9;
    for (const id of Object.keys(world.troughs)) {
        const t = world.troughs[id];
        const cx = px(t.x), cy = py(t.y);
        const x = cx - tw / 2, y = cy - th / 2;
        // frame
        ctx.fillStyle = '#2c2014';
        roundRect(ctx, x, y, tw, th, 3); ctx.fill();
        // fill level
        const frac = Math.max(0, Math.min(1, t.fill / 100));
        const fillColor = t.kind === 'feed' ? COLORS.troughFeed : COLORS.troughWater;
        ctx.fillStyle = fillColor;
        const fh = (th - 4) * frac;
        ctx.fillRect(x + 2, y + 2 + (th - 4 - fh), tw - 4, fh);
        ctx.strokeStyle = frac < 0.2 ? '#d6453a' : 'rgba(0,0,0,0.5)';
        ctx.lineWidth = frac < 0.2 ? 2 : 1;
        roundRect(ctx, x, y, tw, th, 3); ctx.stroke();
    }
}

function drawCrops(ctx, world, b, px, py) {
    for (const c of world.crops) {
        const cx = px(c.x), cy = py(c.y);
        const bed = b.cell * 2.4;
        // soil bed
        ctx.fillStyle = c.moisture > 40 ? '#3a2a18' : COLORS.soil;
        roundRect(ctx, cx - bed / 2, cy - bed / 2, bed, bed, 3); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.lineWidth = 1;
        roundRect(ctx, cx - bed / 2, cy - bed / 2, bed, bed, 3); ctx.stroke();

        if (c.stage === 'empty') continue;
        const kindColor = (CROP_KINDS[c.kind] && CROP_KINDS[c.kind].color) || COLORS.cropSprout;

        if (c.stage === 'seed') {
            ctx.fillStyle = '#5a7a3a';
            ctx.beginPath(); ctx.arc(cx, cy, Math.max(2, b.cell * 0.18), 0, Math.PI * 2); ctx.fill();
        } else if (c.stage === 'growing') {
            // sprout: stalk + growth-scaled leaves
            const t = c.growth / 100;
            const hgt = b.cell * (0.4 + t * 0.9);
            ctx.strokeStyle = COLORS.cropSprout;
            ctx.lineWidth = Math.max(1.5, b.cell * 0.12);
            ctx.beginPath(); ctx.moveTo(cx, cy + b.cell * 0.5); ctx.lineTo(cx, cy + b.cell * 0.5 - hgt); ctx.stroke();
            ctx.fillStyle = COLORS.cropSprout;
            ctx.beginPath(); ctx.arc(cx, cy + b.cell * 0.5 - hgt, b.cell * 0.22, 0, Math.PI * 2); ctx.fill();
        } else { // ripe
            ctx.fillStyle = kindColor;
            for (const [dx, dy] of [[-0.3, -0.2], [0.3, -0.2], [0, 0.25]]) {
                ctx.beginPath();
                ctx.arc(cx + dx * b.cell, cy + dy * b.cell, b.cell * 0.32, 0, Math.PI * 2);
                ctx.fill();
            }
            // "ready" star tick
            ctx.fillStyle = '#fff';
            ctx.beginPath(); ctx.arc(cx + bed * 0.32, cy - bed * 0.32, b.cell * 0.18, 0, Math.PI * 2); ctx.fill();
        }

        // moisture bar under bed
        const mw = bed * 0.8, mx = cx - mw / 2, myy = cy + bed / 2 + 2;
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(mx, myy, mw, 3);
        ctx.fillStyle = c.moisture < 15 ? '#d6453a' : COLORS.troughWater;
        ctx.fillRect(mx, myy, mw * (c.moisture / 100), 3);
    }
}

function drawAnimals(ctx, world, b, px, py) {
    for (const a of world.animals) {
        const cx = px(a.x), cy = py(a.y);
        const need = Math.max(a.hunger, a.thirst) / 100;
        let base = a.kind === 'cow' ? COLORS.cow : COLORS.chicken;
        let col = a.alive ? lerpColor(base, COLORS.needHigh, Math.min(1, need)) : '#6a6a6a';
        const rad = (a.kind === 'cow' ? 0.5 : 0.34) * b.cell;

        // body
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.stroke();

        if (a.kind === 'cow') {
            // dark spots
            ctx.fillStyle = a.alive ? 'rgba(40,30,30,0.55)' : 'rgba(40,40,40,0.5)';
            ctx.beginPath(); ctx.arc(cx - rad * 0.4, cy - rad * 0.2, rad * 0.3, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(cx + rad * 0.35, cy + rad * 0.3, rad * 0.25, 0, Math.PI * 2); ctx.fill();
        } else {
            // beak
            ctx.fillStyle = '#e8a23a';
            ctx.beginPath();
            ctx.moveTo(cx + rad, cy);
            ctx.lineTo(cx + rad * 1.6, cy - rad * 0.2);
            ctx.lineTo(cx + rad * 1.6, cy + rad * 0.2);
            ctx.fill();
        }

        // health pip (small ring) when low
        if (a.alive && a.health < 60) {
            ctx.strokeStyle = a.health < 40 ? '#d6453a' : '#e0b94a';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(cx, cy, rad + 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (a.health / 100)); ctx.stroke();
        }
    }
    // pending-produce badges on pens
    for (const penId of Object.keys(world.pens)) {
        const pen = world.pens[penId];
        if (pen.pending <= 0) continue;
        const reg = REGIONS.find((r) => r.penId === penId);
        if (!reg) continue;
        const x = px(reg.x1) - 18, y = py(reg.y0) + 4;
        ctx.fillStyle = '#f6d24a';
        roundRect(ctx, x - 4, y, 26, 16, 4); ctx.fill();
        label(ctx, String(pen.pending), x + 9, y + 12, '#222', 11, 'center');
    }
}

function drawNpcs(ctx, world, b, px, py) {
    for (const n of world.npcs) {
        const cx = px(n.x), cy = py(n.y);
        const r = b.cell * 0.3;
        // body
        ctx.fillStyle = COLORS.npc;
        ctx.beginPath(); ctx.arc(cx, cy + r, r, 0, Math.PI * 2); ctx.fill();
        // head
        ctx.beginPath(); ctx.arc(cx, cy - r * 0.6, r * 0.7, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(cx, cy + r, r, 0, Math.PI * 2); ctx.stroke();
        // name label
        const lw = ctx.measureText ? n.name.length * 7 + 8 : 40;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        roundRect(ctx, cx - lw / 2, cy - r * 2.4, lw, 14, 3); ctx.fill();
        label(ctx, n.name, cx, cy - r * 2.4 + 11, '#fff', 11, 'center');
    }
}

function label(ctx, text, x, y, color, size, align) {
    ctx.fillStyle = color;
    ctx.font = `${size}px Consolas, monospace`;
    ctx.textAlign = align || 'left';
    ctx.fillText(text, x, y);
    ctx.textAlign = 'left';
}
