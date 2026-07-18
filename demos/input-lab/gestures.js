// gestures.js — pinch / two-finger pan / two-finger rotate on a map viewer.
//
// SDL3 dropped SDL2's gesture subsystem, so bro recognises gestures itself from
// the live touch contacts and dispatches WebKit-style gesture events. The rules
// that matter for writing against them:
//
//   * The two OLDEST contacts (the "founding pair") drive the gesture. A third
//     finger is ignored; if a founding finger lifts while two are still down,
//     the gesture ENDS and a fresh one starts immediately over the remaining
//     pair, re-based to scale 1 / rotation 0.
//   * Recognition is DOCUMENT-WIDE, not per element. The founding pair is the
//     two oldest live contacts anywhere in the document, and the events are
//     delivered to the hit target of their centroid at gesturestart. A finger
//     resting on some other panel is therefore a founding contact, and will aim
//     the gesture at that panel instead of this one. (Measured, not inferred:
//     leaving two fingers on the pointer visualiser above makes this map
//     inert.) Apps that host several gesture surfaces at once need to reckon
//     with that — there is no per-element gesture arena.
//   * `scale` is relative to gesturestart, not absolute — so the viewer holds a
//     base scale captured at gesturestart and multiplies. Applying e.scale
//     directly would make every new gesture snap the view back to 1×.
//   * `rotation` is degrees, clockwise positive, and UNWRAPPED: spinning past
//     180° keeps accumulating rather than flipping sign. Adding it to a base
//     angle therefore just works, with no unwrapping of our own.
//   * `clientX/Y` is the founding pair's centroid, so panning is the centroid
//     delta since gesturestart.
//   * Gesture events are a PARALLEL stream. The raw pointer/touch events keep
//     firing untouched — an app doing its own two-finger math sees no change.
//
// The mouse fallback (drag = pan, wheel = zoom, shift+drag = rotate) is there
// so the panel is not dead on a desktop without a touchscreen. It is a separate
// code path and is labelled as such; it does not fake gesture events.

const W = 560, H = 320;

export const gestureState = {
    scale: 1,
    rotation: 0,        // degrees, clockwise positive
    tx: 0, ty: 0,       // translation in canvas pixels
    active: false,
    gestures: 0,        // completed gesturestart..gestureend cycles
    changes: 0,
    lastEventScale: 1,  // the raw e.scale of the last gesturechange
    lastEventRotation: 0,
    source: 'idle',     // 'gesture' | 'mouse' | 'idle'
};

// Captured at gesturestart; every gesturechange is applied relative to these.
let base = null;
let canvas, ctx, phaseEl;

export function initGesturePanel() {
    canvas = document.getElementById('gestCanvas');
    ctx = canvas.getContext('2d');
    phaseEl = document.getElementById('gestPhase');

    const rows = document.getElementById('gestReadout');
    rows.innerHTML = READOUT.map((k, i) =>
        `<div class="row"><span>${k}</span><b id="gval${i}">—</b></div>`).join('');

    canvas.addEventListener('gesturestart', (e) => {
        base = {
            scale: gestureState.scale,
            rotation: gestureState.rotation,
            tx: gestureState.tx, ty: gestureState.ty,
            cx: e.clientX, cy: e.clientY,
        };
        gestureState.active = true;
        gestureState.source = 'gesture';
        setPhase(`gesturestart — scale ${e.scale.toFixed(2)}, rotation ${e.rotation.toFixed(1)}°`);
    });

    canvas.addEventListener('gesturechange', (e) => {
        if (!base) return;
        gestureState.changes++;
        gestureState.lastEventScale = e.scale;
        gestureState.lastEventRotation = e.rotation;
        gestureState.scale = clamp(base.scale * e.scale, 0.15, 12);
        gestureState.rotation = base.rotation + e.rotation;
        // Pan follows the centroid: everything the founding pair's midpoint has
        // travelled since gesturestart moves the image with it.
        gestureState.tx = base.tx + (e.clientX - base.cx);
        gestureState.ty = base.ty + (e.clientY - base.cy);
        setPhase(`gesturechange — e.scale ${e.scale.toFixed(3)}, ` +
                 `e.rotation ${e.rotation.toFixed(1)}°`);
    });

    canvas.addEventListener('gestureend', (e) => {
        gestureState.active = false;
        gestureState.gestures++;
        base = null;
        setPhase(`gestureend — final e.scale ${e.scale.toFixed(3)}, ` +
                 `e.rotation ${e.rotation.toFixed(1)}°`);
    });

    document.getElementById('gestReset').addEventListener('click', reset);

    initMouseFallback();
    setPhase('idle — put two fingers on the map');
}

const READOUT = [
    'view scale', 'view rotation°', 'translate x', 'translate y',
    'last e.scale', 'last e.rotation°', 'gesturechange count', 'completed gestures',
];

