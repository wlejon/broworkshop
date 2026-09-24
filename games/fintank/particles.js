// particles.js — Fintank's juice: rising bubbles, splash drops, hit sparks,
// floating "+coins" labels and a short screen shake. One instance per tank.

import { centeredText, dot } from "/app/paint.js";

const MAX_BUBBLES = 40;

export function createParticles() {
    const items = [];            // { kind: spark | drop | text, x, y, vx, vy, life, age, color, text? }
    const bubbles = [];
    let shakeMs = 0, shakeDur = 1, shakeMag = 0;

    function reset() {
        items.length = 0;
        bubbles.length = 0;
        shakeMs = 0;
    }

    function spark(x, y, color, n = 8) {
        for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2, s = 60 + Math.random() * 120;
            items.push({
                kind: "spark", x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
                life: 0.4 + Math.random() * 0.3, age: 0, color: color || "#ffffff",
            });
        }
    }

    function splash(x, y) {
        for (let i = 0; i < 6; i++) {
            const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.2, s = 100 + Math.random() * 80;
            items.push({
                kind: "drop", x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60,
                life: 0.4, age: 0, color: "#8fd6f0",
            });
        }
    }

    function floatText(x, y, text, color) {
        items.push({ kind: "text", x, y, vx: 0, vy: -30, life: 1.1, age: 0, text: String(text), color: color || "#fff4d8" });
    }

    function shake(mag) {
        shakeMs = shakeDur = 180;
        shakeMag = mag || 6;
    }

    function shakeOffset() {
        if (shakeMs <= 0) return { x: 0, y: 0 };
        const k = (shakeMs / shakeDur) * shakeMag;
        return { x: (Math.random() - 0.5) * k, y: (Math.random() - 0.5) * k };
    }

    /** Advance by ms; bubbles spawn across a view of width W, height H. */
    function update(ms, W, H) {
        const s = ms / 1000;
        for (let i = items.length - 1; i >= 0; i--) {
            const p = items[i];
            p.age += s;
            if (p.age >= p.life) { items.splice(i, 1); continue; }
            p.x += p.vx * s;
            p.y += p.vy * s;
            if (p.kind === "drop") p.vy += 400 * s;
        }
        if (Math.random() < ms / 300 && bubbles.length < MAX_BUBBLES) {
            bubbles.push({
                x: 20 + Math.random() * (W - 40), y: H - 20,
                r: 2 + Math.random() * 4, vy: -(12 + Math.random() * 30),
                wobble: Math.random() * Math.PI * 2,
            });
        }
        for (let j = bubbles.length - 1; j >= 0; j--) {
            const b = bubbles[j];
            b.wobble += s * 3;
            b.x += Math.sin(b.wobble) * 6 * s;
            b.y += b.vy * s;
            if (b.y < 20) bubbles.splice(j, 1);
        }
        if (shakeMs > 0) shakeMs -= ms;
    }

    function draw(ctx) {
        ctx.save();
        ctx.globalAlpha = 0.4;
        ctx.strokeStyle = "#9fe8ff";
        ctx.lineWidth = 1;
        for (const b of bubbles) {
            ctx.beginPath();
            ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
            ctx.stroke();
        }
        for (const p of items) {
            ctx.globalAlpha = Math.max(0, 1 - p.age / p.life);
            if (p.kind === "spark") {
                ctx.fillStyle = p.color;
                ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
            } else if (p.kind === "drop") {
                dot(ctx, p.x, p.y, 2.5, p.color);
            } else {
                centeredText(ctx, p.text, p.x, p.y, p.color);
            }
        }
        ctx.restore();
    }

    return { reset, spark, splash, floatText, shake, shakeOffset, update, draw, count: () => items.length };
}
