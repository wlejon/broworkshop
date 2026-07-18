// shaders.js — three custom GLSL effects spliced into the PBR uber-shader.
//
// `setShader` is NOT "replace the shader". You hand the engine two function
// BODIES and it splices them into whichever mesh program the node needs
// (static / skinned / instanced), so custom code composes with everything the
// material system already does: textures, the light loop, shadows, IBL and
// probes, fog, tonemap. The contract, verbatim from docs/scene-api.js:
//
//   void userVertex(inout vec3 pos, inout vec3 normal, inout vec2 uv)
//       Runs in OBJECT space, after skinning and wind sway, before the camera
//       transforms. Displace `pos` and the world position, lighting, fog and
//       shadows all track it — the depth-only shadow pass runs userVertex too,
//       so a displaced static mesh casts its DISPLACED silhouette.
//
//   void userFragment(inout vec3 baseColor, inout vec3 normal,
//                     inout float metallic, inout float roughness,
//                     inout vec3 emissive, inout float alpha)
//       Runs after every material input is gathered and BEFORE the light loop,
//       so what you write into those six values is what standard PBR shades.
//       `normal` here is world-space (renormalized after the hook).
//
// Available to both chunks: engine varyings vWorldPos (camera-RELATIVE world
// position), vNormal, vUV, vColor, vCamDist, and engine uniforms like
// uWindTime. Your own uniforms must live in the reserved `u_` namespace and be
// numeric (float / vec2 / vec3 / vec4 — samplers are not supported yet); your
// own varyings must live in the reserved `v_` namespace.
//
// Two sharp edges this file is shaped around:
//
//   1. vWorldPos is CAMERA-RELATIVE. Any pattern keyed off it swims when the
//      camera moves. The dissolve therefore keys off vUV, which is stable in
//      object space and needs no vertex chunk at all.
//
//   2. A vertex chunk that references a varying IT declares makes the shadow
//      pass fall back to the undisplaced silhouette (with a log warning),
//      because that symbol does not exist in the depth-only program. The wave
//      below deliberately declares NO custom varying so its shadow ripples
//      with the geometry — that displaced shadow is half the demonstration.
//
// Also true, and worth stating because it is the usual next question: the same
// chunk pair works on SkinnedMeshNode and InstancedMeshNode — the engine
// compiles a program variant per pipeline. No skinned mesh is built here;
// that belongs to demos/anim-lab. Instanced meshes cast UNdisplaced shadows,
// and their hook runs in mesh-local space before the per-instance transform.
//
// Culling cannot see GLSL, so every displacing node sets `cullMargin` to its
// maximum displacement — otherwise a node whose geometry has been pushed
// outside its AABB gets culled while still plainly on screen.

// --- effect A: dissolve / burn ----------------------------------------------
// A hash-noise threshold with an emissive edge just above it. `discard` is the
// honest way to punch holes: alpha would need a blend pass the lit path does
// not run for opaque meshes. The edge is a smoothstep band that rides the
// threshold, so sweeping u_diss walks a burning front across the surface.
//
// Fragment-only, on purpose — which means the SHADOW keeps the solid
// silhouette. That is a real limitation of the fragment hook (the shared
// default shadow program has no idea about the discard), and it is visible in
// the app: dissolve the monolith to 0.9 and its shadow stays whole.

const DISSOLVE_FRAG = `
uniform float u_diss;     // 0 = solid, 1 = fully burned away
uniform float u_edge;     // width of the glowing front
uniform float u_scale;    // noise cells across the UV sheet
uniform vec3  u_burn;     // edge colour (HDR — it is meant to bloom)

float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// Value noise: cheap, and the blocky character actually suits a burn front.
float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
    return vnoise(p) * 0.62 + vnoise(p * 2.03) * 0.26 + vnoise(p * 4.11) * 0.12;
}

void userFragment(inout vec3 baseColor, inout vec3 normal,
                  inout float metallic, inout float roughness,
                  inout vec3 emissive, inout float alpha) {
    float n = fbm(vUV * u_scale);
    if (n < u_diss) discard;

    // 1 at the threshold, falling to 0 one edge-width above it.
    float front = 1.0 - smoothstep(u_diss, u_diss + max(u_edge, 1e-4), n);

    // Char the surface into the front, then light it. Zeroing baseColor under
    // the hottest part is what makes the edge read as burning rather than as
    // a glow painted over intact material.
    baseColor *= (1.0 - front * 0.85);
    roughness = mix(roughness, 0.95, front);
    metallic  = mix(metallic, 0.0, front);
    emissive += u_burn * front * front * 7.0;
}`;

