// crosshair.js — screen-center reticle overlay.
//
// A drop-in replacement for the old engine-level `bro.crosshair`. A crosshair is
// an app concern, not a runtime primitive, so it lives here as a small JS module
// instead of a C++ overlay: it draws to a fixed, full-viewport <canvas> that
// composites above app content (WebGL, scene, canvas, HTML) via normal DOM order.
//
//   import { crosshair } from "/lib/crosshair.js";
//   crosshair.configure({ style: "crossdot", size: 12, spread: 3, color: "#00ff00" });
//   crosshair.show();
//   // per frame: crosshair.setMoving(moving); crosshair.setAds(aiming);
//   // on fire:   crosshair.addBloom();
//   // bullets:   const spread = crosshair.currentSpread;
//
// The spread system matches the original: the arm gap represents bullet spread,
// interpolated toward (aiming ? adsSpread : spread) + (moving ? moveSpread : 0)
// + bloom, with bloom decaying automatically. Apps just set flags.

const TAU = 6.283185307179586;

// Parse '#RGB', '#RRGGBB', or '#RRGGBBAA' into {r,g,b,a} (0–255).
function parseHex(hex) {
    let s = String(hex).trim().replace(/^#/, "");
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    if (s.length === 6) s += "ff";
    const n = parseInt(s, 16);
    return {
        r: (n >>> 24) & 0xff,
        g: (n >>> 16) & 0xff,
        b: (n >>> 8) & 0xff,
        a: n & 0xff,
    };
}

function rgba(c) {
    return `rgba(${c.r},${c.g},${c.b},${(c.a / 255).toFixed(4)})`;
}

export class Crosshair {
    constructor() {
        // Visual
        this.visible = false;
        this.style = "cross";          // 'cross' | 'dot' | 'circle' | 'crossdot'
        this.size = 20;                // arm length from center
        this.thickness = 2;
        this.dotSize = 2;
        this.outline = true;
        this.outlineThickness = 1;
        this.color = { r: 0, g: 255, b: 0, a: 204 };       // #00ff00 @ 0.8
        this.outlineColor = { r: 0, g: 0, b: 0, a: 180 };  // #000000b4

        // Spread system
        this.spread = 4;
        this.moveSpread = 0;
        this.fireBloom = 0;
        this.adsSpread = -1;           // -1 = no ADS override
        this.bloomDecay = 40;          // px/sec
        this.lerpSpeed = 10;

        // State (self-managed, readable by the app)
        this.moving = false;
        this.aiming = false;
        this.currentBloom = 0;
        this.currentSpread = 4;
        this.manualSpread = -1;        // >= 0 overrides the spread system

        this._canvas = null;
        this._ctx = null;
        this._dpr = 1;
        this._cssW = 0;
        this._cssH = 0;
        this._raf = 0;
        this._lastMs = 0;
        this._onResize = () => this._resize();
    }

    // ── Configuration ────────────────────────────────────────────────────────
    configure(opts = {}) {
        const o = opts;
        if (o.style !== undefined) this.style = o.style;
        if (o.size !== undefined) this.size = o.size;
        if (o.thickness !== undefined) this.thickness = o.thickness;
        if (o.dotSize !== undefined) this.dotSize = o.dotSize;
        if (o.outline !== undefined) this.outline = !!o.outline;
        if (o.outlineThickness !== undefined) this.outlineThickness = o.outlineThickness;
        if (o.color !== undefined) this.color = parseHex(o.color);
        if (o.opacity !== undefined) this.color.a = Math.round(Math.max(0, Math.min(1, o.opacity)) * 255);
        if (o.outlineColor !== undefined) this.outlineColor = parseHex(o.outlineColor);

        // `gap` is a backward-compat alias for `spread`.
        if (o.spread !== undefined) { this.spread = o.spread; this.currentSpread = o.spread; }
        if (o.gap !== undefined) { this.spread = o.gap; this.currentSpread = o.gap; }
        if (o.moveSpread !== undefined) this.moveSpread = o.moveSpread;
        if (o.fireBloom !== undefined) this.fireBloom = o.fireBloom;
        if (o.adsSpread !== undefined) this.adsSpread = o.adsSpread;
        if (o.bloomDecay !== undefined) this.bloomDecay = o.bloomDecay;
        if (o.lerpSpeed !== undefined) this.lerpSpeed = o.lerpSpeed;
        // Reflect config changes immediately (static crosshairs never tick).
        if (this.visible && this._ctx) this._draw();
        return this;
    }

    // ── Show / Hide ──────────────────────────────────────────────────────────
    show() {
        this.visible = true;
        this._ensureCanvas();
        this._canvas.style.display = "block";
        this._draw();                       // show immediately, before the first rAF
        if (!this._raf) {
            this._lastMs = 0;
            this._raf = requestAnimationFrame((t) => this._loop(t));
        }
        return this;
    }

    hide() {
        this.visible = false;
        if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
        if (this._canvas) {
            this._canvas.style.display = "none";
            const ctx = this._ctx;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
        }
        return this;
    }

    // ── Spread system ────────────────────────────────────────────────────────
    setMoving(v) { this.moving = !!v; return this; }
    setAds(v) { this.aiming = !!v; return this; }

    addBloom(amount) {
        this.currentBloom += (amount === undefined ? this.fireBloom : amount);
        return this;
    }

    setSpread(v) { this.manualSpread = v; return this; }     // exact override
    autoSpread() { this.manualSpread = -1; return this; }    // back to auto

    // ── Internals ────────────────────────────────────────────────────────────
    _tick(dtSec) {
        if (dtSec <= 0) return;
        if (this.manualSpread >= 0) {
            this.currentSpread = this.manualSpread;
            this.currentBloom = Math.max(0, this.currentBloom - this.bloomDecay * dtSec);
            return;
        }
        let target = (this.aiming && this.adsSpread >= 0) ? this.adsSpread : this.spread;
        if (this.moving) target += this.moveSpread;
        target += this.currentBloom;
        this.currentBloom = Math.max(0, this.currentBloom - this.bloomDecay * dtSec);
        const alpha = 1 - Math.exp(-this.lerpSpeed * dtSec);
        this.currentSpread += (target - this.currentSpread) * alpha;
    }

    _ensureCanvas() {
        if (this._canvas) return;
        const c = document.createElement("canvas");
        c.style.position = "fixed";
        c.style.left = "0";
        c.style.top = "0";
        c.style.width = "100%";
        c.style.height = "100%";
        c.style.pointerEvents = "none";
        c.style.zIndex = "2147483646"; // above app content, below native system panels
        document.body.appendChild(c);
        this._canvas = c;
        this._ctx = c.getContext("2d");
        this._resize();
        window.addEventListener("resize", this._onResize);
    }

    _resize() {
        const dpr = window.devicePixelRatio || 1;
        this._dpr = dpr;
        this._cssW = window.innerWidth;
        this._cssH = window.innerHeight;
        this._canvas.width = Math.max(1, Math.round(this._cssW * dpr));
        this._canvas.height = Math.max(1, Math.round(this._cssH * dpr));
    }

    _loop(tMs) {
        if (!this.visible) { this._raf = 0; return; }
        const dt = this._lastMs ? (tMs - this._lastMs) / 1000 : 0;
        this._lastMs = tMs;
        this._tick(dt);
        this._draw();
        this._raf = requestAnimationFrame((t) => this._loop(t));
    }

    _draw() {
        const ctx = this._ctx;
        ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
        ctx.clearRect(0, 0, this._cssW, this._cssH);
        if (!this.visible) return;

        const cx = this._cssW / 2, cy = this._cssH / 2;
        const ht = this.thickness / 2;
        const ot = this.outline ? this.outlineThickness : 0;
        const spread = this.currentSpread;
        const size = this.size, thick = this.thickness;

        const hasCross = this.style === "cross" || this.style === "crossdot";
        const hasDot = this.style === "dot" || this.style === "crossdot";
        const hasCircle = this.style === "circle";

        const arms = (e, fillStyle) => {
            ctx.fillStyle = fillStyle;
            // right, left, bottom, top — same geometry as the engine overlay.
            ctx.fillRect(cx + spread - e, cy - ht - e, size - spread + 2 * e, thick + 2 * e);
            ctx.fillRect(cx - size - e, cy - ht - e, size - spread + 2 * e, thick + 2 * e);
            ctx.fillRect(cx - ht - e, cy + spread - e, thick + 2 * e, size - spread + 2 * e);
            ctx.fillRect(cx - ht - e, cy - size - e, thick + 2 * e, size - spread + 2 * e);
        };
        const dot = (radius, fillStyle) => {
            ctx.fillStyle = fillStyle;
            ctx.beginPath();
            ctx.arc(cx, cy, Math.max(0, radius), 0, TAU);
            ctx.fill();
        };
        const ring = (strokeWidth, strokeStyle) => {
            ctx.strokeStyle = strokeStyle;
            ctx.lineWidth = strokeWidth;
            ctx.beginPath();
            ctx.arc(cx, cy, size, 0, TAU);
            ctx.stroke();
        };

        const fill = rgba(this.color);
        const out = rgba(this.outlineColor);

        if (this.outline) {
            if (hasCross) arms(ot, out);
            if (hasDot) dot(this.dotSize + ot, out);
            if (hasCircle) ring(thick + 2 * ot, out);
        }
        if (hasCross) arms(0, fill);
        if (hasDot) dot(this.dotSize, fill);
        if (hasCircle) ring(thick, fill);
    }
}

// Shared default instance — the drop-in for the old `bro.crosshair`.
export const crosshair = new Crosshair();
export default crosshair;
