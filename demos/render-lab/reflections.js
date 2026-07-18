// reflections.js — the two reflection techniques, side by side.
//
// This module exists to make one tradeoff legible, because bro implements
// both halves of it and they compose:
//
//   SSR   marches the reflected view ray against the DEPTH BUFFER. It is
//         pixel-accurate and picks up every light, but it can only reflect
//         what is currently on screen — so reflections die at the screen
//         border (`edgeFade` hides the seam), behind the camera, and behind
//         occluders. It costs per-frame GPU time and needs nothing baked.
//
//   PROBE renders the scene into a cubemap ONCE from the box centre and
//         prefilters it. It is stable, works off-screen and behind the
//         camera, and costs nothing per frame — but it is static (six draws
//         per capture, so there is deliberately no auto-update mode), it is
//         parallax-corrected only against a box, and it misses translucents,
//         particles and other probes.
//
// The renderer composes them exactly the way the docs describe: SSR wins
// where its ray march lands a hit, and the probe (or the global IBL) is the
// natural miss fallback. That means you can watch a reflection hand off from
// SSR to probe by simply orbiting until the reflected object leaves the
// frame — which is the whole reason both toggles are independent in the HUD.
//
// One important piece of scene context: this courtyard has NO IBL
// environment. With no probe, `metallic: 1` surfaces have no specular ambient
// to sample at all, so the chrome sphere renders near-black. Turning the
// probe on is therefore not a subtle grade — it is the difference between a
// black ball and a mirror.

let _scene = null;
let _probe = null;
let _boundsNode = null;
let _mirror = null;

// The probe box: wide enough to contain the bounds centres of all three metal
// props and the smooth end of the sphere row, tall enough to sit above the
// lintel, and stopping short of the avenue so the capture is dominated by the
// courtyard rather than by fog.
const PROBE_BOX = { size: [26, 12, 22], x: 0, y: 5, z: -4 };

// --- the mirror floor --------------------------------------------------------

/**
 * Chunk 1's floor slab is metallic 0.25 / roughness 0.12 — reflective enough
 * to tint, but SSR's per-pixel weight is luminance(F0) x (1 - roughness)^2,
 * so a dielectric-ish slab only ever reflects faintly. SSR deserves a surface
 * that genuinely mirrors, so this lays a polished strip across the front of
 * the courtyard, between the sphere row (z = 0.5) and the camera.
 *
 * That placement is deliberate: from the default orbit the strip sits in the
 * lower third of the frame with the spheres and the emissive orbs directly
 * above it, which is precisely the geometry that makes SSR's screen-edge
 * failure visible — tilt down and the reflected spheres run out of screen.
 */
function buildMirrorFloor(scene) {
    return scene.createMesh({
        mesh: 'box',
        name: 'mirrorStrip',
        halfW: 8.0, halfH: 0.02, halfD: 2.1,
        x: 0, y: 0.13, z: 3.6,
        color: '#d8dde6',
        metallic: 1.0,
        roughness: 0.035,
    });
}

// --- probe bounds visualisation ----------------------------------------------

/**
 * There is no engine-side probe gizmo, so the debug view is honest geometry:
 * twelve thin emissive bars along the box edges. Emissive means they read
 * clearly against the dark courtyard and bloom slightly, and it keeps them
 * out of the lighting solution. They are built once and toggled with
 * `visible`; the probe capture excludes nothing, so they WOULD appear in a
 * capture taken while they are on — hence `setProbeBounds` hides them before
 * any recapture.
 */
function buildBoundsGizmo(scene, box) {
    const node = scene.createNode('probeBounds');
    const [sx, sy, sz] = box.size;
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const T = 0.05;                                  // bar half-thickness

    const bar = (o) => {
        const b = scene.createMesh(Object.assign({
            mesh: 'box', color: '#ffffff', metallic: 0, roughness: 1.0,
            emissive: 2.2, emissiveColor: [0.35, 1.0, 0.75],
        }, o));
        node.add(b);
        return b;
    };

    // 4 edges along X, 4 along Y, 4 along Z.
    for (const y of [-hy, hy]) for (const z of [-hz, hz])
        bar({ halfW: hx, halfH: T, halfD: T, x: 0, y, z });
    for (const x of [-hx, hx]) for (const z of [-hz, hz])
        bar({ halfW: T, halfH: hy, halfD: T, x, y: 0, z });
    for (const x of [-hx, hx]) for (const y of [-hy, hy])
        bar({ halfW: T, halfH: T, halfD: hz, x, y, z: 0 });

    node.x = box.x; node.y = box.y; node.z = box.z;
    node.visible = false;
    return node;
}

