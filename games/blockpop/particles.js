// particles.js — shatter particles, flash overlays, screen shake, toast text.
// Self-contained (no /lib/fx dependency) for the arcade foundation.

export const Particles = (function () {
    var parts = [];
    var flashes = []; // { x, y, w, h, color, timer, life }
    var shakeTimer = 0;
    var shakeMag = 0;

    function spawn(x, y, count, color, opts) {
        opts = opts || {};
        for (var i = 0; i < count; i++) {
            var life = (opts.life || 450) + Math.random() * (opts.lifeVar || 350);
            parts.push({
                x: x, y: y,
                vx: (opts.vx || 0) + (Math.random() - 0.5) * (opts.spread || 5),
                vy: (opts.vy || -1) + (Math.random() - 0.5) * (opts.spreadY || 4),
                life: life, maxLife: life,
                size: (opts.size || 2) + Math.random() * (opts.sizeVar || 3),
                color: color, gravity: opts.gravity != null ? opts.gravity : 0.18
            });
        }
    }

    function flash(x, y, w, h, color, life) {
        flashes.push({ x: x, y: y, w: w, h: h, color: color, timer: life || 250, life: life || 250 });
    }

    function shake(duration, magnitude) {
        shakeTimer = duration || 160;
        shakeMag = magnitude || 3;
    }

    function shakeOffset() {
        if (shakeTimer <= 0) return { x: 0, y: 0 };
        return {
            x: (Math.random() - 0.5) * 2 * shakeMag,
            y: (Math.random() - 0.5) * 2 * shakeMag,
        };
    }

    function toast(sel, text, duration) {
        var el = document.querySelector(sel);
        if (!el) return;
        el.textContent = text;
        el.style.display = "block";
        clearTimeout(el._toastT);
        el._toastT = setTimeout(function () {
            el.style.display = "none";
        }, duration || 900);
    }

    function showAction(text) { toast("#action-text", text, 900); }
    function showCascade(text) { toast("#cascade-text", text, 700); }

    function update(dt) {
        for (var i = parts.length - 1; i >= 0; i--) {
            var p = parts[i];
            p.life -= dt;
            if (p.life <= 0) { parts.splice(i, 1); continue; }
            p.x += p.vx;
            p.y += p.vy;
            p.vy += p.gravity;
        }
        for (var j = flashes.length - 1; j >= 0; j--) {
            flashes[j].timer -= dt;
            if (flashes[j].timer <= 0) flashes.splice(j, 1);
        }
        if (shakeTimer > 0) shakeTimer = Math.max(0, shakeTimer - dt);
    }

    function clear() {
        parts.length = 0;
        flashes.length = 0;
        shakeTimer = 0;
        shakeMag = 0;
    }

    function drawParticles(ctx) {
        for (var i = 0; i < parts.length; i++) {
            var p = parts[i];
            ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
            ctx.fillStyle = p.color;
            ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        }
        ctx.globalAlpha = 1.0;
    }

    function drawFlashes(ctx) {
        for (var i = 0; i < flashes.length; i++) {
            var f = flashes[i];
            ctx.globalAlpha = Math.max(0, f.timer / f.life) * 0.6;
            ctx.fillStyle = f.color;
            ctx.fillRect(f.x, f.y, f.w, f.h);
        }
        ctx.globalAlpha = 1.0;
    }

    return {
        spawn: spawn, flash: flash, shake: shake, shakeOffset: shakeOffset,
        showAction: showAction, showCascade: showCascade,
        update: update, clear: clear,
        drawParticles: drawParticles, drawFlashes: drawFlashes,
        count: function () { return parts.length; }
    };
})();
