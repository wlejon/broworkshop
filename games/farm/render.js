// render.js — draws a world snapshot to a 2D canvas context.
// Pure rendering: reads world state, NEVER mutates it.

import { GRID, REGIONS, PENS, COLORS, CROP_KINDS, ANIMAL_KINDS, ROLE_COLOR, RATES, WORKER, staminaMaxFor } from './defs.js';

// Reserve a strip on the right for the DOM HUD overlay.
const HUD_W = 270;

// Tile<->screen transform. EXPORTED so the click handler (app.js) can map a
// click back to a world tile with the EXACT same board geometry the renderer
// uses — keeping hit-testing pixel-aligned with what's drawn.
export function computeBoard(W, H) {
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

    // Grass field (checkered) across the board — tinted by the active season.
    const season = (world.env && world.env.season) || 'spring';
    const grass = SEASON_GRASS[season] || SEASON_GRASS.spring;
    for (let r = 0; r < GRID.rows; r++) {
        for (let c = 0; c < GRID.cols; c++) {
            ctx.fillStyle = ((r + c) & 1) ? grass[0] : grass[1];
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
    drawForeman(ctx, world, b, px, py);
    drawNpcs(ctx, world, b, px, py);
    drawPlayer(ctx, world, b, px, py);

    // Weather visual, then the day/night wash, both over the board.
    drawWeather(ctx, world, b);
    drawDayNight(ctx, world, b);
}

// Season -> [grassA, grassB] checker pair: spring green, summer gold-green,
// autumn amber, winter pale/desaturated.
const SEASON_GRASS = {
    spring: ['#2e5d34', '#346a3b'],
    summer: ['#4a6e2c', '#577b33'],
    fall:   ['#6a5a2c', '#766433'],
    winter: ['#5d6f5d', '#697b69'],
};

// Cheap weather overlay: rain/storm draw animated falling streaks; frost a cool
// blue wash; drought a warm haze. Deterministic-ish positions from the index so
// it animates without per-frame RNG.
function drawWeather(ctx, world, b) {
    const w = (world.env && world.env.weather) || 'clear';
    if (w === 'rain' || w === 'storm') { drawRain(ctx, world, b, w === 'storm'); return; }
    ctx.save();
    if (w === 'frost') ctx.fillStyle = 'rgba(150, 195, 240, 0.16)';
    else if (w === 'drought') ctx.fillStyle = 'rgba(232, 184, 96, 0.13)';
    else { ctx.restore(); return; }
    ctx.fillRect(b.ox, b.oy, b.w, b.h);
    ctx.restore();
}

function drawRain(ctx, world, b, storm) {
    const t = world.clock.t;
    const n = storm ? 80 : 44;
    const speed = storm ? 1.05 : 0.62;
    const len = storm ? 15 : 9;
    if (storm) {
        ctx.save();
        ctx.fillStyle = 'rgba(20, 30, 50, 0.22)';
        ctx.fillRect(b.ox, b.oy, b.w, b.h);
        ctx.restore();
    }
    ctx.save();
    ctx.strokeStyle = storm ? 'rgba(185, 205, 235, 0.55)' : 'rgba(170, 195, 225, 0.42)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
        const seed = i * 137.5 + 11;
        const x = b.ox + ((seed * 53.3) % b.w);
        const y = b.oy + (((seed * 97.1) + t * speed) % b.h);
        ctx.moveTo(x, y);
        ctx.lineTo(x - 2, y + len);
    }
    ctx.stroke();
    ctx.restore();
}

// Day/night wash driven by the clock + env.dayPhase: deep cool blue at night,
// warm amber at the dawn/dusk shoulders, clear at midday. Stronger than before
// so the phase reads at a glance.
function drawDayNight(ctx, world, b) {
    const hour = world.clock.hour + world.clock.minute / 60;
    // night factor 0..1 (1 = deepest dark)
    let night;
    if (hour < 5 || hour >= 21) night = 1;
    else if (hour < 7) night = (7 - hour) / 2;
    else if (hour > 19) night = (hour - 19) / 2;
    else night = 0;
    night = Math.max(0, Math.min(1, night));

    ctx.save();
    if (night > 0.01) {
        ctx.fillStyle = `rgba(14, 22, 58, ${0.62 * night})`;
        ctx.fillRect(b.ox, b.oy, b.w, b.h);
    }
    // Warm shoulder glow at dawn/dusk (when partly dark but not deep night).
    const phase = world.env && world.env.dayPhase;
    if (phase === 'dawn' || phase === 'dusk') {
        ctx.fillStyle = `rgba(232, 150, 70, ${0.14 * (1 - night * 0.5)})`;
        ctx.fillRect(b.ox, b.oy, b.w, b.h);
    }
    ctx.restore();
}

function drawPlayer(ctx, world, b, px, py) {
    const p = world.player;
    if (!p) return;
    const cx = px(p.x), cy = py(p.y);
    const r = b.cell * 0.34;

    // Interaction highlight: pulsing ring on the in-reach target.
    if (p.highlight) {
        const hx = px(p.highlight.x), hy = py(p.highlight.y);
        const pulse = 0.6 + 0.4 * Math.sin(world.clock.t / 140);
        ctx.strokeStyle = `rgba(120, 230, 255, ${0.45 + 0.35 * pulse})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(hx, hy, b.cell * (0.5 + 0.12 * pulse), 0, Math.PI * 2);
        ctx.stroke();
        // guide line from player to the target
        ctx.strokeStyle = 'rgba(120, 230, 255, 0.25)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(hx, hy); ctx.stroke();
        ctx.setLineDash([]);
    }

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(cx, cy + r * 1.4, r * 0.9, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();

    // Body (distinct blue, heavier outline than NPCs)
    ctx.fillStyle = '#3fa9e8';
    ctx.beginPath(); ctx.arc(cx, cy + r, r, 0, Math.PI * 2); ctx.fill();
    // Head
    ctx.beginPath(); ctx.arc(cx, cy - r * 0.6, r * 0.72, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#0d3a5c'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy + r, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy - r * 0.6, r * 0.72, 0, Math.PI * 2); ctx.stroke();

    // Straw hat: brim + crown, so the avatar reads instantly as "the farmer".
    const hy = cy - r * 1.05;
    ctx.fillStyle = '#e8c662';
    ctx.beginPath(); ctx.ellipse(cx, hy, r * 1.15, r * 0.42, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#8a6a22'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(cx, hy, r * 1.15, r * 0.42, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#f0d678';
    ctx.beginPath(); ctx.ellipse(cx, hy - r * 0.2, r * 0.6, r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.stroke();

    // "You" name tag
    const txt = 'You';
    const lw = txt.length * 7 + 10;
    ctx.fillStyle = 'rgba(20, 70, 110, 0.85)';
    roundRect(ctx, cx - lw / 2, cy - r * 2.7, lw, 14, 3); ctx.fill();
    label(ctx, txt, cx, cy - r * 2.7 + 11, '#dff3ff', 11, 'center');
}

// The Foreman: a stationary command post the workers report to for briefing.
// Drawn visually distinct from the workers — deep crimson body, a peaked
// supervisor's cap, and a clipboard — so the player can spot him at a glance.
function drawForeman(ctx, world, b, px, py) {
    const f = world.foreman;
    if (!f) return;
    const cx = px(f.x), cy = py(f.y);
    const r = b.cell * 0.34;

    // selection ring when the Foreman is being inspected
    if (world.inspect === f.id) drawSelectRing(ctx, cx, cy + r * 0.2, b.cell * 1.0, world.clock.t, '#ff7a72');

    // post marker ring on the ground so the command post reads even from afar
    ctx.strokeStyle = 'rgba(220, 80, 70, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.arc(cx, cy + r, b.cell * 0.95, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.beginPath(); ctx.ellipse(cx, cy + r * 1.5, r * 1.0, r * 0.42, 0, 0, Math.PI * 2); ctx.fill();

    // body (deep crimson — unlike any worker tint) + head, heavy dark outline
    ctx.fillStyle = '#b5343a';
    ctx.beginPath(); ctx.arc(cx, cy + r, r * 1.08, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy - r * 0.6, r * 0.78, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#3a0e10'; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.arc(cx, cy + r, r * 1.08, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy - r * 0.6, r * 0.78, 0, Math.PI * 2); ctx.stroke();

    // peaked supervisor's cap (dark band + brim) so he reads as "the boss"
    const hy = cy - r * 1.12;
    ctx.fillStyle = '#23262b';
    ctx.beginPath(); ctx.ellipse(cx, hy, r * 0.95, r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx, hy - r * 0.12, r * 0.62, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#3a3f47';
    ctx.fillRect(cx - r * 0.62, hy - r * 0.04, r * 1.24, r * 0.18);

    // clipboard tucked to his side — the briefing prop
    ctx.fillStyle = '#caa86a';
    roundRect(ctx, cx + r * 0.9, cy + r * 0.1, r * 0.7, r * 0.95, 2); ctx.fill();
    ctx.strokeStyle = '#5a4324'; ctx.lineWidth = 1;
    roundRect(ctx, cx + r * 0.9, cy + r * 0.1, r * 0.7, r * 0.95, 2); ctx.stroke();
    ctx.fillStyle = '#f4efe6';
    ctx.fillRect(cx + r * 1.02, cy + r * 0.24, r * 0.46, r * 0.6);

    // name label
    const txt = f.name || 'Foreman';
    const lw = txt.length * 7 + 10;
    ctx.fillStyle = 'rgba(90, 18, 20, 0.88)';
    roundRect(ctx, cx - lw / 2, cy - r * 2.7, lw, 14, 3); ctx.fill();
    label(ctx, txt, cx, cy - r * 2.7 + 11, '#ffe2e0', 11, 'center');

    // speech bubble while the Foreman is briefing
    if (f.speech && world.clock.t < f.speech.until) {
        drawSpeech(ctx, f.speech.text, cx, cy - r * 2.7 - 4);
    }
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
        } else { // ripe — distinct shape per kind
            drawRipe(ctx, c.kind, kindColor, cx, cy, b);

            // spoilage indicator: a ring that drains + reddens as rot nears.
            const spoilMs = (CROP_KINDS[c.kind] && CROP_KINDS[c.kind].spoilMs) || 20000;
            if (c.ripeTimer != null) {
                const frac = Math.max(0, Math.min(1, c.ripeTimer / spoilMs));
                ctx.strokeStyle = frac < 0.33 ? '#d6453a' : (frac < 0.66 ? '#e0b94a' : '#7fc24a');
                ctx.lineWidth = 2.2;
                ctx.beginPath();
                ctx.arc(cx, cy, bed * 0.42, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
                ctx.stroke();
            } else {
                // "ready" star tick when no spoil ring applies
                ctx.fillStyle = '#fff';
                ctx.beginPath(); ctx.arc(cx + bed * 0.32, cy - bed * 0.32, b.cell * 0.18, 0, Math.PI * 2); ctx.fill();
            }
        }

        // moisture bar under bed
        const mw = bed * 0.8, mx = cx - mw / 2, myy = cy + bed / 2 + 2;
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(mx, myy, mw, 3);
        ctx.fillStyle = c.moisture < 15 ? '#d6453a' : COLORS.troughWater;
        ctx.fillRect(mx, myy, mw * (c.moisture / 100), 3);
    }
}

// Distinct ripe-crop silhouette per kind.
function drawRipe(ctx, kind, color, cx, cy, b) {
    ctx.fillStyle = color;
    if (kind === 'corn') {
        // tall cob + two leaves
        ctx.beginPath();
        ctx.ellipse(cx, cy - b.cell * 0.05, b.cell * 0.22, b.cell * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#5fae3a';
        ctx.beginPath(); ctx.ellipse(cx - b.cell * 0.28, cy + b.cell * 0.1, b.cell * 0.22, b.cell * 0.1, -0.6, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(cx + b.cell * 0.28, cy + b.cell * 0.1, b.cell * 0.22, b.cell * 0.1, 0.6, 0, Math.PI * 2); ctx.fill();
    } else if (kind === 'pumpkin') {
        // big ribbed round gourd + stem
        for (const dx of [-0.26, 0, 0.26]) {
            ctx.beginPath();
            ctx.ellipse(cx + dx * b.cell, cy, b.cell * 0.26, b.cell * 0.42, 0, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.fillStyle = '#5a7a3a';
        ctx.fillRect(cx - b.cell * 0.05, cy - b.cell * 0.5, b.cell * 0.1, b.cell * 0.18);
    } else if (kind === 'carrot') {
        // downward triangle root + green frill
        ctx.beginPath();
        ctx.moveTo(cx - b.cell * 0.3, cy - b.cell * 0.18);
        ctx.lineTo(cx + b.cell * 0.3, cy - b.cell * 0.18);
        ctx.lineTo(cx, cy + b.cell * 0.5);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#5fae3a';
        for (const dx of [-0.16, 0, 0.16]) {
            ctx.beginPath(); ctx.ellipse(cx + dx * b.cell, cy - b.cell * 0.28, b.cell * 0.07, b.cell * 0.2, 0, 0, Math.PI * 2); ctx.fill();
        }
    } else if (kind === 'tomato') {
        // cluster of red orbs
        for (const [dx, dy] of [[-0.24, -0.12], [0.24, -0.12], [0, 0.2]]) {
            ctx.beginPath(); ctx.arc(cx + dx * b.cell, cy + dy * b.cell, b.cell * 0.28, 0, Math.PI * 2); ctx.fill();
        }
    } else {
        // wheat / default: three golden grain heads
        for (const [dx, dy] of [[-0.3, -0.2], [0.3, -0.2], [0, 0.25]]) {
            ctx.beginPath(); ctx.arc(cx + dx * b.cell, cy + dy * b.cell, b.cell * 0.32, 0, Math.PI * 2); ctx.fill();
        }
    }
}

function drawAnimals(ctx, world, b, px, py) {
    for (const a of world.animals) {
        const cx = px(a.x), cy = py(a.y);
        const sk = ANIMAL_KINDS[a.kind] || {};
        const need = Math.max(a.hunger, a.thirst) / 100;
        let base = sk.color || COLORS.chicken;
        // Old animals read a touch grayer.
        if (a.ageStage === 'old') base = lerpColor(base, '#9a9a92', 0.35);
        let col = a.alive ? lerpColor(base, COLORS.needHigh, Math.min(1, need)) : '#6a6a6a';
        // Young animals are smaller.
        const ageScale = a.ageStage === 'young' ? 0.62 : 1.0;
        const rad = (sk.radius || 0.34) * b.cell * ageScale;

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
        } else if (a.kind === 'sheep') {
            // fluffy wool bumps around the body + a small dark face
            ctx.fillStyle = a.alive ? 'rgba(255,255,255,0.55)' : 'rgba(150,150,150,0.4)';
            for (const ang of [0.3, 1.4, 2.5, 3.6, 4.7, 5.8]) {
                ctx.beginPath();
                ctx.arc(cx + Math.cos(ang) * rad * 0.7, cy + Math.sin(ang) * rad * 0.7, rad * 0.42, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.fillStyle = a.alive ? '#3a3530' : '#5a5a5a';
            ctx.beginPath(); ctx.arc(cx + rad * 0.7, cy, rad * 0.34, 0, Math.PI * 2); ctx.fill();
        } else {
            // chicken beak
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

        // sick marker: a magenta cross on a pale disc above the animal
        if (a.alive && a.sick) {
            const mx = cx, my = cy - rad - b.cell * 0.32;
            const mr = b.cell * 0.22;
            ctx.fillStyle = 'rgba(250,250,250,0.92)';
            ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = COLORS.sick; ctx.lineWidth = 2.4;
            ctx.beginPath(); ctx.moveTo(mx - mr * 0.5, my); ctx.lineTo(mx + mr * 0.5, my);
            ctx.moveTo(mx, my - mr * 0.5); ctx.lineTo(mx, my + mr * 0.5); ctx.stroke();
        }

        // young marker: a tiny sprout dot so newborns read at a glance
        if (a.alive && a.ageStage === 'young') {
            ctx.fillStyle = '#9ee06a';
            ctx.beginPath(); ctx.arc(cx, cy - rad - b.cell * 0.18, b.cell * 0.1, 0, Math.PI * 2); ctx.fill();
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

// Color for a carried item shown as a small chip on the worker.
const CARRY_COLOR = {
    water: COLORS.troughWater,
    feed:  COLORS.troughFeed,
    crop:  COLORS.cropWheat,
    crate: '#caa86a',
    medkit: '#e85a6a',
};

function drawNpcs(ctx, world, b, px, py) {
    const now = world.clock.t;

    // First pass: faint move-target lines + markers (drawn under the bodies).
    for (const n of world.npcs) {
        const target = currentMoveTarget(n);
        if (!target) continue;
        const cx = px(n.x), cy = py(n.y);
        const tx = px(target.x), ty = py(target.y);
        ctx.strokeStyle = 'rgba(255,225,120,0.30)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tx, ty); ctx.stroke();
        ctx.setLineDash([]);
        // destination ring
        ctx.strokeStyle = 'rgba(255,225,120,0.55)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(tx, ty, b.cell * 0.35, 0, Math.PI * 2); ctx.stroke();
    }

    for (const n of world.npcs) {
        const cx = px(n.x), cy = py(n.y);
        const r = b.cell * 0.3;
        const roleCol = ROLE_COLOR[n.role] || '#caa';
        // selection ring when this worker is the one being inspected
        if (world.inspect === n.id) drawSelectRing(ctx, cx, cy + r * 0.2, b.cell * 0.85, world.clock.t, roleCol);
        // body
        ctx.fillStyle = COLORS.npc;
        ctx.beginPath(); ctx.arc(cx, cy + r, r, 0, Math.PI * 2); ctx.fill();
        // head
        ctx.beginPath(); ctx.arc(cx, cy - r * 0.6, r * 0.7, 0, Math.PI * 2); ctx.fill();
        // role-tinted outline so each worker's specialty reads at a glance
        ctx.strokeStyle = roleCol; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, cy + r, r, 0, Math.PI * 2); ctx.stroke();

        // carrying indicator: small chip to the worker's side
        if (n.carrying) {
            const col = CARRY_COLOR[n.carrying] || '#fff';
            const ix = cx + r * 1.5, iy = cy + r * 0.3;
            ctx.fillStyle = col;
            roundRect(ctx, ix - r * 0.45, iy - r * 0.45, r * 0.9, r * 0.9, 2); ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1;
            roundRect(ctx, ix - r * 0.45, iy - r * 0.45, r * 0.9, r * 0.9, 2); ctx.stroke();
        }

        // state indicator above the head: Zzz asleep, pause-bars resting,
        // fork eating, green pip when actively on a job.
        if (n.state === 'sleeping') {
            ctx.fillStyle = '#bfe0ff';
            ctx.font = `bold ${Math.max(9, b.cell * 0.5)}px Consolas, monospace`;
            ctx.textAlign = 'left';
            ctx.fillText('z', cx + r * 0.7, cy - r * 1.2);
            ctx.font = `bold ${Math.max(7, b.cell * 0.35)}px Consolas, monospace`;
            ctx.fillText('z', cx + r * 1.3, cy - r * 1.7);
        } else if (n.state === 'resting') {
            ctx.fillStyle = '#9ec6f0';
            ctx.fillRect(cx + r * 0.7, cy - r * 1.7, r * 0.25, r * 0.7);
            ctx.fillRect(cx + r * 1.1, cy - r * 1.7, r * 0.25, r * 0.7);
        } else if (n.state === 'eating') {
            ctx.fillStyle = '#e8c662';
            ctx.beginPath(); ctx.arc(cx + r * 0.9, cy - r * 1.4, r * 0.32, 0, Math.PI * 2); ctx.fill();
        } else if (n.state === 'recovering') {
            // small green healing cross while recovering at home
            ctx.fillStyle = '#7fd0a0';
            ctx.fillRect(cx + r * 0.78, cy - r * 1.55, r * 0.55, r * 0.18);
            ctx.fillRect(cx + r * 0.96, cy - r * 1.73, r * 0.18, r * 0.55);
        } else if (n.task) {
            ctx.fillStyle = '#7fc24a';
            ctx.beginPath(); ctx.arc(cx + r * 0.9, cy - r * 1.4, r * 0.3, 0, Math.PI * 2); ctx.fill();
        }

        // name label
        const lw = n.name.length * 7 + 8;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        roundRect(ctx, cx - lw / 2, cy - r * 2.6, lw, 14, 3); ctx.fill();
        label(ctx, n.name, cx, cy - r * 2.6 + 11, '#fff', 11, 'center');

        // stamina bar just under the name (fills against the Endurance-driven cap)
        if (n.stamina != null) {
            const bw = lw, bx = cx - bw / 2, by = cy - r * 2.6 + 15;
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            ctx.fillRect(bx, by, bw, 3);
            const f = Math.max(0, Math.min(1, n.stamina / staminaMaxFor(n)));
            ctx.fillStyle = n.stamina < 25 ? '#d6453a' : (n.stamina < 55 ? '#e0b94a' : '#6fc24a');
            ctx.fillRect(bx, by, bw * f, 3);
        }

        // critical-need badge: a small red "!" disc when a need is in the danger
        // zone (parched / starving / spent / unwell) so it reads at a glance.
        const critNeed = (n.hydration != null && n.hydration < WORKER.thirsty) ||
                         (n.energy != null && n.energy < WORKER.hungry) ||
                         (n.stamina != null && n.stamina < WORKER.exhausted) ||
                         (n.health != null && n.health < WORKER.healthForce);
        if (critNeed) {
            const bx = cx - r * 1.5, by = cy - r * 0.2;
            ctx.fillStyle = '#d6453a';
            ctx.beginPath(); ctx.arc(bx, by, r * 0.5, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.arc(bx, by, r * 0.5, 0, Math.PI * 2); ctx.stroke();
            ctx.fillStyle = '#fff';
            ctx.font = `bold ${Math.max(8, b.cell * 0.4)}px Consolas, monospace`;
            ctx.textAlign = 'center';
            ctx.fillText('!', bx, by + r * 0.35);
        }

        // speech bubble while a line is live
        if (n.speech && now < n.speech.until) {
            drawSpeech(ctx, n.speech.text, cx, cy - r * 2.6 - 4);
        }
    }
}

function currentMoveTarget(n) {
    if (!n.task) return null;
    const step = n.task.steps[n.task.cursor];
    if (step && step.type === 'move') return { x: step.x, y: step.y };
    return null;
}

function drawSpeech(ctx, text, cx, baseY) {
    ctx.font = '11px Consolas, monospace';
    const tw = (ctx.measureText ? ctx.measureText(text).width : text.length * 6) + 14;
    const bh = 18;
    const x = cx - tw / 2, y = baseY - bh;
    ctx.fillStyle = 'rgba(250,250,245,0.95)';
    roundRect(ctx, x, y, tw, bh, 5); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1;
    roundRect(ctx, x, y, tw, bh, 5); ctx.stroke();
    // tail
    ctx.fillStyle = 'rgba(250,250,245,0.95)';
    ctx.beginPath();
    ctx.moveTo(cx - 4, y + bh - 1);
    ctx.lineTo(cx + 4, y + bh - 1);
    ctx.lineTo(cx, y + bh + 5);
    ctx.fill();
    label(ctx, text, cx, y + 13, '#222', 11, 'center');
}

// Pulsing dashed ring marking the entity the stat-sheet panel is bound to.
function drawSelectRing(ctx, cx, cy, radius, t, color) {
    const pulse = 0.5 + 0.5 * Math.sin(t / 180);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.55 + 0.35 * pulse;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([5, 4]);
    ctx.lineDashOffset = -t / 40;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * (1 + 0.05 * pulse), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
}

function label(ctx, text, x, y, color, size, align) {
    ctx.fillStyle = color;
    ctx.font = `${size}px Consolas, monospace`;
    ctx.textAlign = align || 'left';
    ctx.fillText(text, x, y);
    ctx.textAlign = 'left';
}
