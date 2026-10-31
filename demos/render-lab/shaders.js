// shaders.js — three custom brokernel (.bk) effects compiled into the PBR mesh program.
//
// `setShader` is NOT "replace the shader". You hand the engine a brokernel
// `hook` module and brass compiles it alongside whichever mesh program the
// node needs (static / skinned / instanced), so custom code composes with
// everything the material system already does: textures, the light loop,
// shadows, IBL and probes, fog, tonemap. The contract, from docs/scene-nodes-api.js:
//
//   pub fn vertex(v: mesh::Vertex) -> mesh::Vertex
//       Runs in OBJECT space, after skinning and wind sway, before the camera
//       transforms. Displace `v.pos` and the world position, lighting, fog and
//       shadows all track it — the depth-only shadow pass runs `vertex` too,
//       so a displaced static mesh casts its DISPLACED silhouette.
//
//   pub fn fragment(v: mesh::Vertex, s: mesh::Surface) -> mesh::Surface
//       Runs after every material input is gathered and BEFORE the light loop,
//       so what you return in `Surface` is what standard PBR shades.
//       `s.normal` here is world-space (renormalized after the hook).
//
// Available to both hooks: `v.world_pos` (camera-RELATIVE world position),
// `v.normal`, `v.uv`, `v.color`, `v.tangent`, `v.user0..2`, and engine modules
// like `scene::camera`. Your own uniforms are fields of a `@binding(4, 0)`
// uniform struct (`setShaderUniform` writes them by field name).
//
// Two sharp edges this file is shaped around:
//
//   1. `v.world_pos` is CAMERA-RELATIVE. Any pattern keyed off it swims when the
//      camera moves. The dissolve therefore keys off `v.uv`, which is stable in
//      object space and needs no vertex hook at all.
//
//   2. A vertex hook also runs in the depth-only shadow pass, so the wave's
//      shadow ripples with the geometry — that displaced shadow is half the
//      demonstration.
//
// Also true, and worth stating because it is the usual next question: the same
// module works on SkinnedMeshNode and InstancedMeshNode — the engine compiles
// a program variant per pipeline. No skinned mesh is built here; that belongs
// to demos/anim-lab. Instanced meshes run their hook in mesh-local space
// before the per-instance transform.
//
// Culling cannot see shader displacement, so every displacing node sets
// `cullMargin` to its maximum displacement — otherwise a node whose geometry
// has been pushed outside its AABB gets culled while still plainly on screen.

// --- effect A: dissolve / burn ----------------------------------------------
// A hash-noise threshold with an emissive edge just above it. `discard_fragment()`
// is the honest way to punch holes: alpha would need a blend pass the lit path
// does not run for opaque meshes. The edge is a smoothstep band that rides the
// threshold, so sweeping `diss` walks a burning front across the surface.
//
// Fragment-only, on purpose — which means the SHADOW keeps the solid
// silhouette. That is a real limitation of the fragment hook (the shared
// default shadow program has no idea about the discard), and it is visible in
// the app: dissolve the monolith to 0.9 and its shadow stays whole.

const DISSOLVE_MODULE = `
module hook;
import mesh;

struct Params {
    diss:  f32,     // 0 = solid, 1 = fully burned away
    edge:  f32,     // width of the glowing front
    scale: f32,     // noise cells across the UV sheet
    _pad:  f32,
    burn:  vec3<f32>, // edge colour (HDR — it is meant to bloom)
}
@binding(4, 0) var params: uniform<Params>;

fn hash21(p: vec2<f32>) -> f32 {
    return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453123);
}

// Value noise: cheap, and the blocky character actually suits a burn front.
fn vnoise(p: vec2<f32>) -> f32 {
    let i: vec2<f32> = floor(p);
    let f0: vec2<f32> = fract(p);
    let f: vec2<f32> = f0 * f0 * (vec2<f32>(3.0) - 2.0 * f0);
    let a: f32 = hash21(i);
    let b: f32 = hash21(i + vec2<f32>(1.0, 0.0));
    let c: f32 = hash21(i + vec2<f32>(0.0, 1.0));
    let d: f32 = hash21(i + vec2<f32>(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

fn fbm(p: vec2<f32>) -> f32 {
    return vnoise(p) * 0.62 + vnoise(p * 2.03) * 0.26 + vnoise(p * 4.11) * 0.12;
}

pub fn fragment(v: mesh::Vertex, s: mesh::Surface) -> mesh::Surface {
    let n: f32 = fbm(v.uv * params.scale);
    if (n < params.diss) { discard_fragment(); }

    // 1 at the threshold, falling to 0 one edge-width above it.
    let front: f32 = 1.0 - smoothstep(params.diss, params.diss + max(params.edge, 0.0001), n);

    // Char the surface into the front, then light it. Zeroing base_color under
    // the hottest part is what makes the edge read as burning rather than as
    // a glow painted over intact material.
    var out = s;
    out.base_color = out.base_color * (1.0 - front * 0.85);
    out.roughness  = mix(out.roughness, 0.95, front);
    out.metallic   = mix(out.metallic, 0.0, front);
    out.emissive   = out.emissive + params.burn * (front * front * 7.0);
    return out;
}`;

