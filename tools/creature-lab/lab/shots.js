// Hard lines read off an image of the creature, as a viewer would see them:
// the skin hook's debug views (lab/skin.bk: `normal`, `depth`, `piece`) of a
// posed creature from one camera, and per pixel of the body
//   seam   the next pixel (2 px on) is another piece, at the same depth: two
//          pieces' surfaces meeting in view, not one in front of the other
//   crease the same piece, the same depth, but the surface turns by more
//          than CREASE degrees between the two: a fold or a kink in the skin
//   kink   the silhouette turning by more than KINK degrees within a few
//          pixels where it bends inward (a notch; tips that point outward,
//          an ear's or a hoof's, are not counted, nor a notch whose two
//          sides lie at depths OCCLUSION apart: one part in front of another)
// Each is put to a site with the keys lab/seams.js gives (cross A x B,
// crease <piece> over <bone>, kink <piece> over <bone>) by the nearest
// vertex on screen at that depth, and measured as the length it draws in
// centimetres at the pixel's distance, weighted by its angle over 90.

import { capture, project } from "./lit.js";
import { seamTopology } from "./seams.js";

export const SHOT = {
    step: 2,           // px: the neighbour compared
    sameDepth: 0.03,   // m: closer than this is the same surface
    crease: 20,        // degrees between neighbours' normals within a piece
    seamMin: 8,        // degrees: a seam drawn by two pieces turning less is not seen
    kink: 50,          // degrees of turn at the silhouette within KINK_SPAN px
    kinkSpan: 5,
    occlusion: 0.08,   // m: a notch whose sides lie farther apart in depth is one part in front of another
};

const DEG = 180 / Math.PI;
const toByte = (img) => img.data;

// The three debug captures decoded: per pixel the piece (-1 off the body),
// the distance from the eye (m) and the unit normal.
export function debugPlanes(view, W, H) {
    const pc = toByte(capture(view, W, H, 'piece'));
    const dp = toByte(capture(view, W, H, 'depth'));
    const nm = toByte(capture(view, W, H, 'normal'));
    const n = W * H, piece = new Int16Array(n), depth = new Float32Array(n), normal = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) {
        const o = 4 * i;
        const id = pc[o + 1] >= 250 ? Math.round((pc[o] - 8) / 16) + 16 * Math.round((pc[o + 2] - 8) / 16) - 1 : -1;
        const on = id >= 0 && pc[o] < 250;
        piece[i] = on ? id : -1;
        depth[i] = on && dp[o + 2] >= 250 ? (Math.round((dp[o] - 2) / 4) * 64 + Math.round((dp[o + 1] - 2) / 4)) / 100 : 0;
        let x = nm[o] / 127.5 - 1, y = nm[o + 1] / 127.5 - 1, z = nm[o + 2] / 127.5 - 1;
        const l = Math.hypot(x, y, z) || 1;
        normal[3 * i] = x / l; normal[3 * i + 1] = y / l; normal[3 * i + 2] = z / l;
    }
    return { W, H, piece, depth, normal };
}

// The vertices on screen, binned, to name what a pixel shows.
function screenVerts(creature, X, view, W, H) {
    const nv = X.length / 3, sx = new Float32Array(nv), sy = new Float32Array(nv), sd = new Float32Array(nv);
    const cell = 6, gw = Math.ceil(W / cell), gh = Math.ceil(H / cell);
    const bins = new Map();
    const P = view.position;
    for (let v = 0; v < nv; v++) {
        const p = [X[3 * v], X[3 * v + 1], X[3 * v + 2]];
        const s = project(view, W, H, p);
        sx[v] = s.x; sy[v] = s.y; sd[v] = Math.hypot(p[0] - P[0], p[1] - P[1], p[2] - P[2]);
        if (s.behind || s.x < 0 || s.y < 0 || s.x >= W || s.y >= H) continue;
        const key = Math.floor(s.y / cell) * gw + Math.floor(s.x / cell);
        let b = bins.get(key);
        if (!b) bins.set(key, b = []);
        b.push(v);
    }
    // The nearest vertex to pixel (x, y) at distance d (within 3 cm of it), of piece `pc` (or any).
    const near = (x, y, d, pc = -1) => {
        const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
        let best = -1, bd = Infinity;
        for (let r = 0; r <= 3 && best < 0; r++) {
            for (let j = cy - r; j <= cy + r; j++) for (let i = cx - r; i <= cx + r; i++) {
                if (i < 0 || j < 0 || i >= gw || j >= gh) continue;
                if (r > 0 && i > cx - r && i < cx + r && j > cy - r && j < cy + r) continue;
                const b = bins.get(j * gw + i);
                if (!b) continue;
                for (const v of b) {
                    if (pc >= 0 && creature.body.piece[v] !== pc) continue;
                    if (Math.abs(sd[v] - d) > 0.03 + 0.02 * r) continue;
                    const e = (sx[v] - x) ** 2 + (sy[v] - y) ** 2;
                    if (e < bd) { bd = e; best = v; }
                }
            }
        }
        return best;
    };
    return { near };
}

