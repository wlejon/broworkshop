// Arcade — juice for 2D games: particle bursts, floating score labels,
// screen shake and DOM toasts. One instance per game; time is ms.
//
//   import { createEffects } from "/lib/arcade/effects.js";
//   const fx = createEffects({ particle: "shard", label: { glow: true } });
//   fx.burst(x, y, "#ff5a7a", 10);
//   fx.label(x, y, "+150", "#ffc850");            // score popup
//   fx.label(cx, cy, "CHAIN x3", "#ffe070", { big: true });
//   fx.shake(200, 4);
//   fx.toast("#action-text", "NICE!", 1100);
//   // frame: fx.update(dt); const o = fx.shakeOffset(); ... fx.draw(ctx);
//
// Particle look: "shard" (triangles, rim-lit), "tuft" (diamonds),
// "square" (pixels), or a function (ctx, p, alpha) drawing at the origin
// (already translated + rotated to the particle).
// Label look: { glow } draws white text with a colored glow (gems); without
// it the text is filled with its color (puffs, letters).

const DEFAULT_BURST = {
    speed: 90, speedVar: 220, up: 30,
    life: 480, lifeVar: 360,
    size: 2.5, sizeVar: 3,
    gravity: 360, drag: 0.93, spin: 14,
};

export function createEffects(opts = {}) {
    const look = opts.particle || "square";
    const labelOpts = Object.assign({ glow: false, font: "sans-serif", small: 18, big: 30 }, opts.label || {});
    const burstDefaults = Object.assign({}, DEFAULT_BURST, opts.burst || {});

    let parts = [];
    let labels = [];
    let shakeT = 0, shakeDur = 1, shakeAmp = 0;
    const toasts = new Map();   // selector -> ms left

    // ── Particles ──────────────────────────────────────────────────────

    function burst(x, y, color, count, o) {
        const b = o ? Object.assign({}, burstDefaults, o) : burstDefaults;
        const n = count || 10;
        for (let i = 0; i < n; i++) {
            const ang = Math.random() * Math.PI * 2;
            const spd = b.speed + Math.random() * b.speedVar;
            const life = b.life + Math.random() * b.lifeVar;
            parts.push({
                x, y,
                vx: Math.cos(ang) * spd,
                vy: Math.sin(ang) * spd - b.up,
                life, age: 0,
                color,
                size: b.size + Math.random() * b.sizeVar,
                rot: Math.random() * Math.PI * 2,
                spin: (Math.random() - 0.5) * b.spin,
                gravity: b.gravity,
                drag: b.drag,
                rim: (i & 1) === 1,
            });
        }
    }

    function drawParticle(ctx, p, a) {
        const s = p.size;
        if (typeof look === "function") { look(ctx, p, a); return; }
        ctx.fillStyle = p.color;
        if (look === "square") {
            ctx.fillRect(-s / 2, -s / 2, s, s);
            return;
        }
        ctx.beginPath();
        if (look === "shard") {
            ctx.moveTo(0, -s * 1.4);
            ctx.lineTo(s * 0.7, s * 0.6);
            ctx.lineTo(-s * 0.7, s * 0.6);
        } else {    // tuft
            ctx.moveTo(0, -s);
            ctx.lineTo(s, 0);
            ctx.lineTo(0, s);
            ctx.lineTo(-s, 0);
        }
        ctx.closePath();
        ctx.fill();
        if (look === "shard" && p.rim) {
            ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
            ctx.lineWidth = 0.8;
            ctx.stroke();
        }
    }

    // ── Labels ─────────────────────────────────────────────────────────

    function label(x, y, text, color, o) {
        const big = !!(o && o.big);
        labels.push({
            x, y,
            vy: -38 - (big ? 20 : 0),
            life: big ? 1050 : 760,
            age: 0,
            text: String(text),
            color: color || "#ffe9b0",
            big,
        });
    }

    function drawLabel(ctx, L) {
        const t = L.age / L.life;
        const alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
        const scale = L.big
            ? (t < 0.18 ? 0.5 + (t / 0.18) * 0.7 : 1.2 - Math.min(0.2, (t - 0.18) * 0.4))
            : (t < 0.15 ? 0.6 + (t / 0.15) * 0.5 : 1.1);
        ctx.save();
        ctx.translate(L.x, L.y);
        ctx.scale(scale, scale);
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "bold " + (L.big ? labelOpts.big : labelOpts.small) + "px " + labelOpts.font;
        ctx.lineWidth = L.big ? 4 : 3;
        ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
        ctx.strokeText(L.text, 0, 0);
        if (labelOpts.glow) {
            ctx.shadowColor = L.color;
            ctx.shadowBlur = L.big ? 14 : 8;
            ctx.fillStyle = "#ffffff";
        } else {
            ctx.fillStyle = L.color;
        }
        ctx.fillText(L.text, 0, 0);
        ctx.restore();
    }

    // ── Shake + toasts ─────────────────────────────────────────────────

    /** Shake for `ms`, peak offset `amp` px, easing out linearly. */
    function shake(ms, amp) {
        if (amp >= shakeAmp * (shakeT / shakeDur)) {
            shakeT = ms;
            shakeDur = ms || 1;
            shakeAmp = amp;
        }
    }

    function shakeOffset() {
        if (shakeT <= 0) return { x: 0, y: 0 };
        const m = (shakeT / shakeDur) * shakeAmp;
        return { x: (Math.random() - 0.5) * m, y: (Math.random() - 0.5) * m };
    }

    /** Show `text` in the element matching selector for `ms`, then hide it. */
    function toast(selector, text, ms) {
        const el = document.querySelector(selector);
        if (!el) return;
        el.textContent = text;
        el.style.display = "block";
        toasts.set(selector, ms || 1000);
    }

    function hideToast(selector) {
        const el = document.querySelector(selector);
        if (el) el.style.display = "none";
        toasts.delete(selector);
    }

    // ── Frame ──────────────────────────────────────────────────────────

    function update(dt) {
        const s = dt / 1000;
        const kept = [];
        for (const p of parts) {
            p.age += dt;
            if (p.age >= p.life) continue;
            p.vy += p.gravity * s;
            const d = Math.pow(p.drag, dt / 16);
            p.vx *= d;
            p.x += p.vx * s;
            p.y += p.vy * s;
            p.rot += p.spin * s;
            kept.push(p);
        }
        parts = kept;

        const keptL = [];
        for (const L of labels) {
            L.age += dt;
            if (L.age >= L.life) continue;
            L.y += L.vy * s;
            L.vy *= Math.pow(0.94, dt / 16);
            keptL.push(L);
        }
        labels = keptL;

        if (shakeT > 0) shakeT = Math.max(0, shakeT - dt);
        for (const [sel, left] of toasts) {
            if (left - dt <= 0) hideToast(sel);
            else toasts.set(sel, left - dt);
        }
    }

    /** Particles, then labels on top. */
    function draw(ctx) {
        for (const p of parts) {
            const a = Math.max(0, 1 - p.age / p.life);
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.globalAlpha = a;
            drawParticle(ctx, p, a);
            ctx.restore();
        }
        for (const L of labels) drawLabel(ctx, L);
        ctx.globalAlpha = 1;
    }

    function clear() {
        parts = [];
        labels = [];
        shakeT = 0;
        for (const sel of Array.from(toasts.keys())) hideToast(sel);
    }

    return {
        burst, label, shake, shakeOffset, toast, update, draw, clear,
        count: () => parts.length + labels.length,
        labels: () => labels.map((L) => L.text),
    };
}