// --- effect B: vertex-displacement wave --------------------------------------
// Two crossed travelling sines on a densely subdivided plane. The normal is
// rebuilt from the analytic derivative of the same expression, which is the
// part that proves the hook really runs before lighting: with the normal left
// alone the surface ripples but shades flat, and the difference is obvious the
// moment you drag the amplitude.

const WAVE_MODULE = `
module hook;
import mesh;

struct Params {
    amp:   f32,
    freq:  f32,
    speed: f32,
    time:  f32,
}
@binding(4, 0) var params: uniform<Params>;

pub fn vertex(v: mesh::Vertex) -> mesh::Vertex {
    var out = v;
    let px: f32 = out.pos.x * params.freq + params.time * params.speed;
    let pz: f32 = out.pos.z * params.freq * 0.78 - params.time * params.speed * 0.61;

    out.pos.y += sin(px) * cos(pz) * params.amp;

    // d/dx and d/dz of the displacement above; the surface normal of a height
    // field y = h(x,z) is normalize(-dh/dx, 1, -dh/dz).
    let dx: f32 =  cos(px) * cos(pz) * params.amp * params.freq;
    let dz: f32 = -sin(px) * sin(pz) * params.amp * params.freq * 0.78;
    out.normal = normalize(vec3<f32>(-dx, 1.0, -dz));
    return out;
}`;

// --- effect C: fresnel rim + scanline emissive -------------------------------
// The rim term needs the view vector, and v.world_pos being camera-relative is
// exactly what makes that a one-liner: the fragment's offset FROM the camera
// is v.world_pos, so the direction back to the eye is normalize(-v.world_pos).
// Scanlines scroll in UV space so they stay glued to the surface.

const RIM_MODULE = `
module hook;
import mesh;

struct Params {
    rimPow:   f32,      // fresnel falloff exponent
    rimGain:  f32,      // rim brightness
    scanFreq: f32,      // scanlines around the surface
    scanGain: f32,      // scanline brightness
    rimColor: vec3<f32>,
    time:     f32,
}
@binding(4, 0) var params: uniform<Params>;

pub fn fragment(v: mesh::Vertex, s: mesh::Surface) -> mesh::Surface {
    let view_dir: vec3<f32> = normalize(-v.world_pos);
    let fres: f32 = pow(1.0 - clamp(dot(s.normal, view_dir), 0.0, 1.0), max(params.rimPow, 0.01));

    // Slow breath on the rim so a still frame still reads as "powered".
    let pulse: f32 = 0.72 + 0.28 * sin(params.time * 1.6);

    // Hard-edged scanlines plus one bright band sweeping bottom to top.
    let lines: f32 = smoothstep(0.45, 0.55, fract(v.uv.y * params.scanFreq));
    let sweep: f32 = smoothstep(0.965, 1.0, fract(v.uv.y * 0.5 - params.time * 0.22));

    var out = s;
    out.emissive = out.emissive + params.rimColor * (fres * params.rimGain * pulse
                                                     + lines * params.scanGain * 0.12
                                                     + sweep * 2.4);
    // Interior stays dark and mirror-ish so the rim is the whole read.
    out.roughness = mix(out.roughness, 0.18, fres);
    return out;
}`;

// --- effect registry ---------------------------------------------------------

let _nodes = {};        // { dissolve, wave, rim }
let _installed = { dissolve: false, wave: false, rim: false };

/**
 * Build the three shader subjects. Each gets its own prop rather than sharing
 * the courtyard's existing geometry, because "which object is this uniform
 * driving" should never be ambiguous when four sliders are open at once.
 */