// The hard lines in one view of posed mesh X. Returns { sites: Map key ->
// { kind, cm, score, px, x, y } (x, y the pixels' centre), kinks: [...],
// mark: Int32Array (per pixel the site's index in `keys`, or -1), keys }.
export function imageLines(creature, X, view, W, H, planes = null) {
    const D = planes || debugPlanes(view, W, H);
    const topo = seamTopology(creature);
    const names = topo.pieces.map((p) => p.name);
    const sv = screenVerts(creature, X, view, W, H);
    const pxm = (d) => (d * 2 * Math.tan((view.fov * Math.PI) / 360)) / H;   // m a pixel at distance d
    const { piece, depth, normal } = D, st = SHOT.step;
    const sites = new Map(), keys = [], mark = new Int32Array(W * H).fill(-1);
    const keyIndex = new Map();
    const put = (key, kind, x, y, cm, angle, i) => {
        let s = sites.get(key);
        if (!s) { s = { key, kind, cm: 0, score: 0, px: 0, sx: 0, sy: 0, angleMax: 0 }; sites.set(key, s); keyIndex.set(key, keys.length); keys.push(key); }
        s.cm += cm; s.score += cm * (angle / 90); s.px++; s.sx += x; s.sy += y; s.angleMax = Math.max(s.angleMax, angle);
        mark[i] = keyIndex.get(key);
    };
    const ang = (i, j) => {
        const c = normal[3 * i] * normal[3 * j] + normal[3 * i + 1] * normal[3 * j + 1] + normal[3 * i + 2] * normal[3 * j + 2];
        return Math.acos(Math.max(-1, Math.min(1, c))) * DEG;
    };
    const flat = (i, j) => piece[j] === piece[i] && depth[j] && Math.abs(depth[j] - depth[i]) <= SHOT.sameDepth;
    for (let y = 1; y + st < H; y++) for (let x = 1; x + st < W; x++) {
        const i = y * W + x, p = piece[i];
        if (p < 0 || !depth[i]) continue;
        let best = null;
        for (const s of [1, W]) {
            // A seam: two pieces at one depth, compared 2 px apart (the pixel
            // between them is a blend of both).
            const j = i + st * s, q = piece[j];
            if (q >= 0 && q !== p && depth[j] && Math.abs(depth[j] - depth[i]) <= SHOT.sameDepth) {
                const a = ang(i, j);
                if (a >= SHOT.seamMin && (!best || best.kind !== 'cross' || a > best.ang)) best = { kind: 'cross', q, ang: a };
                continue;
            }
            // A crease: the normal jumping between this pixel and the next by
            // more than it turns in the steps either side (a curved surface
            // turns evenly; a fold or a kink turns at once).
            const k = i + s;
            if (best || !flat(i, k) || !flat(i, i - s) || !flat(i, i + 2 * s)) continue;
            const b = ang(i, k), jump = b - Math.max(ang(i - s, i), ang(k, i + 2 * s));
            if (b >= SHOT.crease && jump >= SHOT.crease / 2) best = { kind: 'crease', q: p, ang: jump };
        }
        if (!best) continue;
        // A line seen from both sides is found twice (1 px each side): half a pixel's length each.
        const cm = 50 * pxm(depth[i]);
        if (best.kind === 'cross') {
            let a = names[p], b = names[best.q];
            if (a > b) [a, b] = [b, a];
            put(`cross ${a} x ${b}`, 'cross', x, y, cm, best.ang, i);
        } else {
            const v = sv.near(x, y, depth[i], p);
            if (v >= 0) put(`crease ${topo.label(v)}`, 'crease', x, y, cm, best.ang, i);
        }
    }
    const kinks = silhouetteKinks(D);
    for (const k of kinks) {
        const v = sv.near(k.x, k.y, k.depth);
        k.where = v >= 0 ? topo.label(v) : 'body';
        // A notch reads as a short line: 3 cm at its angle.
        put(`kink ${k.where}`, 'kink', k.x, k.y, 3, k.angle, k.y * W + k.x);
    }
    for (const s of sites.values()) { s.x = s.sx / s.px; s.y = s.sy / s.px; delete s.sx; delete s.sy; }
    return { sites, kinks, mark, keys, planes: D };
}

