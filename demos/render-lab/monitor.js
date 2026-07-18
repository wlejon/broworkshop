// monitor.js — a second scene, rendered to a texture, mapped onto a surface.
//
// `scene.asTexture()` hands back a LIVE handle to that scene's rendered output
// — the post-tonemap LDR texture, exactly the pixels its canvas composites —
// and `node.setBaseColorTexture(handle)` installs it as another scene's
// baseColor map. The link re-resolves every frame, so it survives canvas
// resizes and renderScale changes that recreate the underlying GL texture, and
// it is non-owning: destroy the source canvas and consumers quietly fall back
// to their plain `color`.
//
// The one rule with teeth is ORDERING. Scenes render once per frame in
// getContext('scene') creation order, so a consumer created BEFORE its source
// samples last frame's output — one frame of latency, with no reordering API
// to fix it afterwards. That is why the sub-scene context is grabbed at MODULE
// scope here: ES module bodies evaluate before the importing module's body, so
// this context exists before app.js ever calls getContext on the stage canvas,
// and the courtyard samples the sub-scene's CURRENT frame.
//
// (A scene may also sample itself. Lit meshes give the classic one-frame video
// feedback; unlit meshes would be a real GL feedback loop, so the renderer
// draws those untextured instead. Not used here — a genuinely separate scene
// makes a better monitor.)

// Module-scope on purpose — see the ordering note above.
const subCanvas = document.getElementById('subscene');
const sub = subCanvas.getContext('scene');

let _spinner = null;
let _ring = null;
let _sats = [];
let _monitor = null;
let _bezel = null;
let _light = null;
let _texture = null;
let _linked = false;

// --- the sub-scene ------------------------------------------------------------

/**
 * Contents chosen to be unmistakably LIVE at a glance: a fast spinning torus,
 * three satellites on their own orbit, and a saturated backdrop. A still image
 * of a nice 3D object proves nothing about asTexture — motion does.
 */
function buildSubScene() {
    sub.setCamera({
        position: [0, 1.6, 5.2],
        target: [0, 0, 0],
        fov: 52, near: 0.1, far: 40,
    });

    // A flat coloured wall behind everything so the monitor never shows the
    // clear colour of the courtyard and get mistaken for a hole in the wall.
    sub.createMesh({
        mesh: 'plane', halfW: 9, halfD: 6,
        y: 0, z: -3, rx: 90,
        color: '#101d33', metallic: 0, roughness: 1.0,
    });

    _spinner = sub.createMesh({
        mesh: 'torus',
        majorRadius: 1.25, minorRadius: 0.38,
        majorSegments: 48, minorSegments: 20,
        x: 0, y: 0.1, z: 0,
        color: '#ff8a3d', metallic: 0.9, roughness: 0.22,
        emissive: 0.35, emissiveColor: [1.0, 0.45, 0.12],
    });

    _ring = sub.createMesh({
        mesh: 'torus',
        majorRadius: 2.05, minorRadius: 0.06,
        majorSegments: 64, minorSegments: 8,
        x: 0, y: 0.1, z: 0, rx: 74,
        color: '#ffffff', metallic: 0, roughness: 1.0,
        emissive: 1.6, emissiveColor: [0.4, 0.95, 1.0],
    });

    for (let i = 0; i < 3; ++i) {
        _sats.push(sub.createMesh({
            mesh: 'box', halfW: 0.17, halfH: 0.17, halfD: 0.17,
            color: '#ffffff', metallic: 0, roughness: 1.0,
            emissive: 2.6, emissiveColor: [1.0, 0.85, 0.35],
        }));
    }

    sub.createLight({
        type: 'directional',
        position: [3, 6, 4], direction: [-0.4, -1.0, -0.5],
        color: [1.0, 0.96, 0.9], intensity: 3.6, name: 'subSun',
    });
    sub.createLight({
        type: 'point',
        position: [-2.5, 1.0, 2.5],
        color: [0.35, 0.7, 1.0], intensity: 14, range: 12, name: 'subFill',
    });

    // The sub-scene gets its OWN post stack — it is an independent graph, not
    // a slave of the courtyard's grade. Restrained on purpose, though: the
    // monitor is a small, LIT rectangle sampled into a
    // second tonemap, so a sub-scene graded for a full screen blows out to a
    // white smear by the time it reaches the courtyard wall.
    sub.setAmbient([0.06, 0.07, 0.10]);
    sub.setToneMap({ mode: 'aces', exposure: 0.9, gamma: 2.2 });
    sub.setBloom({ enabled: true, threshold: 1.2, intensity: 0.45, strength: 2.0 });
}

// --- the receiving surface ----------------------------------------------------

