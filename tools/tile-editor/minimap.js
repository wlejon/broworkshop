// minimap.js — ground ids rasterized at one pixel per cell, scaled up
// pixelated into the corner widget. A click jumps the camera to that cell
// (through cellCenterWorldXZ, so hex maps work the same).

import { MINIMAP_COLORS } from "./atlas.js";

/** opts: { onJump(worldX, worldZ) }. Returns { redraw() }. */
export function createMinimap(canvas, map, opts) {
    const o = opts || {};
    const ctx = canvas.getContext('2d');
    const source = document.createElement('canvas');

    function redraw() {
        const { width: w, height: h } = map.config;
        source.width = w; source.height = h;
        const sctx = source.getContext('2d');
        const img = sctx.createImageData(w, h);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const col = MINIMAP_COLORS[map.tileAt(x, y, 0)] || MINIMAP_COLORS[0];
                const i = (y * w + x) * 4;
                img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = 255;
            }
        }
        sctx.putImageData(img, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    }

    canvas.addEventListener('click', (e) => {
        const r = canvas.getBoundingClientRect();
        const { width: w, height: h } = map.config;
        const cx = Math.max(0, Math.min(w - 1, Math.floor((e.clientX - r.left) / r.width * w)));
        const cy = Math.max(0, Math.min(h - 1, Math.floor((e.clientY - r.top) / r.height * h)));
        const c = map.world.cellCenterWorldXZ(cx, cy);
        if (c && o.onJump) o.onJump(c.x, c.z, cx, cy);
    });

    redraw();
    return { redraw };
}