// --- effect B: vertex-displacement wave --------------------------------------
// Two crossed travelling sines on a densely subdivided plane. The normal is
// rebuilt from the analytic derivative of the same expression, which is the
// part that proves the hook really runs before lighting: with the normal left
// alone the surface ripples but shades flat, and the difference is obvious the
// moment you drag the amplitude.

const WAVE_VERT = `
uniform float u_amp;
uniform float u_freq;
uniform float u_speed;
uniform float u_time;

void userVertex(inout vec3 pos, inout vec3 normal, inout vec2 uv) {
    float px = pos.x * u_freq + u_time * u_speed;
    float pz = pos.z * u_freq * 0.78 - u_time * u_speed * 0.61;

    pos.y += sin(px) * cos(pz) * u_amp;

    // d/dx and d/dz of the displacement above; the surface normal of a height
    // field y = h(x,z) is normalize(-dh/dx, 1, -dh/dz).
    float dx =  cos(px) * cos(pz) * u_amp * u_freq;
    float dz = -sin(px) * sin(pz) * u_amp * u_freq * 0.78;
    normal = normalize(vec3(-dx, 1.0, -dz));
}`;

// --- effect C: fresnel rim + scanline emissive -------------------------------
// The rim term needs the view vector, and vWorldPos being camera-relative is
// exactly what makes that a one-liner: the fragment's offset FROM the camera
// is vWorldPos, so the direction back to the eye is normalize(-vWorldPos).
// Scanlines scroll in UV space so they stay glued to the surface.

const RIM_FRAG = `
uniform float u_rimPow;     // fresnel falloff exponent
uniform float u_rimGain;    // rim brightness
uniform float u_scanFreq;   // scanlines around the surface
uniform float u_scanGain;   // scanline brightness
uniform float u_time;
uniform vec3  u_rimColor;

void userFragment(inout vec3 baseColor, inout vec3 normal,
                  inout float metallic, inout float roughness,
                  inout vec3 emissive, inout float alpha) {
    vec3 V = normalize(-vWorldPos);
    float fres = pow(1.0 - clamp(dot(normal, V), 0.0, 1.0), max(u_rimPow, 0.01));

    // Slow breath on the rim so a still frame still reads as "powered".
    float pulse = 0.72 + 0.28 * sin(u_time * 1.6);

    // Hard-edged scanlines plus one bright band sweeping bottom to top.
    float lines = smoothstep(0.45, 0.55, fract(vUV.y * u_scanFreq));
    float sweep = smoothstep(0.965, 1.0, fract(vUV.y * 0.5 - u_time * 0.22));

    emissive += u_rimColor * (fres * u_rimGain * pulse
                              + lines * u_scanGain * 0.12
                              + sweep * 2.4);
    // Interior stays dark and mirror-ish so the rim is the whole read.
    roughness = mix(roughness, 0.18, fres);
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
    setEffect('dissolve', on && cfg.dissolve.enabled, { fragment: DISSOLVE_FRAG }, {
        u_diss:  cfg.dissolve.amount,
        u_edge:  cfg.dissolve.edge,
        u_scale: cfg.dissolve.scale,
        u_burn:  [1.0, 0.42, 0.12],
    });

    setEffect('wave', on && cfg.wave.enabled, { vertex: WAVE_VERT }, {
        u_amp:   cfg.wave.amp,
        u_freq:  cfg.wave.freq,
        u_speed: cfg.wave.speed,
        u_time:  0,
    });

    setEffect('rim', on && cfg.rim.enabled, { fragment: RIM_FRAG }, {
        u_rimPow:   cfg.rim.power,
        u_rimGain:  cfg.rim.gain,
        u_scanFreq: cfg.rim.scanFreq,
        u_scanGain: cfg.rim.scanGain,
        u_rimColor: [0.30, 0.92, 1.0],
        u_time:     0,
    });
}

/**
 * One effect's install/clear/update cycle. `setShader` COMPILES NOW — every
 * program variant the node can render with — and throws SyntaxError carrying
 * the driver log on failure, leaving the node on its previous shader. So the
 * chunk source is only ever handed over on the install edge; steady-state
 * updates go through setShaderUniform, which is a per-node value write and
 * costs nothing.
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
        _nodes.wave.setShaderUniform('u_time', timeSec);
    }
    if (on && cfg.rim.enabled && _installed.rim) {
        _nodes.rim.setShaderUniform('u_time', timeSec);
    }
    // The burn front only animates when asked; otherwise the slider owns it,
    // because a hand-parked dissolve is easier to inspect than a moving one.
    if (on && cfg.dissolve.enabled && _installed.dissolve && cfg.dissolve.sweep) {
        const v = 0.5 - 0.5 * Math.cos(timeSec * 0.55);
        cfg.dissolve.amount = v;
        _nodes.dissolve.setShaderUniform('u_diss', v);
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