// --- probe lifecycle ---------------------------------------------------------

/**
 * Probes are created and destroyed rather than dimmed, because "probe off"
 * should mean the meshes fall back to the global environment — which is what
 * `destroy()` restores. Setting `intensity` to 0 would leave the meshes bound
 * to a probe contributing nothing, a subtly different (and less honest)
 * picture of what a probe does.
 */
function createProbe(cfg) {
    const p = _scene.createReflectionProbe({
        name: 'courtyardProbe',
        x: PROBE_BOX.x, y: PROBE_BOX.y, z: PROBE_BOX.z,
        size: PROBE_BOX.size,
        resolution: cfg.resolution,
        updateMode: 'once',        // captures on its first visible frame
        boxProjection: cfg.boxProjection,
        intensity: cfg.intensity,
        interior: cfg.interior,
        priority: 0,
    });
    return p;
}

/** Ask the probe to re-render its cubemap on the next frame. */
export function recaptureProbe() {
    if (!_probe) return false;
    // The gizmo would otherwise be baked into the reflection as glowing bars.
    const wasVisible = _boundsNode && _boundsNode.visible;
    if (wasVisible) _boundsNode.visible = false;
    _probe.capture();
    if (wasVisible) _boundsNode.visible = true;
    return true;
}

/** Toggle the debug wireframe of the probe volume. */
export function setProbeBounds(on) {
    if (_boundsNode) _boundsNode.visible = !!on;
}

/** True while a probe node exists — the smoke test asserts on this. */
export function probeActive() {
    return _probe !== null;
}

/** The live probe node, or null. */
export function probeNode() {
    return _probe;
}

// --- apply -------------------------------------------------------------------

/**
 * Push probe state. Gated on the master A/B flag like every other effect, so
 * flipping the stack off drops the chrome sphere back to near-black — a blunt
 * but truthful demonstration of what the probe is contributing.
 */
export function applyProbe(scene, cfg, on) {
    const want = on && cfg.enabled;

    if (want && !_probe) {
        _probe = createProbe(cfg);
    } else if (!want && _probe) {
        _probe.destroy();
        _probe = null;
    }

    if (_probe) {
        // Live properties — no recapture needed for any of these.
        _probe.intensity = cfg.intensity;
        _probe.interior = cfg.interior;
        _probe.boxProjection = cfg.boxProjection;
        // `resolution` only takes effect on the next capture, so a change here
        // has to ask for one explicitly.
        if (_probe.resolution !== cfg.resolution) {
            _probe.resolution = cfg.resolution;
            recaptureProbe();
        }
    }

    setProbeBounds(want && cfg.showBounds);

    const n = document.getElementById('probeStatus');
    if (n) n.textContent = _probe ? 'captured' : 'off — metals fall back to IBL';
}

/** Push SSR state. Every documented parameter is on the HUD. */
export function applySSR(scene, cfg, on) {
    if (on && cfg.enabled) {
        scene.setSSR({
            enabled: true,
            maxDistance: cfg.maxDistance,
            steps: cfg.steps,
            thickness: cfg.thickness,
            intensity: cfg.intensity,
            edgeFade: cfg.edgeFade,
        });
    } else {
        scene.setSSR({ enabled: false });
    }
}

// --- setup -------------------------------------------------------------------

/**
 * Build everything reflection-related that is scene geometry rather than
 * render state. Called from app.js after buildScene and BEFORE bindHud, so
 * the HUD's first applyPost has real nodes to talk to.
 */
export function buildReflectionRig(scene, handles) {
    _scene = scene;
    _mirror = buildMirrorFloor(scene);
    _boundsNode = buildBoundsGizmo(scene, PROBE_BOX);
    handles.mirrorStrip = _mirror;
    handles.probeBox = PROBE_BOX;
    return { mirror: _mirror, box: PROBE_BOX };
}
