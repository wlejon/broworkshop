// render3d.js — isometric 3D renderer for the farm, through bro's scene graph.
//
// Replaces the flat 2D-canvas render.js. The farm model is pure tile space
// (x in [0..GRID.cols), y in [0..GRID.rows), continuous floats); this renderer
// maps that 1:1 onto a `cellSize = 1` TileWorld in the 3D scene — model (x, y)
// becomes world (X = x, Z = y), with Y up. "Isometric" is just an orthographic
// camera tilted over that grid, so the same data could render top-down or in
// free 3D by changing the camera alone.
//
// Static geometry (ground tiles, buildings, trough frames, crop soil beds) is
// built once. Dynamic actors (crops, troughs' fill level, animals, workers, the
// player, the foreman) are pooled nodes whose transform/colour are updated each
// frame from the live world — the renderer never allocates per frame.

import {
    GRID, REGIONS, COLORS, ANIMAL_KINDS, CROP_KINDS, ROLE_COLOR, WORKER,
} from '/app/defs.js';

// HTML-escape model-authored strings (names, speech) before they go into a
// billboard's innerHTML.
function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// --- colour helpers -------------------------------------------------------
// The PBR shader and the TileWorld palette both take LINEAR RGB; CSS hex is
// sRGB, so linearize once and cache.
function srgbToLinear(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
const _linCache = new Map();
function lin(hex) {
    let v = _linCache.get(hex);
    if (v) return v;
    const n = parseInt(hex.slice(1), 16);
    v = [srgbToLinear((n >> 16 & 255) / 255),
         srgbToLinear((n >> 8 & 255) / 255),
         srgbToLinear((n & 255) / 255)];
    _linCache.set(hex, v);
    return v;
}
function linA(hex, a) { const c = lin(hex); return [c[0], c[1], c[2], a == null ? 1 : a]; }
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function lerp(a, b, t) { return a + (b - a) * t; }

// Board centre (in tile/world units) and camera framing.
const CX = GRID.cols / 2;   // 20
const CZ = GRID.rows / 2;   // 14
const CAM = { dist: 24, height: 30, view: 29 };  // iso offset + ortho view height

export function createRenderer(scene, world) {
    // --- lighting + tonemap ------------------------------------------------
    scene.setToneMap({ mode: 'aces', exposure: 1.0, gamma: 2.2 });
    scene.setAmbient([0.30, 0.33, 0.40]);
    const sun = scene.createLight({
        type: 'directional', direction: [-0.5, -1.0, -0.45],
        color: [1.0, 0.97, 0.9], intensity: 3.2, name: 'sun',
    });
    sun.castsShadow = true;
    sun.cascadeCount = 4;
    if ('shadowNormalBias' in sun) sun.shadowNormalBias = 0.05;
    if (scene.setShadowQuality) scene.setShadowQuality(4096, 3);

    // --- ground: one TileWorld tinted by region ----------------------------
    // Palette indices: 1 grass, 2 grass-dark (checker), 3 field soil,
    // 4 pen floor, 5 building foundation, 6 well water.
    const palette = new Float32Array([
        0, 0, 0, 0,
        ...linA(COLORS.grass), ...linA(COLORS.grassAlt),
        ...linA(COLORS.field), ...linA(COLORS.penFill),
        ...linA(COLORS.path),  ...linA(COLORS.well),
    ]);
    const ground = scene.createTileWorld({
        width: GRID.cols, height: GRID.rows, cellSize: 1.0,
        heightStep: 0.4, chunkSize: 20, aoStrength: 0.35,
        palette, origin: [0, 0, 0],
    });
    // Base grass with a subtle checker.
    for (let y = 0; y < GRID.rows; y++)
        for (let x = 0; x < GRID.cols; x++)
            ground.setTile(x, y, ((x + y) & 1) ? 1 : 2);
    // Region footprints.
    const REGION_TILE = { field: 3, pen: 4, farmhouse: 5, barn: 5, silo: 5, well: 6 };
    for (const r of REGIONS) {
        const id = REGION_TILE[r.type] || 1;
        for (let y = r.y0; y <= r.y1; y++)
            for (let x = r.x0; x <= r.x1; x++) ground.setTile(x, y, id);
    }
    ground.rebuild();

    // --- static mesh helpers ----------------------------------------------
    function box(cx, cy, cz, w, h, d, color, rough) {
        const n = scene.createMesh({ mesh: 'box', x: cx, y: cy, z: cz, color, roughness: rough == null ? 0.85 : rough });
        n.scaleX = w; n.scaleY = h; n.scaleZ = d;
        return n;
    }
    function regionBox(r) {
        return {
            cx: (r.x0 + r.x1 + 1) / 2, cz: (r.y0 + r.y1 + 1) / 2,
            w: (r.x1 - r.x0 + 1), d: (r.y1 - r.y0 + 1),
        };
    }

    // --- buildings ---------------------------------------------------------
    for (const r of REGIONS) {
        const b = regionBox(r);
        if (r.type === 'farmhouse') {
            box(b.cx, 0.9, b.cz, b.w * 0.7, 1.8, b.d * 0.7, lin(COLORS.farmhouse));
            box(b.cx, 2.0, b.cz, b.w * 0.78, 0.45, b.d * 0.78, lin('#5d3522'));
        } else if (r.type === 'barn') {
            box(b.cx, 1.0, b.cz, b.w * 0.72, 2.0, b.d * 0.72, lin(COLORS.barn));
            box(b.cx, 2.25, b.cz, b.w * 0.8, 0.5, b.d * 0.8, lin('#7a2f29'));
        } else if (r.type === 'silo') {
            const R = Math.min(b.w, b.d) * 0.32;
            const body = scene.createMesh({ mesh: 'cylinder', x: b.cx, y: 1.9, z: b.cz, color: lin(COLORS.silo), roughness: 0.55, metallic: 0.2 });
            body.scaleX = R * 2; body.scaleZ = R * 2; body.scaleY = 3.8;
            const dome = scene.createMesh({ mesh: 'sphere', x: b.cx, y: 3.8, z: b.cz, color: lin(COLORS.silo), roughness: 0.55, metallic: 0.2 });
            dome.scaleX = R * 2; dome.scaleZ = R * 2; dome.scaleY = R * 1.4;
        } else if (r.type === 'well') {
            box(b.cx, 0.35, b.cz, b.w * 0.6, 0.7, b.d * 0.6, lin('#6b6b6b'));
        }
        // field + pens: ground tint only (animals/crops sit on them).
    }

    // --- troughs (frame static, fill dynamic) ------------------------------
    const troughFill = {};
    for (const t of Object.values(world.troughs)) {
        box(t.x, 0.15, t.y, 0.85, 0.3, 0.55, lin('#6b5436'), 0.9);
        const f = scene.createMesh({
            mesh: 'box', x: t.x, y: 0.2, z: t.y,
            color: t.kind === 'water' ? lin(COLORS.troughWater) : lin(COLORS.troughFeed),
            roughness: t.kind === 'water' ? 0.3 : 0.8,
        });
        f.scaleX = 0.7; f.scaleZ = 0.42;
        troughFill[t.id] = f;
    }

    // --- crops (soil bed static, plant dynamic) ----------------------------
    const cropPlant = {};
    for (const c of world.crops) {
        box(c.x, 0.06, c.y, 0.95, 0.12, 0.95, lin(COLORS.soil), 0.95);
        const p = scene.createMesh({ mesh: 'cylinder', x: c.x, y: 0.25, z: c.y, color: lin(COLORS.cropSprout), roughness: 0.8 });
        cropPlant[c.id] = p;
    }

    // --- animals -----------------------------------------------------------
    const animalNode = {};
    for (const a of world.animals) {
        const k = ANIMAL_KINDS[a.kind] || ANIMAL_KINDS.chicken;
        const base = lin(k.color), R = k.radius;
        const body = scene.createMesh({ mesh: 'sphere', x: a.x, y: R * 0.7, z: a.y, color: base, roughness: 0.85 });
        body.scaleX = R * 2; body.scaleZ = R * 2.4; body.scaleY = R * 1.5;
        animalNode[a.id] = { body, base, R };
    }

    // --- people (player, foreman, workers) ---------------------------------
    function makePerson(bodyColor) {
        const body = scene.createMesh({ mesh: 'capsule', color: bodyColor, roughness: 0.8 });
        body.scaleX = 0.62; body.scaleZ = 0.62; body.scaleY = 1.2;
        const head = scene.createMesh({ mesh: 'sphere', color: lin('#e8c9a0'), roughness: 0.7 });
        head.scaleX = 0.46; head.scaleY = 0.46; head.scaleZ = 0.46;
        return { body, head };
    }
    function placePerson(p, x, y) {
        p.body.x = x; p.body.z = y; p.body.y = 0.62;
        p.head.x = x; p.head.z = y; p.head.y = 1.32;
    }
    const playerNode  = makePerson(lin('#4a78d0'));
    const foremanNode = world.foreman ? makePerson(lin('#b5343a')) : null;
    const npcNodes = world.npcs.map((n) => makePerson(lin(ROLE_COLOR[n.role] || '#caa86a')));

    // --- in-world labels (name tags + speech bubbles) ----------------------
    // Each person carries one HtmlNode billboard floating above the head. The
    // surface is bottom-anchored: the name pill sits just over the head and a
    // speech bubble (when live) grows upward into the empty space above. We
    // only re-rasterize (setHtml) when the rendered string actually changes,
    // and just move the worldAnchor each frame.
    const LABEL = { w: 360, h: 150, ppu: 88 };   // ~4.1 × 1.7 world units
    const LABEL_Y = 1.6 + (LABEL.h / LABEL.ppu) / 2;   // head-top + half surface
    function makeLabel(accent) {
        const node = scene.createHtmlNode({
            width: LABEL.w, height: LABEL.h, pxPerUnit: LABEL.ppu,
            worldAnchor: [0, LABEL_Y, 0], billboard: 'full', html: '',
        });
        return { node, accent, last: null };
    }
    function pillHTML(name, accent) {
        return `<div style="display:inline-block;padding:3px 11px;border-radius:8px;`
            + `background:rgba(20,22,28,0.72);border:2px solid ${accent};`
            + `color:#fff;font:600 30px sans-serif;white-space:nowrap;`
            + `text-shadow:0 1px 2px #000">${esc(name)}</div>`;
    }
    function bubbleHTML(text) {
        return `<div style="max-width:300px;margin-bottom:7px;padding:6px 12px;`
            + `border-radius:11px;background:rgba(250,250,245,0.96);`
            + `border:2px solid rgba(0,0,0,0.35);color:#1a1a1a;`
            + `font:500 26px sans-serif;line-height:1.15;text-align:center">`
            + `${esc(text)}</div>`;
    }
    function wrap(inner) {
        return `<div style="display:flex;flex-direction:column;align-items:center;`
            + `justify-content:flex-end;width:${LABEL.w}px;height:${LABEL.h}px;`
            + `font-family:sans-serif">${inner}</div>`;
    }
    // Build the label HTML for a person: a name pill, plus a speech bubble when
    // a line is live, plus a small ⚠ on the pill for a worker in critical need.
    // Detailed status (stamina / station / state) lives in the side panel, so we
    // deliberately keep the in-world tag minimal to avoid clutter.
    function personLabelHTML(p, kind, now) {
        let s = '';
        if (p.speech && now < p.speech.until && p.speech.text)
            s += bubbleHTML(p.speech.text);
        const accent = kind === 'player' ? '#4a78d0'
                     : kind === 'foreman' ? '#b5343a'
                     : (ROLE_COLOR[p.role] || '#caa86a');
        let name = p.name || (kind === 'player' ? 'You' : '?');
        if (kind === 'worker') {
            const crit = (p.hydration != null && p.hydration < WORKER.thirsty)
                || (p.energy != null && p.energy < WORKER.hungry)
                || (p.stamina != null && p.stamina < WORKER.exhausted)
                || (p.health != null && p.health < WORKER.healthForce);
            if (crit) name += ' ⚠';
        }
        s += pillHTML(name, accent);
        return wrap(s);
    }
    function updateLabel(lbl, p, kind, now) {
        if (!p) { lbl.node.visible = false; return; }
        lbl.node.visible = true;
        lbl.node.worldAnchor = [p.x, LABEL_Y, p.y];
        const html = personLabelHTML(p, kind, now);
        if (html !== lbl.last) { lbl.node.setHtml(html); lbl.last = html; }
    }
    const playerLabel  = makeLabel('#4a78d0');
    const foremanLabel = world.foreman ? makeLabel('#b5343a') : null;
    const npcLabels = world.npcs.map((n) => makeLabel(ROLE_COLOR[n.role] || '#caa86a'));

    // --- static region name labels (orientation) ---------------------------
    // One floating tag over each building / pen / field so the board reads at a
    // glance. Placed above the tallest geometry in that footprint.
    const REGION_LABEL_Y = {
        farmhouse: 3.0, barn: 3.4, silo: 5.2, well: 1.4,
        field: 0.5, pen: 0.5,
    };
    for (const r of REGIONS) {
        if (!r.label) continue;
        const b = regionBox(r);
        const y = REGION_LABEL_Y[r.type] != null ? REGION_LABEL_Y[r.type] : 1.5;
        const building = r.type !== 'field' && r.type !== 'pen';
        const accent = building ? 'rgba(255,255,255,0.5)' : 'rgba(255,236,180,0.55)';
        const col = building ? '#ffffff' : '#ffe9b0';
        scene.createHtmlNode({
            width: 360, height: 70, pxPerUnit: 110,
            worldAnchor: [b.cx, y, b.cz], billboard: 'full',
            html: `<div style="display:flex;align-items:center;justify-content:center;`
                + `width:360px;height:70px;font-family:sans-serif">`
                + `<div style="padding:3px 14px;border-radius:9px;`
                + `background:rgba(20,22,28,0.5);border:2px solid ${accent};`
                + `color:${col};font:600 30px sans-serif;white-space:nowrap;`
                + `text-shadow:0 1px 3px #000">${esc(r.label)}</div></div>`,
        });
    }

    // --- per-frame camera ---------------------------------------------------
    function updateCamera(W, H) {
        const aspect = (W && H) ? W / H : 1100 / 760;
        scene.setCamera({
            mode: 'orthographic', size: CAM.view, aspect, near: 0.1, far: 400,
            position: [CX + CAM.dist, CAM.height, CZ + CAM.dist],
            target: [CX, 0, CZ], up: [0, 1, 0],
        });
    }

    // --- per-frame day/night -----------------------------------------------
    function updateDayNight(world) {
        const hour = world.clock.hour + world.clock.minute / 60;
        let night;
        if (hour < 5 || hour >= 21) night = 1;
        else if (hour < 7) night = (7 - hour) / 2;
        else if (hour > 19) night = (hour - 19) / 2;
        else night = 0;
        night = clamp01(night);

        const dayT = clamp01((hour - 6) / 12);          // 0 at 06:00, 1 at 18:00
        const az = Math.PI * dayT;                       // sun arc E->W
        sun.direction = [-Math.cos(az) * 0.6, -Math.max(0.28, Math.sin(az)), -0.42];
        const shoulder = (hour < 8 || hour > 17) && night < 0.95;  // dawn/dusk warmth
        sun.color = night > 0.5 ? [0.55, 0.62, 0.95]
                  : shoulder    ? [1.0, 0.82, 0.6]
                  :               [1.0, 0.97, 0.9];
        sun.intensity = lerp(3.3, 0.5, night);
        scene.setAmbient([lerp(0.30, 0.10, night), lerp(0.33, 0.13, night), lerp(0.40, 0.24, night)]);
    }

    // --- per-frame crop visuals --------------------------------------------
    function updateCrop(p, c) {
        if (c.stage === 'empty') { p.visible = false; return; }
        p.visible = true;
        if (c.stage === 'ripe') {
            const ck = CROP_KINDS[c.kind];
            p.color = lin((ck && ck.color) || COLORS.cropWheat);
            p.scaleX = 0.5; p.scaleZ = 0.5; p.scaleY = 0.6; p.y = 0.34;
        } else {
            const g = clamp01((c.growth || 0) / 100);
            const h = 0.18 + g * 0.6;
            p.color = lin(COLORS.cropSprout);
            p.scaleX = 0.16; p.scaleZ = 0.16; p.scaleY = h; p.y = 0.06 + h / 2;
        }
    }

    // --- the frame ----------------------------------------------------------
    function frame(world, W, H) {
        updateCamera(W, H);
        updateDayNight(world);

        for (const c of world.crops) { const p = cropPlant[c.id]; if (p) updateCrop(p, c); }

        for (const t of Object.values(world.troughs)) {
            const f = troughFill[t.id]; if (!f) continue;
            const h = Math.max(0.02, (t.fill / 100) * 0.26);
            f.scaleY = h; f.y = 0.05 + h / 2;
        }

        for (const a of world.animals) {
            const n = animalNode[a.id]; if (!n) continue;
            const alive = a.alive !== false;
            n.body.visible = alive;
            if (!alive) continue;
            n.body.x = a.x; n.body.z = a.y;
            const need = Math.max(a.hunger || 0, a.thirst || 0);
            const t = clamp01((need - 50) / 50);
            n.body.color = mix(n.base, lin(COLORS.needHigh), t * 0.6);
        }

        const now = world.clock.t;
        if (world.player) placePerson(playerNode, world.player.x, world.player.y);
        if (foremanNode && world.foreman) placePerson(foremanNode, world.foreman.x, world.foreman.y);
        for (let i = 0; i < world.npcs.length; i++) {
            const n = world.npcs[i]; placePerson(npcNodes[i], n.x, n.y);
        }

        // floating labels follow their actor and re-rasterize only on change
        updateLabel(playerLabel, world.player, 'player', now);
        if (foremanLabel) updateLabel(foremanLabel, world.foreman, 'foreman', now);
        for (let i = 0; i < world.npcs.length; i++)
            updateLabel(npcLabels[i], world.npcs[i], 'worker', now);
    }

    // --- screen -> tile picking (ground-plane intersect) -------------------
    // unprojectLocal expects pixels in the canvas element's LAYOUT space (the
    // scene sizes its viewport from the element's content box, not the canvas's
    // 300x150 default backing store) — so feed it client coords relative to the
    // element rect, with no rescale into canvas.width/height.
    function pickClient(clientX, clientY, canvas, W, H) {
        const rect = canvas.getBoundingClientRect();
        const lx = clientX - rect.left;
        const ly = clientY - rect.top;
        const r = scene.unprojectLocal(lx, ly);
        if (!r) return null;
        const o = r.origin, d = r.dir;
        if (Math.abs(d[1]) < 1e-6) return null;
        const t = -o[1] / d[1];
        if (t < 0) return null;
        return { x: o[0] + d[0] * t, y: o[2] + d[2] * t };   // (worldX, worldZ) == (tileX, tileY)
    }

    // --- world -> screen projection ----------------------------------------
    // Forward of pickClient: project a world point to a client (CSS) pixel via
    // the live view+projection. Used to pick PEOPLE by where their body actually
    // appears, which the flat ground-plane pick can't do (a tall figure draws
    // well above its foot tile). Returns null if behind the camera.
    function m4v(m, v) {           // column-major 4x4 * vec4
        return [
            m[0] * v[0] + m[4] * v[1] + m[8]  * v[2] + m[12] * v[3],
            m[1] * v[0] + m[5] * v[1] + m[9]  * v[2] + m[13] * v[3],
            m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3],
            m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3],
        ];
    }
    function worldToScreen(wx, wy, wz, canvas) {
        const view = scene.viewMatrix, proj = scene.projectionMatrix;
        if (!view || !proj) return null;
        const c = m4v(proj, m4v(view, [wx, wy, wz, 1]));
        const w = c[3];
        if (w < 0) return null;                       // behind a perspective eye
        const iw = (w === 0) ? 1 : w;                 // ortho: w == 1
        const ndcx = c[0] / iw, ndcy = c[1] / iw;
        const rect = canvas.getBoundingClientRect();
        return [rect.left + (ndcx * 0.5 + 0.5) * rect.width,
                rect.top + (1 - (ndcy * 0.5 + 0.5)) * rect.height];
    }

    return { frame, pickClient, worldToScreen, ground };
}
