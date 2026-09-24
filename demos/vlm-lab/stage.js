// VLM Lab — the image stage: procedural sample scenes, opening / dropping an
// image, the grounding overlay, and parsing boxes out of a model reply.
//
// The image canvas is a fixed 640×480; an opened image is letterboxed into
// it, so the pixels the model sees are exactly the pixels on screen and a
// box in the model's 0..1000 frame maps straight onto the overlay.

import { appPath } from "/lib/kit/ml.js";

export const STAGE_W = 640, STAGE_H = 480;
const BOX_COLORS = ['#38bdf8', '#f59e0b', '#34d399', '#f472b6', '#a78bfa', '#fb7185', '#facc15', '#60a5fa'];

/** Procedural scenes (no files needed): name -> draw(ctx, w, h). */
export const SAMPLES = {
    scenery: {
        label: 'Mountain scene',
        draw(ctx, w, h) {
            const sky = ctx.createLinearGradient(0, 0, 0, h * 0.7);
            sky.addColorStop(0, '#1d3557'); sky.addColorStop(1, '#a8dadc');
            ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = '#ffb703';
            ctx.beginPath(); ctx.arc(w * 0.8, h * 0.25, 40, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#457b9d';
            ctx.beginPath(); ctx.moveTo(w * 0.1, h * 0.75); ctx.lineTo(w * 0.35, h * 0.3); ctx.lineTo(w * 0.6, h * 0.75); ctx.fill();
            ctx.fillStyle = '#2b2d42';
            ctx.beginPath(); ctx.moveTo(w * 0.4, h * 0.8); ctx.lineTo(w * 0.65, h * 0.2); ctx.lineTo(w * 0.95, h * 0.8); ctx.fill();
            ctx.fillStyle = '#2a9d8f'; ctx.fillRect(0, h * 0.7, w, h * 0.3);
        },
    },
    room: {
        label: 'Interior studio',
        draw(ctx, w, h) {
            ctx.fillStyle = '#3d405b'; ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = '#f4f1de'; ctx.fillRect(w * 0.1, h * 0.1, w * 0.8, h * 0.5);
            ctx.fillStyle = '#81b29a'; ctx.fillRect(w * 0.6, h * 0.15, w * 0.25, h * 0.35);
            ctx.strokeStyle = '#f4f1de'; ctx.lineWidth = 4;
            ctx.beginPath(); ctx.moveTo(w * 0.725, h * 0.15); ctx.lineTo(w * 0.725, h * 0.5); ctx.stroke();
            ctx.fillStyle = '#e07a5f'; ctx.fillRect(w * 0.2, h * 0.6, w * 0.6, h * 0.08);
            ctx.fillRect(w * 0.24, h * 0.68, w * 0.04, h * 0.25); ctx.fillRect(w * 0.72, h * 0.68, w * 0.04, h * 0.25);
        },
    },
    objects: {
        label: 'Workshop desk',
        draw(ctx, w, h) {
            ctx.fillStyle = '#1e1e24'; ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = '#6b4f3a'; ctx.fillRect(0, h * 0.72, w, h * 0.28);
            ctx.fillStyle = '#929084'; ctx.fillRect(w * 0.3, h * 0.35, w * 0.4, h * 0.3);
            ctx.fillStyle = '#1b263b'; ctx.fillRect(w * 0.32, h * 0.38, w * 0.36, h * 0.24);
            ctx.fillStyle = '#b0ad9f'; ctx.fillRect(w * 0.25, h * 0.65, w * 0.5, h * 0.06);
            ctx.fillStyle = '#f7567c';
            ctx.beginPath(); ctx.arc(w * 0.83, h * 0.66, 30, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#ffd166'; ctx.fillRect(w * 0.08, h * 0.55, w * 0.1, h * 0.16);
        },
    },
};

/**
 * The stage over two stacked canvases. Handle: sample(name), openPath(path),
 * openFile(file) -> Promise, image() -> ImageData the model gets, boxes(list),
 * clearBoxes(), label (what is shown), version (bumps on every new image).
 */
export function imageStage(imageCanvas, overlayCanvas, opts) {
    const o = opts || {};
    for (const c of [imageCanvas, overlayCanvas]) { c.width = STAGE_W; c.height = STAGE_H; }
    const ctx = imageCanvas.getContext('2d'), octx = overlayCanvas.getContext('2d');
    const api = { label: '', version: 0, shown: [] };

    function changed(label) {
        api.label = label;
        api.version++;
        api.clearBoxes();
        if (o.onChange) o.onChange(label);
    }

    // Letterbox any drawable (Image, canvas, ImageBitmap) into the stage.
    function drawFit(src, w, h, label) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, STAGE_W, STAGE_H);
        const s = Math.min(STAGE_W / w, STAGE_H / h), dw = w * s, dh = h * s;
        ctx.drawImage(src, (STAGE_W - dw) / 2, (STAGE_H - dh) / 2, dw, dh);
        changed(label);
    }

    api.sample = (name) => {
        const s = SAMPLES[name];
        if (!s) throw new Error('no sample ' + name);
        ctx.clearRect(0, 0, STAGE_W, STAGE_H);
        s.draw(ctx, STAGE_W, STAGE_H);
        changed('sample: ' + s.label);
    };

    api.openPath = (path) => {
        const img = new Image();
        img.src = appPath(path);
        if (!img.naturalWidth) throw new Error('could not decode image: ' + path);
        drawFit(img, img.naturalWidth, img.naturalHeight, path.replace(/^.*[\\/]/, ''));
    };

    api.openFile = async (file) => {
        const bmp = await createImageBitmap(file);
        drawFit(bmp, bmp.width, bmp.height, file.name || 'dropped image');
    };

    api.image = () => ctx.getImageData(0, 0, STAGE_W, STAGE_H);

    api.boxes = (list) => {
        octx.clearRect(0, 0, STAGE_W, STAGE_H);
        api.shown = list || [];
        octx.font = '12px sans-serif';
        api.shown.forEach((b, i) => {
            const col = BOX_COLORS[i % BOX_COLORS.length];
            const x = b.x1 / 1000 * STAGE_W, y = b.y1 / 1000 * STAGE_H;
            const w = (b.x2 - b.x1) / 1000 * STAGE_W, hh = (b.y2 - b.y1) / 1000 * STAGE_H;
            octx.fillStyle = col + '33'; octx.fillRect(x, y, w, hh);
            octx.strokeStyle = col; octx.lineWidth = 2; octx.strokeRect(x, y, w, hh);
            const tw = octx.measureText(b.label).width + 8;
            const ty = y > 16 ? y - 16 : y;
            octx.fillStyle = col; octx.fillRect(x, ty, tw, 16);
            octx.fillStyle = '#0b0d12'; octx.fillText(b.label, x + 4, ty + 12);
        });
    };
    api.clearBoxes = () => api.boxes([]);
    api.color = (i) => BOX_COLORS[i % BOX_COLORS.length];
    return api;
}

/**
 * Boxes in a reply, in Qwen3-VL's grounding format (a JSON list of
 * { "bbox_2d": [x1, y1, x2, y2], "label": "..." }, coordinates on a
 * 0..1000 grid). Tolerant of prose around the JSON and of a truncated list:
 * every complete object is taken, exact repeats once.
 * Returns [{ label, x1, y1, x2, y2 }].
 */
export function parseBoxes(text) {
    const out = [];
    const re = /\{[^{}]*"bbox_2d"\s*:\s*\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\][^{}]*\}/g;
    let m;
    while ((m = re.exec(String(text || '')))) {
        const lm = /"label"\s*:\s*"([^"]*)"/.exec(m[0]);
        const c = [m[1], m[2], m[3], m[4]].map((v) => Math.max(0, Math.min(1000, +v)));
        if (!(c[2] > c[0] && c[3] > c[1])) continue;
        const label = lm ? lm[1] : 'object';
        if (out.some((b) => b.label === label && b.x1 === c[0] && b.y1 === c[1] && b.x2 === c[2] && b.y2 === c[3])) continue;
        out.push({ label, x1: c[0], y1: c[1], x2: c[2], y2: c[3] });
    }
    return out;
}
