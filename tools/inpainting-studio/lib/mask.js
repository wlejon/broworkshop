// mask.js — the painted mask over the base image: brush / eraser with size
// and hardness, invert / clear / fill, and outpaint expansion (grows the base
// and mask canvases, masking the new border).

import { trackDrag } from "/lib/kit/dom.js";
import { MASK_ALPHA } from "./pixels.js";

const PAINT = 'rgba(247, 37, 133, 0.85)';
export const MAX_SIDE = 1024;

export class MaskPainter {
    /** base, mask: same-size canvases stacked; onChange() after every edit. */
    constructor(base, mask, onChange) {
        this.base = base;
        this.mask = mask;
        this.bctx = base.getContext('2d');
        this.mctx = mask.getContext('2d');
        this.onChange = onChange || (() => {});
        this.tool = 'brush';           // brush | eraser
        this.size = 32;
        this.hardness = 0.8;
        mask.addEventListener('mousedown', (e) => this.begin(e));
    }

    get width() { return this.base.width; }
    get height() { return this.base.height; }

    /** Canvas pixel under a mouse event (the stage may be scaled). */
    toCanvas(e) {
        const r = this.mask.getBoundingClientRect();
        return { x: (e.clientX - r.left) * this.mask.width / r.width, y: (e.clientY - r.top) * this.mask.height / r.height };
    }

    begin(e) {
        if (e.button !== 0) return;
        e.preventDefault();
        let last = this.toCanvas(e);
        this.dab(last.x, last.y);
        trackDrag((ev) => {
            const p = this.toCanvas(ev);
            this.line(last.x, last.y, p.x, p.y);
            last = p;
        }, () => this.onChange());
    }

    dab(x, y) {
        const c = this.mctx, rad = this.size * 0.5;
        c.save();
        c.beginPath();
        c.arc(x, y, rad, 0, Math.PI * 2);
        if (this.tool === 'eraser') {
            c.globalCompositeOperation = 'destination-out';
            c.fillStyle = '#000';
        } else {
            // Hard core out to `hardness` of the radius, feathered beyond it.
            const g = c.createRadialGradient(x, y, rad * this.hardness * 0.8, x, y, rad);
            g.addColorStop(0, PAINT);
            g.addColorStop(1, 'rgba(247, 37, 133, 0)');
            c.fillStyle = g;
        }
        c.fill();
        c.restore();
    }

    line(x1, y1, x2, y2) {
        const step = Math.max(1, this.size * 0.2);
        const n = Math.ceil(Math.hypot(x2 - x1, y2 - y1) / step);
        for (let i = 1; i <= n; i++) this.dab(x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n);
    }

    clear() { this.mctx.clearRect(0, 0, this.width, this.height); this.onChange(); }

    fill() {
        this.mctx.fillStyle = PAINT;
        this.mctx.fillRect(0, 0, this.width, this.height);
        this.onChange();
    }

    invert() {
        const img = this.mctx.getImageData(0, 0, this.width, this.height), d = img.data;
        for (let i = 0; i < d.length; i += 4) {
            const on = d[i + 3] > MASK_ALPHA;
            d[i] = 247; d[i + 1] = 37; d[i + 2] = 133; d[i + 3] = on ? 0 : 217;
        }
        this.mctx.putImageData(img, 0, 0);
        this.onChange();
    }

    /** Resize both canvases to w x h (a scene or an upload), clearing the mask. */
    resize(w, h) {
        for (const c of [this.base, this.mask]) { c.width = w; c.height = h; }
    }

    /**
     * Outpaint: grow by |dx| / |dy| on that side (negative = left / top), up
     * to MAX_SIDE. The new border is masked; the old mask is kept.
     * Returns false when already at the limit.
     */
    expand(dx, dy) {
        const ow = this.width, oh = this.height;
        const nw = Math.min(MAX_SIDE, ow + Math.abs(dx)), nh = Math.min(MAX_SIDE, oh + Math.abs(dy));
        if (nw === ow && nh === oh) return false;
        const ox = dx < 0 ? nw - ow : 0, oy = dy < 0 ? nh - oh : 0;
        const oldBase = this.bctx.getImageData(0, 0, ow, oh), oldMask = this.mctx.getImageData(0, 0, ow, oh);
        this.resize(nw, nh);
        this.bctx.fillStyle = '#101216';
        this.bctx.fillRect(0, 0, nw, nh);
        this.bctx.putImageData(oldBase, ox, oy);
        this.mctx.fillStyle = PAINT;
        this.mctx.fillRect(0, 0, nw, nh);
        this.mctx.clearRect(ox, oy, ow, oh);
        this.mctx.putImageData(oldMask, ox, oy);
        this.onChange();
        return true;
    }
}