export function buildShaderProps(scene, handles) {
    // A. A bronze monolith by the left wall — a big unbroken slab of surface,
    //    which is what a dissolve needs to have anything to eat.
    _nodes.dissolve = scene.createMesh({
        mesh: 'cylinder',
        name: 'dissolveMonolith',
        radius: 0.95, halfHeight: 2.3, segments: 40,
        x: -7.4, y: 2.3, z: -2.6,
        color: '#8a6a3f', metallic: 0.55, roughness: 0.42,
    });

    // B. A curtain hung on the right half of the back wall — NOT across the
    //    avenue opening, which has to stay clear for the fog, DoF and LOD
    //    fields behind it. `rx: 90` stands the plane up, so the object-space
    //    +Y displacement becomes a billow toward and away from the camera.
    //    It hangs 0.8 units proud of the wall so the sun throws its rippling
    //    shadow onto the plaster behind it. High subdivision is mandatory: a
    //    vertex shader can only move vertices that exist, and the default
    //    plane has four.
    _nodes.wave = scene.createMesh({
        mesh: 'plane',
        name: 'waveCurtain',
        halfW: 2.45, halfD: 1.6, subdivX: 88, subdivZ: 60,
        x: 7.5, y: 4.4, z: -10.8, rx: 90,
        color: '#2f6f8c', metallic: 0.25, roughness: 0.30,
        twoSided: true,
    });
    // Max displacement is the amplitude slider's ceiling. Without this the
    // curtain is culled the moment its billow leaves the flat plane's AABB.
    _nodes.wave.cullMargin = 1.6;

    // C. A dark orb on the right, doing its best hologram.
    _nodes.rim = scene.createMesh({
        mesh: 'sphere',
        name: 'rimOrb',
        radius: 1.15, segments: 48, rings: 32,
        x: 7.6, y: 1.9, z: -2.6,
        color: '#121a24', metallic: 0.1, roughness: 0.55,
    });

    handles.shaderProps = _nodes;
    return _nodes;
}

/**
 * Install or clear each effect and push its uniforms. Gated on the master A/B
 * flag: with the stack off every custom shader is REMOVED (not zeroed), so the
 * three props visibly snap back to plain PBR — which is the cleanest possible
 * proof that the hooks compose with the standard material rather than
 * replacing it.
 */
export function applyShaders(cfg, on) {
    setEffect('dissolve', on && cfg.dissolve.enabled, { module: DISSOLVE_MODULE }, {
        diss:  cfg.dissolve.amount,
        edge:  cfg.dissolve.edge,
        scale: cfg.dissolve.scale,
        burn:  [1.0, 0.42, 0.12],
    });

    setEffect('wave', on && cfg.wave.enabled, { module: WAVE_MODULE }, {
        amp:   cfg.wave.amp,
        freq:  cfg.wave.freq,
        speed: cfg.wave.speed,
        time:  0,
    });

    setEffect('rim', on && cfg.rim.enabled, { module: RIM_MODULE }, {
        rimPow:   cfg.rim.power,
        rimGain:  cfg.rim.gain,
        scanFreq: cfg.rim.scanFreq,
        scanGain: cfg.rim.scanGain,
        rimColor: [0.30, 0.92, 1.0],
        time:     0,
    });
}

/**
 * One effect's install/clear/update cycle. `setShader` COMPILES NOW — every
 * program variant the node can render with — and throws Error carrying
 * brokernel's diagnostics on failure, leaving the node on its previous shader.
 * So the module source is only ever handed over on the install edge;
 * steady-state updates go through setShaderUniform, which is a per-node value
 * write and costs nothing.
 */
function setEffect(key, want, chunks, uniforms) {
    const node = _nodes[key];
    if (!node) return;

    if (want && !_installed[key]) {
        node.setShader(Object.assign({ uniforms }, chunks));
        _installed[key] = true;
        return;                       // uniforms went in with the install
    }
    if (!want && _installed[key]) {
        node.clearShader();
        _installed[key] = false;
        return;
    }
    if (want) {
        for (const [name, value] of Object.entries(uniforms)) {
            node.setShaderUniform(name, value);
        }
    }
}

/**
 * Drive the time-based uniforms. Kept separate from applyShaders so the HUD
 * path stays free of per-frame work, and so the smoke test can advance the
 * animation deterministically with advanceTime().
 */
export function tickShaders(cfg, on, timeSec) {
    if (on && cfg.wave.enabled && _installed.wave) {
        _nodes.wave.setShaderUniform('time', timeSec);
    }
    if (on && cfg.rim.enabled && _installed.rim) {
        _nodes.rim.setShaderUniform('time', timeSec);
    }
    // The burn front only animates when asked; otherwise the slider owns it,
    // because a hand-parked dissolve is easier to inspect than a moving one.
    if (on && cfg.dissolve.enabled && _installed.dissolve && cfg.dissolve.sweep) {
        const v = 0.5 - 0.5 * Math.cos(timeSec * 0.55);
        cfg.dissolve.amount = v;
        _nodes.dissolve.setShaderUniform('diss', v);
        return v;
    }
    return null;
}

/** Remove every custom shader — the HUD's "back to standard PBR" button. */
export function clearAllShaders() {
    for (const key of Object.keys(_nodes)) {
        if (_installed[key]) { _nodes[key].clearShader(); _installed[key] = false; }
    }
}

/** The three subjects, for tests and the HUD readout. */
export function shaderNodes() { return _nodes; }

/** Which effects currently have a program installed. */
export function shaderInstalled() { return Object.assign({}, _installed); }
