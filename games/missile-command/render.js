// Missile Command drawing — sky, ground, cities, silos, trails, blasts and
// the crosshair. Reads a battlefield from rules.js, never changes it.

// Ammo pips stacked on a silo, top first.
const AMMO_SLOTS = [
    [0, -24], [-5, -20], [5, -20], [-10, -16], [0, -16], [10, -16],
    [-12, -12], [-4, -12], [4, -12], [12, -12],
];

export function createSky(W, H, groundY) {
    const stars = [];
    for (let i = 0; i < 80; i++) stars.push({ x: Math.random() * W, y: Math.random() * groundY, b: 0.3 + Math.random() * 0.7 });
    return stars;
}

export function drawBattle(ctx, d, sky, aim) {
    const W = d.W, H = d.H, gy = d.groundY;
    for (const s of sky) {
        ctx.fillStyle = "rgba(255,255,255," + s.b.toFixed(2) + ")";
        ctx.fillRect(s.x, s.y, 1, 1);
    }

    ctx.fillStyle = "#2a1a05";
    ctx.fillRect(0, gy, W, H - gy);
    ctx.strokeStyle = "#ff8000";
    ctx.lineWidth = 2;
    line(ctx, 0, gy, W, gy);

    for (const c of d.cities) {
        if (c.alive) drawCity(ctx, c.x, gy);
        else { ctx.fillStyle = "#442"; ctx.fillRect(c.x - 18, gy - 6, 36, 6); }
    }
    for (const s of d.silos) drawSilo(ctx, s, gy);

    for (const e of d.enemies) {
        ctx.strokeStyle = "rgba(255,80,80,0.9)";
        ctx.lineWidth = 2;
        line(ctx, e.sx, e.sy, e.x, e.y);
        dot(ctx, e.x, e.y, 2.5, "#ffef7a");
    }
    for (const m of d.missiles) {
        ctx.strokeStyle = "rgba(120,220,255,0.95)";
        ctx.lineWidth = 2;
        line(ctx, m.sx, m.sy, m.x, m.y);
        ctx.strokeStyle = "rgba(120,220,255,0.5)";          // target cross
        ctx.lineWidth = 1;
        line(ctx, m.tx - 4, m.ty - 4, m.tx + 4, m.ty + 4);
        line(ctx, m.tx + 4, m.ty - 4, m.tx - 4, m.ty + 4);
        dot(ctx, m.x, m.y, 2.5, "#cfefff");
    }
    for (const b of d.blasts) drawBlast(ctx, b);
    if (aim) drawCrosshair(ctx, aim.x, aim.y);
}

function line(ctx, x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
}

function dot(ctx, x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
}

function drawCity(ctx, cx, gy) {
    const heights = [10, 16, 12, 18, 14];
    const bw = 6;
    const x0 = cx - (heights.length * bw) / 2;
    ctx.fillStyle = "#6ad3ff";
    heights.forEach((h, i) => ctx.fillRect(x0 + i * bw + 1, gy - h, bw - 2, h));
    ctx.strokeStyle = "rgba(106,211,255,0.4)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x0, gy - 18, heights.length * bw, 18);
}

function drawSilo(ctx, s, gy) {
    if (!s.alive) {
        ctx.fillStyle = "#332";
        ctx.fillRect(s.x - 20, gy - 6, 40, 6);
        return;
    }
    ctx.fillStyle = "#ffb060";
    ctx.beginPath();
    ctx.moveTo(s.x - 22, gy);
    ctx.lineTo(s.x + 22, gy);
    ctx.lineTo(s.x + 14, gy - 18);
    ctx.lineTo(s.x - 14, gy - 18);
    ctx.closePath();
    ctx.fill();
    for (let i = 0; i < s.ammo && i < AMMO_SLOTS.length; i++) dot(ctx, s.x + AMMO_SLOTS[i][0], gy + AMMO_SLOTS[i][1], 2, "#ffef7a");
}

// Enemy impacts burn red, player blasts gold.
function drawBlast(ctx, b) {
    const hue = b.enemy ? "#ff4040" : "#ffef7a";
    dot(ctx, b.x, b.y, b.r, b.enemy ? "rgba(255,64,64,0.15)" : "rgba(255,220,120,0.2)");
    ctx.strokeStyle = hue;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r * 0.7, 0, Math.PI * 2);
    ctx.stroke();
    dot(ctx, b.x, b.y, Math.max(1, b.r * 0.3), hue);
}

function drawCrosshair(ctx, x, y) {
    ctx.strokeStyle = "rgba(180,255,180,0.8)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 10, y); ctx.lineTo(x - 3, y);
    ctx.moveTo(x + 3, y); ctx.lineTo(x + 10, y);
    ctx.moveTo(x, y - 10); ctx.lineTo(x, y - 3);
    ctx.moveTo(x, y + 3); ctx.lineTo(x, y + 10);
    ctx.stroke();
}
