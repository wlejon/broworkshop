// What a sheet is drawn on: a 3D scene under a 2D overlay, both the size of
// the sheet, composited in memory over the paper (scene.captureFrame renders
// the scene on its own), so a sheet is made the same way in a window and
// headless and the page around it is left alone. One page is kept for a
// run; each sheet sizes it and adds what it draws.

export const INK = '#26241f', DIM = '#77736a', FAINT = '#c9c5bc', PAPER = '#ecebe6', CELL = '#e2e0da';
export const FOOT_COLORS = ['#c0392b', '#e67e22', '#2471a3', '#17a589', '#8e44ad', '#7d6608', '#5d6d7e', '#a04000'];
export const SERIES = ['#c0392b', '#2471a3', '#17a589', '#d68910', '#8e44ad', '#5d6d7e', '#a04000', '#1abc9c', '#e84393', '#34495e', '#7d6608', '#0e6655'];

let page = null;

export function getPage() {
    if (page) return page;
    const view = document.createElement('canvas');
    const over = document.createElement('canvas');
    const out = document.createElement('canvas');
    page = { view, over, out, scene: null, nodes: [], W: 0, H: 0 };
    return page;
}

// Size the page for a sheet, clear what the last sheet drew, and hand back
// its scene (when `scene` is wanted) and a cleared 2D context.
export function beginSheet(W, H, { scene = false } = {}) {
    const p = getPage();
    for (const n of p.nodes) { try { n.destroy(); } catch (_) { n.visible = false; } }
    p.nodes = [];
    p.W = W; p.H = H;
    for (const c of [p.view, p.over, p.out]) { c.width = W; c.height = H; }
    p.drawScene = scene;
    if (scene && !p.scene) {
        p.scene = p.view.getContext('scene');
        // Its canvas is never in the document, which reclaims a scene at the
        // next frame; kept alive it is parked instead, and captureFrame
        // renders it all the same.
        p.scene.keepAlive = true;
        p.scene.setAmbient({ color: [1, 1, 1], intensity: 0.55 });
        p.key = p.scene.createLight({ type: 'directional', direction: [0.45, -0.75, 0.5], intensity: 2.2, castShadow: false });
    }
    const g = p.over.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    return { page: p, scene: scene ? p.scene : null, g, W, H, add: (n) => { p.nodes.push(n); return n; } };
}

// The sheet as drawn: the paper, the scene over it, the overlay over both,
// in `page.out` (a canvas the live view can show). Its pixels and PNG are
// returned; with `path`, the PNG is also written there.
export function saveSheet(path = null) {
    const p = getPage();
    const g = p.out.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = PAPER;
    g.fillRect(0, 0, p.W, p.H);
    if (p.drawScene) {
        const f = p.scene.captureFrame(p.W, p.H);
        if (!f) throw new Error('creature-lab: the sheet scene rendered nothing');
        const tmp = document.createElement('canvas');
        tmp.width = f.width; tmp.height = f.height;
        tmp.getContext('2d').putImageData(f instanceof ImageData ? f : new ImageData(f.data, f.width, f.height), 0, 0);
        g.drawImage(tmp, 0, 0);
    }
    g.drawImage(p.over, 0, 0);
    const img = g.getImageData(0, 0, p.W, p.H);
    const px = new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength);
    const png = bro.image.encodePng(px, p.W, p.H, 4);
    if (path) writeSheetFile(path, png);
    return { path, width: p.W, height: p.H, bytes: png.byteLength, png, canvas: p.out };
}

// The harness's writeFile where there is one (headless, or a window's
// self-test globals); else fs, under the app's files permission.
function writeSheetFile(path, bytes) {
    if (typeof writeFile === 'function') return writeFile(path, bytes);
    const fs = require('fs');
    fs.mkdirSync(path.replace(/[\\/][^\\/]*$/, ''), { recursive: true });
    fs.writeFileSync(path, bytes);
}

// --- 2D drawing ---------------------------------------------------------------

export function text(g, s, x, y, { color = INK, size = 13, weight = 500, align = 'left', base = 'alphabetic' } = {}) {
    g.font = `${weight} ${size}px system-ui`;
    g.fillStyle = color;
    g.textAlign = align;
    g.textBaseline = base;
    g.fillText(s, x, y);
}

export function line(g, x0, y0, x1, y1, color = INK, width = 1, dash = null) {
    g.strokeStyle = color;
    g.lineWidth = width;
    g.setLineDash(dash || []);
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
    g.setLineDash([]);
}

export function poly(g, pts, color = INK, width = 1.5, dash = null) {
    if (pts.length < 2) return;
    g.strokeStyle = color;
    g.lineWidth = width;
    g.setLineDash(dash || []);
    g.beginPath();
    let pen = false;
    for (const p of pts) {
        if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) { pen = false; continue; }
        if (!pen) { g.moveTo(p[0], p[1]); pen = true; } else g.lineTo(p[0], p[1]);
    }
    g.stroke();
    g.setLineDash([]);
}

export function dot(g, x, y, r, fill, stroke = null) {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1.2; g.stroke(); }
}

export function rect(g, x, y, w, h, fill, stroke = null) {
    if (fill) { g.fillStyle = fill; g.fillRect(x, y, w, h); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); }
}

// A panel frame with a title; returns the inner box.
export function panel(g, x, y, w, h, title) {
    rect(g, x, y, w, h, '#f6f5f2', FAINT);
    if (title) text(g, title, x + 8, y + 17, { size: 13, weight: 650 });
    return { x: x + 8, y: y + (title ? 26 : 8), w: w - 16, h: h - (title ? 34 : 16) };
}

// Nice round tick steps for a range.
export function ticks(lo, hi, n = 5) {
    const span = Math.max(1e-9, hi - lo), raw = span / n;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
}
