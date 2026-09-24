// Puffs — procedural fluffy creature tiles.
//
// A puff is a colored blob with a jittered fur outline, a belly patch, two
// eyes that blink and track the pointer, and a mouth that reflects state.
// Each color also has its own fur, eyes and mouth, so the six kinds read as
// different characters even to colorblind players. No images.

const PALETTE = [
    null,
    { name: "ember", core: "#ff6e7a", belly: "#ffc0c6", dark: "#a02030", outline: "#5a0f1f", fur: 1.0, bumps: 14 },
    { name: "tide", core: "#4fa8ff", belly: "#b8d8ff", dark: "#153a78", outline: "#0a1a44", fur: 0.7, bumps: 10 },
    { name: "mint", core: "#5ed59a", belly: "#bff0d2", dark: "#166a3f", outline: "#073320", fur: 1.3, bumps: 18 },
    { name: "daisy", core: "#ffcc54", belly: "#fff0b0", dark: "#8a6410", outline: "#4a3208", fur: 0.55, bumps: 8 },
    { name: "dusk", core: "#c78aff", belly: "#e6c8ff", dark: "#5a2a88", outline: "#2a1050", fur: 1.1, bumps: 12 },
    { name: "cocoa", core: "#b07050", belly: "#e0b090", dark: "#4a2810", outline: "#1a0c04", fur: 1.6, bumps: 20 },
];

const FACE = [
    null,
    { eyeSpread: 0.38, eyeY: -0.12, eyeR: 0.14, mouthY: 0.24, mouthW: 0.32, mouth: "smile" },
    { eyeSpread: 0.34, eyeY: -0.14, eyeR: 0.12, mouthY: 0.2, mouthW: 0.26, mouth: "smile" },
    { eyeSpread: 0.42, eyeY: -0.1, eyeR: 0.16, mouthY: 0.22, mouthW: 0.38, mouth: "grin" },
    { eyeSpread: 0.3, eyeY: -0.16, eyeR: 0.11, mouthY: 0.2, mouthW: 0.22, mouth: "dot" },
    { eyeSpread: 0.36, eyeY: -0.12, eyeR: 0.14, mouthY: 0.22, mouthW: 0.28, mouth: "oh" },
    { eyeSpread: 0.4, eyeY: -0.1, eyeR: 0.15, mouthY: 0.26, mouthW: 0.3, mouth: "smile" },
];

const BLINK_MS = 3200;

/**
 * Draw a puff centred at (cx, cy) in a `size` cell.
 * opts: { t (ms), lookAt: {x, y} | null, state: "idle"|"held"|"pop", pop (0..1), pulse }
 */
function draw(ctx, puff, cx, cy, size, opts) {
    const pal = PALETTE[puff.color];
    if (!pal) return;
    const face = FACE[puff.color];
    const t = opts.t || 0;
    const state = opts.state || "idle";
    const pop = opts.pop || 0;
    const scale = size * 0.46;

    const breathe = Math.sin(t * 0.002 + puff.phase) * 0.025;
    let rx = scale * (1 + breathe + (opts.pulse || 0) * 0.1);
    let ry = rx;
    if (state === "held") { rx *= 1.1; ry *= 1.1; cy -= scale * 0.04; }
    if (state === "pop") { rx *= 1 + pop * 0.5; ry *= 1 + pop * 0.5; }

    ctx.save();
    ctx.translate(cx, cy);

    // Soft shadow for depth.
    ctx.save();
    ctx.globalAlpha *= 0.28 * (1 - pop);
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(0, ry * 0.85, rx * 0.75, ry * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Fur: an ellipse perimeter rippled by two sine layers of bumps.
    const furAmp = pal.fur * scale * 0.09;
    const segs = Math.max(24, pal.bumps * 3);
    ctx.beginPath();
    for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const jitter = Math.sin(a * pal.bumps + puff.phase) * furAmp
            + Math.sin(a * pal.bumps * 1.7 + puff.phase * 1.3) * furAmp * 0.35;
        const k = 1 + jitter / scale;
        if (i === 0) ctx.moveTo(Math.cos(a) * rx * k, Math.sin(a) * ry * k);
        else ctx.lineTo(Math.cos(a) * rx * k, Math.sin(a) * ry * k);
    }
    ctx.closePath();
    const grad = ctx.createRadialGradient(-rx * 0.25, -ry * 0.35, rx * 0.1, 0, 0, rx * 1.1);
    grad.addColorStop(0, pal.belly);
    grad.addColorStop(0.55, pal.core);
    grad.addColorStop(1, pal.dark);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = pal.outline;
    ctx.stroke();

    // Belly patch so it reads as a creature rather than a coin.
    ctx.beginPath();
    ctx.ellipse(0, ry * 0.25, rx * 0.55, ry * 0.4, 0, 0, Math.PI * 2);
    ctx.fillStyle = withAlpha(pal.belly, 0.65);
    ctx.fill();

    // Eyes (with blink) and mouth.
    const bt = ((t + puff.blink) % BLINK_MS) / BLINK_MS;
    const blink = Math.max(0, bt > 0.95 ? 1 - ((bt - 0.95) / 0.05) * 2 : bt > 0.9 ? ((bt - 0.9) / 0.05) * 2 : 1);
    const ex = rx * face.eyeSpread, ey = ry * face.eyeY, er = scale * face.eyeR;
    drawEye(ctx, -ex, ey, er, blink, opts.lookAt, cx, cy);
    drawEye(ctx, ex, ey, er, blink, opts.lookAt, cx, cy);
    drawMouth(ctx, ry * face.mouthY, rx * face.mouthW, state === "pop" ? "oh" : face.mouth, pal.outline);

    if (puff.locked) drawClamp(ctx, rx, ry, scale);
    drawSpecial(ctx, puff, rx, ry);
    ctx.restore();
}

