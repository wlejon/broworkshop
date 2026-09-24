// render.js — the map, its overlays and the swarm on one 2D canvas.
//
// Everything per-cell (terrain, heatmaps, cover, chokes) is painted into a
// COLS x ROWS ImageData and scaled up once per frame, rebuilt only when
// something it shows changed. Arrows, units and markers are each ONE path:
// a few thousand units are one fill, not a few thousand.

import { COLS, ROWS, TERRAIN, field, idx } from "/app/field.js";
import { tactics } from "/app/tactics.js";
import { swarm } from "/app/units.js";

export const show = { flow: true, influence: false, integration: false, chokes: true, cover: true, leader: true };

export const viewport = { scale: 1, ox: 0, oy: 0 };

let ctx = null, canvas = null, layer = null, layerCtx = null, image = null, stamp = '';

export function bindCanvas(c) {
    canvas = c;
    ctx = c.getContext('2d');
    layer = document.createElement('canvas');
    layer.width = COLS; layer.height = ROWS;
    layerCtx = layer.getContext('2d');
    image = layerCtx.createImageData(COLS, ROWS);
    resize();
}

/** Fit the map to the canvas (uniform scale, centred). */
export function resize() {
    if (!canvas) return;
    canvas.width = Math.max(1, canvas.clientWidth | 0);
    canvas.height = Math.max(1, canvas.clientHeight | 0);
    const s = Math.min(canvas.width / COLS, canvas.height / ROWS);
    viewport.scale = s;
    viewport.ox = (canvas.width - COLS * s) / 2;
    viewport.oy = (canvas.height - ROWS * s) / 2;
    stamp = '';
}

/** Canvas pixel -> world (cells). */
export function toWorld(px, py) {
    return { x: (px - viewport.ox) / viewport.scale, y: (py - viewport.oy) / viewport.scale };
}
/** World -> canvas pixel. */
export function toCanvas(x, y) {
    return { x: viewport.ox + x * viewport.scale, y: viewport.oy + y * viewport.scale };
}

function paintLayer(ui) {
    const key = [field.version, ui.waves, tactics.threatVersion, ui.influenceStamp, show.influence, show.integration, show.cover, show.chokes].join('|');
    if (key === stamp) return;
    stamp = key;
    const d = image.data, C = field.cost, D = field.integration, T = field.threat, I = tactics.influence;
    for (let i = 0; i < COLS * ROWS; i++) {
        let r = 16, g = 23, b = 38;
        const c = C[i];
        if (c >= TERRAIN.WALL) { r = 44; g = 56; b = 84; }
        else {
            if (c === TERRAIN.ROUGH) { r = 70; g = 50; b = 26; }
            if (show.integration && D[i] < 1e8) {
                const n = Math.min(1, D[i] / 260);
                r = r * 0.45 + n * 150; g = g * 0.45 + (1 - Math.abs(n - 0.5) * 2) * 110; b = b * 0.45 + (1 - n) * 150;
            }
            if (show.influence) {
                if (T[i] > 0.04) { const a = Math.min(0.7, T[i] * 0.6); r = r * (1 - a) + 230 * a; g *= 1 - a; b = b * (1 - a) + 60 * a; }
                else if (I[i] > 0.05) { const a = Math.min(0.55, I[i] * 0.35); r *= 1 - a; g = g * (1 - a) + 190 * a; b = b * (1 - a) + 230 * a; }
            }
            if (show.cover && tactics.cover[i]) { r = r * 0.4 + 30; g = g * 0.4 + 140; b = b * 0.4 + 70; }
            if (show.chokes && tactics.choke[i]) { r = r * 0.55 + 110; g = g * 0.55 + 70; b *= 0.55; }
        }
        d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
    }
    layerCtx.putImageData(image, 0, 0);
}

