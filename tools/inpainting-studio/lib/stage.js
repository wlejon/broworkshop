// stage.js — the four stacked canvases (base, mask overlay, control map,
// result), the view mode that decides which show, fit-to-viewport scaling,
// and reading them out as pixels / PNG files for the pipeline.

import { $ } from "/lib/kit/dom.js";
import { MaskPainter } from "./mask.js";
import { drawScene } from "./scenes.js";
import { maskBits, edgeMap, grayToRgba } from "./pixels.js";

export const VIEWS = { composite: 'Composite', mask: 'Mask only', control: 'Control map', result: 'Result' };

const fs = require('fs');
const os = require('os');

export class Stage {
    constructor(onMaskChange) {
        this.box = $('#stage');
        this.base = $('#baseCanvas');
        this.maskCanvas = $('#maskCanvas');
        this.control = $('#controlCanvas');
        this.result = $('#resultCanvas');
        this.mask = new MaskPainter(this.base, this.maskCanvas, onMaskChange);
        this.view = 'composite';
        this.hasResult = false;
        this.dir = os.tmpdir().replace(/\\/g, '/') + '/bro-inpainting-' + Date.now().toString(36);
        new ResizeObserver(() => this.fit()).observe($('#viewport'));
    }

    get width() { return this.base.width; }
    get height() { return this.base.height; }

    setView(mode) {
        this.view = mode;
        this.base.hidden = mode !== 'composite';
        this.maskCanvas.hidden = !(mode === 'composite' || mode === 'mask');
        this.control.hidden = mode !== 'control';
        this.result.hidden = mode !== 'result';
        $('#result-hint').hidden = !(mode === 'result' && !this.hasResult);
    }

    /** Scale the stage box to fit the viewport, keeping the canvas aspect. */
    fit() {
        const vp = $('#viewport');
        const s = Math.min((vp.clientWidth - 24) / this.width, (vp.clientHeight - 24) / this.height, 1.5);
        if (!(s > 0)) return;
        this.box.style.width = Math.round(this.width * s) + 'px';
        this.box.style.height = Math.round(this.height * s) + 'px';
    }

    /** Size every canvas to w x h (multiples of 8, the latent grid). */
    setSize(w, h) {
        w = Math.max(64, Math.round(w / 8) * 8);
        h = Math.max(64, Math.round(h / 8) * 8);
        this.mask.resize(w, h);
        for (const c of [this.control, this.result]) { c.width = w; c.height = h; }
        this.hasResult = false;
        this.fit();
    }

    loadScene(key) {
        this.setSize(512, 512);
        drawScene(this.base.getContext('2d'), key, 512, 512);
    }

    /** Draw ImageData-like pixels into the base, fitted to 512 on the long side. */
    loadImage(img) {
        const s = 512 / Math.max(img.width, img.height);
        this.setSize(img.width * s, img.height * s);
        const tmp = document.createElement('canvas');
        tmp.width = img.width; tmp.height = img.height;
        tmp.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
        this.base.getContext('2d').drawImage(tmp, 0, 0, this.width, this.height);
    }

    /** Outpaint grow; control / result canvases follow the new size. */
    expand(dx, dy) {
        if (!this.mask.expand(dx, dy)) return false;
        for (const c of [this.control, this.result]) { c.width = this.width; c.height = this.height; }
        this.hasResult = false;
        this.fit();
        return true;
    }

    pixels(canvas) { return (canvas || this.base).getContext('2d').getImageData(0, 0, this.width, this.height); }
    maskBits() { return maskBits(this.pixels(this.maskCanvas)); }

    /** Paint the control canvas: 'none' = black, 'canny' = edges, or grey bytes (depth). */
    drawControl(mode, gray, gw, gh) {
        const ctx = this.control.getContext('2d');
        this.control.width = this.width; this.control.height = this.height;
        if (mode === 'canny') ctx.putImageData(toImageData(edgeMap(this.pixels())), 0, 0);
        else if (gray) {
            const tmp = document.createElement('canvas');
            tmp.width = gw; tmp.height = gh;
            tmp.getContext('2d').putImageData(new ImageData(grayToRgba(gray, gw, gh), gw, gh), 0, 0);
            ctx.drawImage(tmp, 0, 0, this.width, this.height);
        } else {
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, this.width, this.height);
        }
    }

    showResult(bitmap) {
        this.result.width = bitmap.width; this.result.height = bitmap.height;
        this.result.getContext('2d').drawImage(bitmap, 0, 0);
        this.hasResult = true;
    }

    /** Make the result the new base (keep inpainting on top of it). */
    adoptResult() {
        if (!this.hasResult) return false;
        this.base.getContext('2d').drawImage(this.result, 0, 0, this.width, this.height);
        this.mask.clear();
        return true;
    }

    /** Write ImageData-like pixels as a PNG in the scratch dir; returns the path. */
    writePng(name, img) {
        fs.mkdirSync(this.dir, { recursive: true });
        const p = this.dir + '/' + name + '.png';
        if (!bro.image.encodePngFile(p, img.data, img.width, img.height, 4)) throw new Error('could not write ' + p);
        return p;
    }
}

function toImageData(img) { return new ImageData(img.data, img.width, img.height); }