export function reset() {
    gestureState.scale = 1;
    gestureState.rotation = 0;
    gestureState.tx = 0; gestureState.ty = 0;
    base = null;
    setPhase('reset');
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function setPhase(s) { if (phaseEl && phaseEl.textContent !== s) phaseEl.textContent = s; }

// ── mouse fallback ──────────────────────────────────────────────────────────

function initMouseFallback() {
    let dragging = false, lastX = 0, lastY = 0, rotating = false;

    canvas.addEventListener('pointerdown', (e) => {
        if (e.pointerType !== 'mouse') return;   // touch belongs to the gesture path
        dragging = true;
        rotating = e.shiftKey;
        lastX = e.clientX; lastY = e.clientY;
        canvas.setPointerCapture(e.pointerId);
        gestureState.source = 'mouse';
    });
    canvas.addEventListener('pointermove', (e) => {
        if (!dragging || e.pointerType !== 'mouse') return;
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        lastX = e.clientX; lastY = e.clientY;
        if (rotating) gestureState.rotation += dx * 0.5;
        else { gestureState.tx += dx; gestureState.ty += dy; }
        setPhase(rotating ? 'mouse fallback — rotating' : 'mouse fallback — panning');
    });
    canvas.addEventListener('pointerup', (e) => {
        if (e.pointerType !== 'mouse') return;
        dragging = false;
    });
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        gestureState.scale = clamp(gestureState.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1), 0.15, 12);
        gestureState.source = 'mouse';
        setPhase('mouse fallback — wheel zoom');
    });
}

// ── drawing ─────────────────────────────────────────────────────────────────
//
// The "photo" is drawn rather than loaded so the app has no asset dependency,
// and it is deliberately full of straight lines and text: a rotation of two
// degrees is invisible on a photograph and obvious on a grid.

export function tickGesturePanel() {
    if (!ctx) return;
    ctx.fillStyle = '#080a0f';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(W / 2 + gestureState.tx, H / 2 + gestureState.ty);
    ctx.rotate(gestureState.rotation * Math.PI / 180);
    ctx.scale(gestureState.scale, gestureState.scale);
    drawMap();
    ctx.restore();

    // A fixed frame drawn OUTSIDE the transform, so the viewport border stays
    // put and the content is visibly moving relative to it.
    ctx.strokeStyle = '#2b3444';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

    updateReadout();
}

function drawMap() {
    const S = 110;   // half-extent of the map card in unscaled pixels

    ctx.fillStyle = '#12283c';
    ctx.fillRect(-S * 1.6, -S, S * 3.2, S * 2);

    // "water"
    ctx.fillStyle = '#0f3c50';
    ctx.beginPath();
    ctx.moveTo(-S * 1.6, S * 0.35);
    ctx.bezierCurveTo(-S * 0.5, S * 0.05, S * 0.4, S * 0.8, S * 1.6, S * 0.3);
    ctx.lineTo(S * 1.6, S); ctx.lineTo(-S * 1.6, S);
    ctx.closePath();
    ctx.fill();

    // street grid — the thing that makes rotation legible
    ctx.strokeStyle = '#1e4463';
    ctx.lineWidth = 1 / Math.max(0.4, gestureState.scale);
    ctx.beginPath();
    for (let x = -S * 1.6; x <= S * 1.6; x += 22) { ctx.moveTo(x, -S); ctx.lineTo(x, S); }
    for (let y = -S; y <= S; y += 22) { ctx.moveTo(-S * 1.6, y); ctx.lineTo(S * 1.6, y); }
    ctx.stroke();

    // a couple of "roads"
    ctx.strokeStyle = '#3f6f96';
    ctx.lineWidth = 5 / Math.max(0.4, gestureState.scale);
    ctx.beginPath();
    ctx.moveTo(-S * 1.6, -S * 0.3); ctx.lineTo(S * 1.6, -S * 0.15);
    ctx.moveTo(-S * 0.4, -S); ctx.lineTo(-S * 0.15, S);
    ctx.stroke();

    // a north arrow, so rotation has an unambiguous reference
    ctx.strokeStyle = '#ffd479';
    ctx.fillStyle = '#ffd479';
    ctx.lineWidth = 2 / Math.max(0.4, gestureState.scale);
    ctx.beginPath();
    ctx.moveTo(S * 1.25, -S * 0.75); ctx.lineTo(S * 1.25, -S * 0.25);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(S * 1.25, -S * 0.85);
    ctx.lineTo(S * 1.19, -S * 0.68);
    ctx.lineTo(S * 1.31, -S * 0.68);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#9fb0c8';
    ctx.font = '11px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('N', S * 1.25, -S * 0.98);
    ctx.fillText('pinch · pan · rotate', 0, 0);
    ctx.fillStyle = '#5c6577';
    ctx.font = '9px ui-monospace, Consolas, monospace';
    ctx.fillText('gesturestart / gesturechange / gestureend', 0, 16);
}

function updateReadout() {
    const g = gestureState;
    const vals = [
        g.scale.toFixed(3) + '×',
        (g.rotation >= 0 ? '+' : '') + g.rotation.toFixed(1),
        Math.round(g.tx) + ' px',
        Math.round(g.ty) + ' px',
        g.lastEventScale.toFixed(3),
        (g.lastEventRotation >= 0 ? '+' : '') + g.lastEventRotation.toFixed(1),
        String(g.changes),
        String(g.gestures),
    ];
    for (let i = 0; i < vals.length; i++) {
        const el = document.getElementById('gval' + i);
        if (el && el.textContent !== vals[i]) el.textContent = vals[i];
    }
}