/**
 * A screen bolted to the left half of the courtyard's back wall (that segment
 * spans x = -12..-3 with its front face at z = -11.6), plus a bezel behind it
 * and a small practical in front. The practical matters: the sampled texture
 * is a baseColor MAP, which means it is lit like any other albedo — with no
 * light on it the monitor is a dark rectangle no matter how bright the
 * sub-scene is. Emissive would be the alternative, but emissive does not
 * sample the base map, so a light is the honest fix.
 */
function buildMonitorSurface(scene) {
    _bezel = scene.createMesh({
        mesh: 'box',
        name: 'monitorBezel',
        halfW: 2.62, halfH: 1.72, halfD: 0.1,
        x: -7.5, y: 4.4, z: -11.68,
        color: '#15181d', metallic: 0.3, roughness: 0.5,
    });

    // `rx: 90` stands the plane up and points its +Y normal down +Z, into the
    // courtyard. halfW is the screen's width, halfD becomes its height.
    _monitor = scene.createMesh({
        mesh: 'plane',
        name: 'monitorScreen',
        halfW: 2.45, halfD: 1.55, subdivX: 1, subdivZ: 1,
        x: -7.5, y: 4.4, z: -11.55, rx: 90, ry: 180,
        color: '#ffffff',              // white factor = texture pass-through
        metallic: 0.0, roughness: 0.55,
        twoSided: true,
    });

    _light = scene.createLight({
        type: 'point',
        position: [-7.5, 4.4, -9.2],
        color: [0.85, 0.92, 1.0], intensity: 9, range: 9,
        name: 'monitorGlow',
    });
}

// --- link ---------------------------------------------------------------------

/**
 * Attach or detach the live texture. Detaching is `setBaseColorTexture(null)`,
 * which drops the mesh back to its plain `color` — the flat white panel it was
 * created as. "Monitor off" is therefore visibly the same object with its feed
 * pulled, not a hidden node, which is the distinction the toggle exists to
 * show. The panel is deliberately left white either way — re-tinting it to
 * fake a dark screen would blur exactly that point — so the practical light in
 * front dims instead and the panel stays the same object throughout.
 */
export function setMonitorLinked(on) {
    if (!_monitor) return false;
    if (on && !_linked) {
        _texture = sub.asTexture();
        if (!_texture) return false;
        _monitor.setBaseColorTexture(_texture);
        _linked = true;
    } else if (!on && _linked) {
        _monitor.setBaseColorTexture(null);
        _linked = false;
    }
    if (_light) _light.intensity = on ? 9 : 2;
    return _linked;
}

/**
 * Sub-scene render scale. This is the "resolution" control the API actually
 * offers: the sub-scene's target is sized from its canvas box, and
 * setRenderScale multiplies that (clamped 0.25..2.0). Drop it to 0.25 and the
 * monitor image goes chunky while the courtyard stays sharp — proof the two
 * scenes own separate render targets. The live link re-resolves the texture
 * every frame, so it survives the target being recreated underneath it.
 */
export function setSubRenderScale(s) {
    sub.setRenderScale(s);
    return sub.renderScale;
}

/** Advance the sub-scene animation. Driven from the main frame loop. */
export function tickMonitor(timeSec) {
    if (!_spinner) return;
    _spinner.ry = (timeSec * 62) % 360;
    _spinner.rx = 22 + Math.sin(timeSec * 0.8) * 18;
    _ring.ry = (-timeSec * 38) % 360;
    for (let i = 0; i < _sats.length; ++i) {
        const a = timeSec * 1.3 + (i * Math.PI * 2) / _sats.length;
        _sats[i].x = Math.cos(a) * 2.05;
        _sats[i].z = Math.sin(a) * 2.05;
        _sats[i].y = 0.1 + Math.sin(a * 2.0) * 0.75;
    }
}

// --- setup --------------------------------------------------------------------

/**
 * Build both halves and link them. Called from app.js after buildScene, but
 * note that the sub-scene CONTEXT already exists by then (module scope) — only
 * its contents are built here.
 */
export function buildMonitor(scene, handles) {
    buildSubScene();
    buildMonitorSurface(scene);
    setMonitorLinked(true);
    handles.monitor = { screen: _monitor, bezel: _bezel, sub };
    return handles.monitor;
}

/** The sub-scene graph — the test drives it directly. */
export function subScene() { return sub; }

/** The receiving mesh in the main scene. */
export function monitorNode() { return _monitor; }

/** True while the live texture link is installed. */
export function monitorLinked() { return _linked; }

/** The live SceneTexture handle, or null. */
export function monitorTexture() { return _linked ? _texture : null; }
