// pad-draw.js — the schematic controller on the gamepad panel's canvas.
//
// Schematic rather than realistic: all 17 standard buttons and both sticks
// need a distinct, labelled spot, which a real silhouette would fight. The
// geometry tables are the single source for both fill and highlight.

const FACE = [   // south / east / west / north
    { i: 0, x: 432, y: 196 }, { i: 1, x: 466, y: 166 },
    { i: 2, x: 398, y: 166 }, { i: 3, x: 432, y: 136 },
];
const DPAD = [
    { i: 12, x: 116, y: 138, w: 26, h: 30 },   // up
    { i: 13, x: 116, y: 196, w: 26, h: 30 },   // down
    { i: 14, x: 84,  y: 170, w: 30, h: 26 },   // left
    { i: 15, x: 144, y: 170, w: 30, h: 26 },   // right
];
const CENTER = [ { i: 8, x: 246, y: 136, r: 9 }, { i: 9, x: 314, y: 136, r: 9 }, { i: 16, x: 280, y: 118, r: 12 } ];
const STICKS = [
    { ax: 0, ay: 1, btn: 10, cx: 210, cy: 252, r: 34 },
    { ax: 2, ay: 3, btn: 11, cx: 356, cy: 252, r: 34 },
];
const OFF = '#1b2230', EDGE = '#2b3444', ON = '#6ee79a', TXT = '#6d7688';
const MONO = '11px ui-monospace, Consolas, monospace';

let ctx = null;

function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function label(text, x, y, on, font) {
    ctx.fillStyle = on ? '#0d1016' : TXT;
    ctx.font = font || MONO;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
}

function rect(x, y, w, h, text, on) {
    ctx.fillStyle = on ? ON : OFF;
    ctx.strokeStyle = on ? ON : EDGE;
    ctx.lineWidth = 1;
    roundRect(x, y, w, h, 4);
    ctx.fill(); ctx.stroke();
    if (text) label(text, x + w / 2, y + h / 2, on);
}

function circle(x, y, r, text, on) {
    ctx.fillStyle = on ? ON : OFF;
    ctx.strokeStyle = on ? ON : EDGE;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    if (text) label(text, x, y, on);
}

// A trigger shows its analog value as a fill level, not an on/off state.
function trigger(x, y, text, btn) {
    const v = btn ? btn.value : 0, w = 92, h = 22;
    ctx.fillStyle = OFF;
    ctx.strokeStyle = btn && btn.pressed ? ON : EDGE;
    roundRect(x, y, w, h, 4); ctx.fill(); ctx.stroke();
    if (v > 0) {
        ctx.save();
        roundRect(x, y, w, h, 4); ctx.clip();
        ctx.fillStyle = '#2f7d52';
        ctx.fillRect(x, y, w * v, h);
        ctx.restore();
    }
    ctx.fillStyle = '#b9c2d4';
    ctx.font = MONO;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text + ' ' + v.toFixed(2), x + w / 2, y + h / 2);
}

const fmt = (v) => { v = v || 0; return (v >= 0 ? '+' : '') + v.toFixed(2); };

/** Draw pad `gp` (a Gamepad snapshot, or null for an empty canvas). */
export function drawPad(canvas, gp) {
    ctx = canvas.getContext('2d');
    ctx.fillStyle = '#080a0f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!gp) return;
    const b = gp.buttons;
    const pressed = (i) => !!(b[i] && b[i].pressed);

    ctx.strokeStyle = '#1e2531';                    // body outline, for orientation
    ctx.lineWidth = 2;
    roundRect(60, 100, 440, 190, 60);
    ctx.stroke();

    trigger(96, 34, 'LT', b[6]);
    trigger(372, 34, 'RT', b[7]);
    rect(96, 72, 92, 20, 'LB', pressed(4));
    rect(372, 72, 92, 20, 'RB', pressed(5));
    for (const d of DPAD) rect(d.x, d.y, d.w, d.h, '', pressed(d.i));
    for (const f of FACE) circle(f.x, f.y, 16, 'ABXY'[f.i], pressed(f.i));
    for (const c of CENTER) circle(c.x, c.y, c.r, '', pressed(c.i));
    label('back', 246, 160, false, '9px system-ui');
    label('start', 314, 160, false, '9px system-ui');

    // Sticks: the knob is axes[] directly and moves continuously, the contrast
    // with the binary face buttons beside it.
    for (const s of STICKS) {
        const x = gp.axes[s.ax] || 0, y = gp.axes[s.ay] || 0;
        ctx.strokeStyle = EDGE; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(s.cx, s.cy, s.r, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = '#161c27';
        ctx.beginPath();
        ctx.moveTo(s.cx - s.r, s.cy); ctx.lineTo(s.cx + s.r, s.cy);
        ctx.moveTo(s.cx, s.cy - s.r); ctx.lineTo(s.cx, s.cy + s.r);
        ctx.stroke();
        const kx = s.cx + x * (s.r - 10), ky = s.cy + y * (s.r - 10);
        ctx.strokeStyle = '#3d5a80'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(s.cx, s.cy); ctx.lineTo(kx, ky); ctx.stroke();
        circle(kx, ky, 11, '', pressed(s.btn));
    }
    label(fmt(gp.axes[0]) + ', ' + fmt(gp.axes[1]), 210, 302, false, '10px ui-monospace, Consolas, monospace');
    label(fmt(gp.axes[2]) + ', ' + fmt(gp.axes[3]), 356, 302, false, '10px ui-monospace, Consolas, monospace');
}
