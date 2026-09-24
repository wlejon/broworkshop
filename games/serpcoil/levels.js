// Serpcoil levels — 15 hand-authored paths in a 1280 x 800 reference frame.
// A level: { name, controls: [{x, y}], totalOrbs, palette (colour slots
// 1..6), chainSpeed (px/s), shooter: {x, y} }. scaled() maps one to the
// current canvas size.

const W = 1280, H = 800;

function zigZag(count, { top = 120, bottom = H - 140, xPad = 140 } = {}) {
    const dx = (W - xPad * 2) / (count - 1);
    const pts = [];
    for (let i = 0; i < count; i++) pts.push({ x: xPad + i * dx, y: i % 2 === 0 ? top : bottom });
    return pts;
}

function spiral(cx, cy, loops, startR, endR, perLoop) {
    const pts = [];
    const total = loops * perLoop;
    for (let i = 0; i < total; i++) {
        const t = i / total;
        const r = startR + (endR - startR) * t;
        const a = t * loops * Math.PI * 2;
        pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
    return pts;
}

function sCurve(segments) {
    const pts = [];
    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        pts.push({ x: 140 + t * (W - 280), y: H / 2 + Math.sin(t * Math.PI * 2) * (H * 0.32) });
    }
    return pts;
}

function figureEight(cx, cy, rx, ry, segments) {
    const pts = [];
    for (let i = 0; i <= segments; i++) {
        const t = (i / segments) * Math.PI * 2;
        pts.push({ x: cx + Math.sin(t) * rx, y: cy + Math.sin(t * 2) * ry * 0.5 });
    }
    return pts;
}

const xy = (...pairs) => pairs.map(([x, y]) => ({ x, y }));

export const LEVELS = [
    {
        name: "Waking Coil",
        controls: xy([140, 180], [380, 260], [620, 180], [880, 280], [1100, 220],
            [1140, 500], [860, 620], [560, 580], [260, 640], [140, 560]),
        totalOrbs: 38, palette: [1, 2, 3], chainSpeed: 28, shooter: { x: W / 2, y: H / 2 + 20 },
    },
    {
        name: "River Bend", controls: sCurve(10),
        totalOrbs: 45, palette: [1, 2, 3], chainSpeed: 30, shooter: { x: 380, y: 80 },
    },
    {
        name: "Lightning Path", controls: zigZag(7, { top: 160, bottom: H - 160, xPad: 140 }),
        totalOrbs: 48, palette: [1, 2, 3, 4], chainSpeed: 32, shooter: { x: W / 2, y: H / 2 },
    },
    {
        name: "Inward Gyre", controls: spiral(W / 2, H / 2, 2.2, 330, 80, 16),
        totalOrbs: 52, palette: [1, 2, 3, 4], chainSpeed: 30, shooter: { x: 1140, y: 140 },
    },
    {
        name: "Twin Runes", controls: figureEight(W / 2, H / 2, 420, 260, 28),
        totalOrbs: 55, palette: [1, 2, 3, 4], chainSpeed: 32, shooter: { x: W / 2, y: 80 },
    },
    {
        name: "Switchback",
        controls: xy([120, 180], [1160, 180], [1160, 380], [120, 380],
            [120, 580], [1160, 580], [1160, 700], [900, 720]),
        totalOrbs: 58, palette: [1, 2, 3, 4], chainSpeed: 34, shooter: { x: 620, y: 480 },
    },
    {
        name: "Drawing Mandala", controls: spiral(W / 2, H / 2, 3, 360, 60, 18),
        totalOrbs: 62, palette: [1, 2, 3, 4], chainSpeed: 34, shooter: { x: 140, y: H - 140 },
    },
    {
        name: "Sawtooth", controls: zigZag(9, { top: 140, bottom: H - 140, xPad: 100 }),
        totalOrbs: 65, palette: [1, 2, 3, 4, 5], chainSpeed: 36, shooter: { x: W / 2, y: H / 2 },
    },
    {
        name: "Double Knot",
        controls: xy([140, 500], [320, 260], [500, 500], [380, 720], [620, 720],
            [780, 500], [960, 260], [1140, 500], [1020, 720], [760, 740]),
        totalOrbs: 68, palette: [1, 2, 3, 4, 5], chainSpeed: 36, shooter: { x: W / 2, y: H / 2 - 20 },
    },
    {
        name: "Dual Gyre",
        controls: [
            ...spiral(W / 2 - 260, H / 2, 1.8, 40, 220, 14),
            { x: W / 2 + 10, y: H / 2 },
            ...spiral(W / 2 + 260, H / 2, 1.8, 220, 40, 14),
        ],
        totalOrbs: 72, palette: [1, 2, 3, 4, 5], chainSpeed: 36, shooter: { x: W / 2, y: H - 160 },
    },
    {
        name: "Serpent's Tongue", controls: sCurve(12),
        totalOrbs: 78, palette: [1, 2, 3, 4, 5], chainSpeed: 40, shooter: { x: W / 2, y: H - 150 },
    },
    {
        name: "Bound Infinity", controls: figureEight(W / 2, H / 2, 460, 260, 36),
        totalOrbs: 82, palette: [1, 2, 3, 4, 5, 6], chainSpeed: 40, shooter: { x: W / 2, y: 80 },
    },
    {
        name: "Whorl of Thorns", controls: spiral(W / 2, H / 2, 3.5, 340, 50, 20),
        totalOrbs: 86, palette: [1, 2, 3, 4, 5, 6], chainSpeed: 42, shooter: { x: 1140, y: 660 },
    },
    {
        name: "Labyrinth",
        controls: xy([120, 140], [1160, 140], [1160, 280], [220, 280], [220, 420],
            [1160, 420], [1160, 560], [220, 560], [220, 700], [1160, 700]),
        totalOrbs: 92, palette: [1, 2, 3, 4, 5, 6], chainSpeed: 42, shooter: { x: 80, y: 480 },
    },
    {
        name: "Final Coil",
        controls: [...spiral(W / 2, H / 2, 2.5, 360, 80, 16), ...figureEight(W / 2, H / 2, 80, 60, 8)],
        totalOrbs: 100, palette: [1, 2, 3, 4, 5, 6], chainSpeed: 46, shooter: { x: 1200, y: 80 },
    },
];

/** Level idx with its path and shooter scaled from 1280 x 800 to w x h. */
export function scaledLevel(idx, w, h) {
    const L = LEVELS[idx];
    const sx = w / W, sy = h / H;
    return {
        ...L,
        palette: L.palette.slice(),
        controls: L.controls.map((p) => ({ x: p.x * sx, y: p.y * sy })),
        shooter: { x: L.shooter.x * sx, y: L.shooter.y * sy },
    };
}