function drawEye(ctx, ex, ey, er, blink, lookAt, cx, cy) {
    if (blink <= 0.02) {
        ctx.strokeStyle = "#222";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(ex - er, ey);
        ctx.lineTo(ex + er, ey);
        ctx.stroke();
        return;
    }
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.ellipse(ex, ey, er, er * blink, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Pupil leans toward the pointer (lookAt is in the same px space as cx, cy).
    let dx = 0, dy = 0;
    if (lookAt) {
        dx = lookAt.x - (cx + ex);
        dy = lookAt.y - (cy + ey);
        const len = Math.hypot(dx, dy);
        if (len > 0.0001) {
            const k = (er * 0.45 * Math.min(1, len / 40)) / len;
            dx *= k;
            dy *= k * blink;
        }
    }
    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.ellipse(ex + dx, ey + dy, er * 0.55, er * 0.55 * blink, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(ex + dx - er * 0.18, ey + dy - er * 0.25 * blink, er * 0.18, 0, Math.PI * 2);
    ctx.fill();
}

function drawMouth(ctx, y, w, kind, color) {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.6;
    ctx.lineCap = "round";
    ctx.beginPath();
    if (kind === "smile") {
        ctx.arc(0, y - w * 0.2, w * 0.6, Math.PI * 0.15, Math.PI * 0.85);
        ctx.stroke();
    } else if (kind === "grin") {
        ctx.moveTo(-w * 0.5, y);
        ctx.quadraticCurveTo(0, y + w * 0.45, w * 0.5, y);
        ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.fillRect(-w * 0.1, y + w * 0.05, w * 0.2, w * 0.18);
    } else if (kind === "dot") {
        ctx.arc(0, y, w * 0.15, 0, Math.PI * 2);
        ctx.fill();
    } else {
        ctx.ellipse(0, y, w * 0.22, w * 0.3, 0, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.lineCap = "butt";
}

/** Locked: two clamp crescents and a screw head. */
function drawClamp(ctx, rx, ry, scale) {
    ctx.strokeStyle = "rgba(180, 220, 255, 0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, -ry * 0.05, rx * 0.9, -Math.PI * 0.75, -Math.PI * 0.25);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -ry * 0.05, rx * 0.9, Math.PI * 0.25, Math.PI * 0.75);
    ctx.stroke();
    ctx.fillStyle = "rgba(220, 240, 255, 0.85)";
    ctx.beginPath();
    ctx.arc(rx * 0.85, -ry * 0.05, scale * 0.08, 0, Math.PI * 2);
    ctx.fill();
}

/** Jumbo: sparkle plus · Arrow: double-headed arrow on its axis · Prism: rainbow diamond. */
function drawSpecial(ctx, puff, rx, ry) {
    if (puff.special === 1) {
        ctx.strokeStyle = "rgba(255, 255, 220, 0.9)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-rx * 0.25, 0); ctx.lineTo(rx * 0.25, 0);
        ctx.moveTo(0, -ry * 0.25); ctx.lineTo(0, ry * 0.25);
        ctx.stroke();
    } else if (puff.special === 2) {
        ctx.save();
        if (puff.arrowDir !== "h") ctx.rotate(Math.PI / 2);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
        ctx.lineWidth = 2.4;
        const a = rx * 0.55, b = rx * 0.35, h = rx * 0.15;
        ctx.beginPath();
        ctx.moveTo(-a, 0); ctx.lineTo(a, 0);
        ctx.moveTo(-a, 0); ctx.lineTo(-b, -h);
        ctx.moveTo(-a, 0); ctx.lineTo(-b, h);
        ctx.moveTo(a, 0); ctx.lineTo(b, -h);
        ctx.moveTo(a, 0); ctx.lineTo(b, h);
        ctx.stroke();
        ctx.restore();
    } else if (puff.special === 3) {
        ctx.beginPath();
        ctx.moveTo(0, -ry * 0.32);
        ctx.lineTo(rx * 0.32, 0);
        ctx.lineTo(0, ry * 0.32);
        ctx.lineTo(-rx * 0.32, 0);
        ctx.closePath();
        const g = ctx.createLinearGradient(-rx * 0.3, -ry * 0.3, rx * 0.3, ry * 0.3);
        g.addColorStop(0, "#ff8bd4");
        g.addColorStop(0.5, "#ffe27a");
        g.addColorStop(1, "#8be5ff");
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1;
        ctx.stroke();
    }
}

function withAlpha(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return "rgba(" + (n >> 16) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
}

export const Puffs = { PALETTE, FACE, draw };
