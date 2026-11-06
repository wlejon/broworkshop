// The headless page a sheet is drawn on: a 3D scene canvas under a 2D
// overlay, both the size of the sheet, captured whole into a PNG. One page
// is kept for a run; each sheet sizes it and adds what it draws.

export const INK = '#26241f', DIM = '#77736a', FAINT = '#c9c5bc', PAPER = '#ecebe6', CELL = '#e2e0da';
export const FOOT_COLORS = ['#c0392b', '#e67e22', '#2471a3', '#17a589', '#8e44ad', '#7d6608', '#5d6d7e', '#a04000'];
export const SERIES = ['#c0392b', '#2471a3', '#17a589', '#d68910', '#8e44ad', '#5d6d7e', '#a04000', '#1abc9c', '#e84393', '#34495e', '#7d6608', '#0e6655'];

let page = null;

export function getPage() {
    if (page) return page;
    // The live UI (main.js) steps aside for a headless run.
    if (globalThis.creatureLab && globalThis.creatureLab.dispose) globalThis.creatureLab.dispose();
    document.body.className = '';
    document.body.innerHTML = '';
    document.body.style.cssText = `margin:0;overflow:hidden;background:${PAPER}`;
    const view = document.createElement('canvas');
    view.style.cssText = 'position:absolute;left:0;top:0';
    const over = document.createElement('canvas');
    over.style.cssText = 'position:absolute;left:0;top:0';
    document.body.append(view, over);
    page = { view, over, scene: null, nodes: [], W: 0, H: 0 };
    return page;
}

// Size the page for a sheet, clear what the last sheet drew, and hand back
// its scene (when `scene` is wanted) and a cleared 2D context.
export function beginSheet(W, H, { scene = false } = {}) {
    const p = getPage();
    for (const n of p.nodes) { try { n.destroy(); } catch (_) { n.visible = false; } }
    p.nodes = [];
    resize(W, H);
    p.W = W; p.H = H;
    for (const c of [p.view, p.over]) { c.width = W; c.height = H; c.style.width = W + 'px'; c.style.height = H + 'px'; }
    p.view.style.display = scene ? 'block' : 'none';
    if (scene && !p.scene) {
        p.scene = p.view.getContext('scene');
        p.view.style.background = PAPER;
        p.scene.setAmbient({ color: [1, 1, 1], intensity: 0.55 });
        p.key = p.scene.createLight({ type: 'directional', direction: [0.45, -0.75, 0.5], intensity: 2.2, castShadow: false });
    }
    const g = p.over.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    if (!scene) { g.fillStyle = PAPER; g.fillRect(0, 0, W, H); }
    return { page: p, scene: scene ? p.scene : null, g, W, H, add: (n) => { p.nodes.push(n); return n; } };
}

// Capture the page into a PNG at `path` (written by the headless harness).
export function saveSheet(path) {
    advanceTime(16);
    const f = frameImage();
    const px = new Uint8Array(f.data.buffer, f.data.byteOffset, f.data.byteLength);
    const png = bro.image.encodePng(px, f.width, f.height, 4);
    writeFile(path, png);
    return { path, width: f.width, height: f.height, bytes: png.byteLength };
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