// The outer contour of the body's largest region, traced (Moore
// neighbourhood), and its inward notches: where the contour turns by more
// than KINK degrees between the points KINK_SPAN before and after, and the
// chord between them runs outside the body.
export function silhouetteKinks(D) {
    const { W, H, piece, depth } = D;
    const on = (x, y) => x >= 0 && y >= 0 && x < W && y < H && piece[y * W + x] >= 0;
    // The start: the first body pixel scanning down the middle columns, then any.
    let sx = -1, sy = -1;
    let bestArea = 0;
    // The largest region's topmost pixel (regions by a coarse flood over 4 px cells is enough here).
    const seen = new Uint8Array(W * H);
    for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
        const i = y * W + x;
        if (!on(x, y) || seen[i]) continue;
        const stack = [i];
        seen[i] = 1;
        let area = 0, top = i;
        while (stack.length) {
            const j = stack.pop();
            area++;
            if (j < top) top = j;
            const jx = j % W, jy = (j - jx) / W;
            for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
                const nx = jx + dx, ny = jy + dy, k = ny * W + nx;
                if (on(nx, ny) && !seen[k]) { seen[k] = 1; stack.push(k); }
            }
        }
        if (area > bestArea) { bestArea = area; sx = top % W; sy = (top - sx) / W; }
    }
    if (sx < 0) return [];
    while (on(sx, sy - 1)) sy--;
    const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
    const pts = [];
    let x = sx, y = sy, d = 6;
    for (let n = 0; n < 4 * (W + H) * 8; n++) {
        pts.push([x, y]);
        let found = false;
        for (let k = 0; k < 8; k++) {
            const dd = (d + 6 + k) % 8;
            const nx = x + dirs[dd][0], ny = y + dirs[dd][1];
            if (on(nx, ny)) { x = nx; y = ny; d = dd; found = true; break; }
        }
        if (!found || (x === sx && y === sy && pts.length > 2)) break;
    }
    const n = pts.length, K = SHOT.kinkSpan, out = [];
    if (n < 4 * K) return out;
    const turn = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const a = pts[(i - K + n) % n], b = pts[i], c = pts[(i + K) % n];
        const u = [b[0] - a[0], b[1] - a[1]], v = [c[0] - b[0], c[1] - b[1]];
        const lu = Math.hypot(...u), lv = Math.hypot(...v);
        if (lu < K * 0.6 || lv < K * 0.6) continue;
        const ang = Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (lu * lv)))) * DEG;
        const m = [Math.round((a[0] + c[0]) / 2), Math.round((a[1] + c[1]) / 2)];
        // Where the outline's two sides lie at different depths, one part
        // passes in front of another (a leg crossing a leg): not a notch in the skin.
        const da = depth[a[1] * W + a[0]], dc = depth[c[1] * W + c[0]];
        if (da && dc && Math.abs(da - dc) > SHOT.occlusion) continue;
        if (ang >= SHOT.kink && !on(m[0], m[1])) turn[i] = ang;
    }
    // One kink per notch: the sharpest within 3 spans.
    for (let i = 0; i < n; i++) {
        if (!turn[i]) continue;
        let peak = true;
        for (let j = -3 * K; j <= 3 * K && peak; j++) if (j && turn[(i + j + n) % n] > turn[i]) peak = false;
        if (!peak) continue;
        const [px, py] = pts[i];
        out.push({ x: px, y: py, angle: Math.round(turn[i]), depth: depth[py * W + px] });
    }
    return out;
}