/** Draw a frame. ui: { leader, brush: { x, y, r, color } | null, waves, influenceStamp }. */
export function draw(ui) {
    const s = viewport.scale, W = (x) => viewport.ox + x * s, H = (y) => viewport.oy + y * s;
    ctx.fillStyle = '#080c16';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    paintLayer(ui);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(layer, 0, 0, COLS, ROWS, viewport.ox, viewport.oy, COLS * s, ROWS * s);

    if (show.flow) {
        ctx.strokeStyle = 'rgba(90, 210, 244, 0.45)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let y = 1; y < ROWS - 1; y += 3) {
            for (let x = 1; x < COLS - 1; x += 3) {
                const i = idx(x, y), fx = field.flowX[i], fy = field.flowY[i];
                if (!fx && !fy) continue;
                const cx = W(x + 0.5), cy = H(y + 0.5), ex = cx + fx * s * 1.3, ey = cy + fy * s * 1.3;
                ctx.moveTo(cx, cy); ctx.lineTo(ex, ey);
                ctx.moveTo(ex, ey); ctx.lineTo(ex - (fx * 0.9 - fy * 0.5) * s * 0.5, ey - (fy * 0.9 + fx * 0.5) * s * 0.5);
            }
        }
        ctx.stroke();
    }

    if (show.leader && ui.leader && ui.leader.points.length > 1) {
        ctx.strokeStyle = '#f5a623';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ui.leader.points.forEach((p, i) => (i ? ctx.lineTo(W(p.x), H(p.y)) : ctx.moveTo(W(p.x), H(p.y))));
        ctx.stroke();
        ctx.setLineDash([]);
    }

    if (show.chokes) {
        ctx.fillStyle = '#ffaa33';
        ctx.beginPath();
        for (const c of tactics.chokes) {
            const x = W(c.x), y = H(c.y), r = Math.max(5, s * 0.9);
            ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
        }
        ctx.fill();
        ctx.font = '11px monospace';
        for (const c of tactics.chokes) ctx.fillText(`choke ${c.width}`, W(c.x) + 9, H(c.y) - 7);
    }

    for (const t of tactics.threats) {
        ctx.strokeStyle = 'rgba(255, 64, 96, 0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(W(t.x), H(t.y), Math.max(6, s), 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = 'rgba(255, 64, 96, 0.3)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.arc(W(t.x), H(t.y), t.radius * s, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
    }

    // Formation ghosts (a sample), then the units as one path.
    const S = swarm, n = S.n, r = Math.max(1.6, S.radius * s);
    ctx.strokeStyle = 'rgba(90, 210, 244, 0.25)';
    ctx.beginPath();
    for (let i = 0; i < n; i += Math.max(1, (n / 250) | 0)) ctx.rect(W(S.slotX[i]) - 1.5, H(S.slotY[i]) - 1.5, 3, 3);
    ctx.stroke();
    ctx.fillStyle = '#5ad2f4';
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
        const x = W(S.x[i]), y = H(S.y[i]), vx = S.vx[i], vy = S.vy[i], sp = Math.hypot(vx, vy);
        if (sp > 0.6) {
            const c = vx / sp, sn = vy / sp;
            ctx.moveTo(x + c * r * 1.6, y + sn * r * 1.6);
            ctx.lineTo(x - c * r - sn * r * 0.9, y - sn * r + c * r * 0.9);
            ctx.lineTo(x - c * r * 0.4, y - sn * r * 0.4);
            ctx.lineTo(x - c * r + sn * r * 0.9, y - sn * r - c * r * 0.9);
            ctx.closePath();
        } else {
            ctx.moveTo(x + r * 0.8, y);
            ctx.arc(x, y, r * 0.8, 0, Math.PI * 2);
        }
    }
    ctx.fill();

    // The goal, facing the formation's front.
    const g = field.goal;
    ctx.strokeStyle = '#7bed9f';
    ctx.fillStyle = 'rgba(123, 237, 159, 0.2)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(W(g.x), H(g.y), Math.max(8, s), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W(g.x), H(g.y));
    ctx.lineTo(W(g.x + Math.cos(S.facing) * 2.4), H(g.y + Math.sin(S.facing) * 2.4)); ctx.stroke();

    if (ui.brush) {
        ctx.strokeStyle = ui.brush.color;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(W(ui.brush.x), H(ui.brush.y), ui.brush.r * s, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
    }
}
