// canopyShell.js — CHUNK 3 of the foliage-LOD system: the L1 CANOPY SHELL.
//
// A single camera-parked, subdivided-plane MeshNode that renders the forest as
// a rolling CANOPY ROOF when the camera is high above the trees. As the camera
// descends toward canopy height it DISSOLVES (screen-door dither) into the L2
// impostor billboards (lib/impostorLayer.js) with no hard pop — both layers
// compute the SAME blend weight `t` and discard on COMPLEMENTARY halves of a
// per-pixel hash, so exactly one layer survives each pixel across the band.
//
// How it works:
//   - Geometry: one subdivided grid plane (default 128x128) laid out in XZ with
//     UVs spanning [0,1] across the patch. It is sized to cover the forest
//     region (and can be re-parked on the camera in XZ via parkXZ()).
//   - Vertex (custom shader): samples an R32F CANOPY-HEIGHT field
//     (node.setShaderTexture, single-channel float — see scene_bindings_mesh.cpp)
//     at the plane UV and displaces Y to that canopy-top world height. A field
//     sample <= 0 means "no forest": the vertex is shoved far below ground and a
//     `v_forest` varying is set to 0 so the fragment discards (non-forest area
//     shows nothing).
//   - Fragment (custom shader): an unlit-style canopy albedo — the bake's
//     `tintRGB` (so the roof MATCHES the impostor colour) modulated by a tiling
//     fbm value-noise plus a cheap bump/relief term for fake 3D lumpiness —
//     emitted the same way the impostors emit their atlas (baseColor 0 +
//     emissive) so both layers read at the same brightness under the one ACES
//     tonemap. Then the Part-C crossfade dither.
//
// The crossfade weight is SCREEN-UNIFORM (a function only of camera elevation
// vs a single canopy-top reference and two band uniforms), NOT of per-fragment
// depth. That is deliberate: if `t` varied per fragment, an L1 pixel and the L2
// pixel behind it would compute different `t` and the complementary discard
// would leave holes or double-draw. A screen-uniform `t` makes keepL1 == !keepL2
// at every pixel, guaranteeing the XOR the design requires. The descent axis IS
// camera elevation, so elevation-keyed `t` is exactly the intended control.

// ---- crossfade defaults (shared with impostorLayer via createImpostorLayer) --
// camAbove = uFogCamY - canopyTopY  (metres the camera sits above the canopy).
//   camAbove >= fadeHigh  -> t=0 -> full L1 roof, no L2.
//   camAbove <= fadeLow   -> t=1 -> full L2 trees, no L1.
// Wide band (tens of metres) so a descending camera sees a gradual dissolve.
export const CROSSFADE_DEFAULTS = { fadeLow: 0.0, fadeHigh: 55.0 };

const VERTEX_CHUNK = `
uniform sampler2D u_canopyField;  // R32F canopy-top world height (m); <=0 = no forest
uniform float u_groundY;          // ground reference Y (non-forest push-down datum)
out float v_forest;               // 1 = forested (fragment keeps), 0 = discard

void userVertex(inout vec3 pos, inout vec3 normal, inout vec2 uv) {
    // Vertex-stage sample: no implicit LOD in a VS, so force base level.
    float h = textureLod(u_canopyField, uv, 0.0).r;
    if (h > 0.001) {
        pos.y   = h;          // lift the plane to the canopy top (node parked at y=0)
        v_forest = 1.0;
    } else {
        pos.y    = u_groundY - 1000.0;   // shove far below; also flagged to discard
        v_forest = 0.0;
    }
    normal = vec3(0.0, 1.0, 0.0);
    // uv is left as the plane UV -> becomes vUV in the fragment (canopy texture).
}
`;

const FRAGMENT_CHUNK = `
in float v_forest;

// ---- crossfade (IDENTICAL formula in impostorLayer's fragment) ----
uniform float u_canopyTopY;   // reference canopy-top world height (m)
uniform float u_fadeLow;      // camAbove where t=1 (full trees)
uniform float u_fadeHigh;     // camAbove where t=0 (full roof)

// ---- canopy look ----
uniform vec3  u_canopyTint;   // linear RGB matching the impostor bake tintRGB
uniform float u_noiseTiles;   // how many noise cells across the patch

float ch_hash12(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
float ch_vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = ch_hash12(i);
    float b = ch_hash12(i + vec2(1.0, 0.0));
    float c = ch_hash12(i + vec2(0.0, 1.0));
    float d = ch_hash12(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void userFragment(inout vec3 baseColor, inout vec3 normal,
                  inout float metallic, inout float roughness,
                  inout vec3 emissive, inout float alpha) {
    if (v_forest < 0.5) discard;   // non-forest cells show nothing

    // ---- Part C: crossfade weight + COMPLEMENTARY dither ----
    // uFogCamY (camera world Y) and gl_FragCoord.xy are engine globals in
    // mesh.frag; the hash idiom mirrors mesh.frag:263.
    float camAbove = uFogCamY - u_canopyTopY;
    float t = 1.0 - smoothstep(u_fadeLow, u_fadeHigh, camAbove);  // 1=trees, 0=roof
    float hash = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    // L1 keeps hash >= t; L2 keeps hash < t. Exactly complementary.
    if (hash < t) discard;

    // ---- canopy albedo: fbm noise + cheap bump relief, tinted to match L2 ----
    vec2 np = vUV * u_noiseTiles;
    float n = ch_vnoise(np) * 0.6 + ch_vnoise(np * 2.3) * 0.3 + ch_vnoise(np * 5.1) * 0.1;
    float e = 0.75;
    float nx = ch_vnoise(np + vec2(e, 0.0)) - ch_vnoise(np - vec2(e, 0.0));
    float nz = ch_vnoise(np + vec2(0.0, e)) - ch_vnoise(np - vec2(0.0, e));
    // Fake relief: lumps lit from straight up, kept centred near 1.0 so the mean
    // canopy brightness stays close to the flat impostor tint (consistency).
    vec3 bumpN = normalize(vec3(-nx * 2.0, 1.0, -nz * 2.0));
    float relief = clamp(0.80 + 0.45 * (bumpN.y - 0.5) + 0.35 * (n - 0.5), 0.35, 1.35);
    vec3 canopy = u_canopyTint * (0.80 + 0.45 * n) * relief;

    baseColor = vec3(0.0);
    emissive  = canopy;   // unlit-style, like the impostor cards
    alpha     = 1.0;
}
`;

/**
 * Build an R32F canopy-height field by splatting soft crown disks from impostor
 * instance XZ positions. The value stored per texel is the MAX canopy-top world
 * height of any tree covering it; texels no tree covers stay 0 (= no forest).
 *
 * @param {Float32Array|number[]} transforms  9 floats/instance
 *   (px,py,pz, qx,qy,qz,qw, scale, variantIndex) — same layout impostorLayer uses.
 * @param {Object} opts
 *   { centerX, centerZ, half,          // patch square: [center-half, center+half]
 *     res=192,                          // field resolution (texels/side)
 *     crownWorldY,                      // fn(py,scale)->canopy-top world Y, OR
 *     canopyOffsetY, canopyBaseY,       // canopyTop = py + canopyBaseY + ... (see below)
 *     crownRadius,                      // horizontal crown radius in metres
 *     lift=1.0 }                        // extra metres the shell sits above tree tops
 * @returns {{ data:Float32Array, width:number, height:number,
 *             refTopY:number, minTopY:number, maxTopY:number }}
 */
export function buildCanopyField(transforms, opts) {
    const src = (transforms instanceof Float32Array) ? transforms : new Float32Array(transforms);
    const count = Math.floor(src.length / 9);

    const res = opts.res || 192;
    const cx = opts.centerX, cz = opts.centerZ, half = opts.half;
    const lift = opts.lift != null ? opts.lift : 1.0;
    const crownR = opts.crownRadius != null ? opts.crownRadius : 6.0;
    const span = 2 * half;
    const mPerTexel = span / res;

    const data = new Float32Array(res * res);   // 0 = no forest
    const tops = [];

    for (let i = 0; i < count; i++) {
        const o = i * 9;
        const px = src[o], py = src[o + 1], pz = src[o + 2];
        const scale = src[o + 7];
        // Canopy-top world height for this tree.
        const topY = opts.crownWorldY
            ? opts.crownWorldY(py, scale)
            : py + (opts.canopyBaseY || 0) + (opts.canopyOffsetY || 0) * scale;
        const topLifted = topY + lift;
        tops.push(topLifted);

        const r = crownR * scale;
        // Texel-space footprint of this crown.
        const fx = (px - (cx - half)) / mPerTexel;
        const fz = (pz - (cz - half)) / mPerTexel;
        const rTex = r / mPerTexel;
        const x0 = Math.max(0, Math.floor(fx - rTex));
        const x1 = Math.min(res - 1, Math.ceil(fx + rTex));
        const z0 = Math.max(0, Math.floor(fz - rTex));
        const z1 = Math.min(res - 1, Math.ceil(fz + rTex));
        const r2 = rTex * rTex;
        for (let zz = z0; zz <= z1; zz++) {
            for (let xx = x0; xx <= x1; xx++) {
                const dx = xx + 0.5 - fx, dz = zz + 0.5 - fz;
                const d2 = dx * dx + dz * dz;
                if (d2 > r2) continue;
                // Soft dome: full height at centre, easing to ~0.5*height at rim
                // so neighbouring crowns merge into a rolling roof, not spikes.
                const falloff = 1.0 - 0.5 * (d2 / r2);
                const v = topLifted * falloff;
                const idx = zz * res + xx;
                if (v > data[idx]) data[idx] = v;
            }
        }
    }

    tops.sort((a, b) => a - b);
    const refTopY = tops.length ? tops[Math.floor(tops.length / 2)] : 0;  // median
    return {
        data, width: res, height: res,
        refTopY,
        minTopY: tops.length ? tops[0] : 0,
        maxTopY: tops.length ? tops[tops.length - 1] : 0,
    };
}

/**
 * Create the L1 canopy shell over a patch.
 *
 * @param {SceneGraph} scene
 * @param {Object} cfg
 *   { centerX, centerZ, half,        // patch square (world metres)
 *     field: { data, width, height },// R32F canopy-height field (buildCanopyField)
 *     canopyTopY,                    // reference canopy-top Y for the crossfade weight
 *     tintRGB,                       // impostor bake tintRGB (0..255) -> matched colour
 *     subdiv=128, groundY=0,
 *     fadeLow, fadeHigh,             // crossfade band (CROSSFADE_DEFAULTS)
 *     noiseTiles=24, coverMargin=1.15 }
 * @returns {{ node:SceneNode, parkXZ:(x:number,z:number)=>void,
 *             crossfade:{canopyTopY,fadeLow,fadeHigh} }}
 */
export function createCanopyShell(scene, cfg) {
    const subdiv = cfg.subdiv || 128;
    const half = cfg.half;
    // The plane UV runs 0..1 across the WHOLE plane, and the field covers exactly
    // the patch, so the plane must equal the patch (planeHalf == half) or the
    // field would stretch and the canopy would misalign from the trees. Over-
    // covering the view is done by making the PATCH large, not by oversizing the
    // plane past its field.
    const planeHalf = half;
    const groundY = cfg.groundY != null ? cfg.groundY : 0;
    const fadeLow = cfg.fadeLow != null ? cfg.fadeLow : CROSSFADE_DEFAULTS.fadeLow;
    const fadeHigh = cfg.fadeHigh != null ? cfg.fadeHigh : CROSSFADE_DEFAULTS.fadeHigh;
    const noiseTiles = cfg.noiseTiles != null ? cfg.noiseTiles : 24;

    const tint = cfg.tintRGB || [46, 89, 36];
    const tintLin = [tint[0] / 255, tint[1] / 255, tint[2] / 255];

    // Subdivided plane in XZ, UVs 0..1. Parked at the patch centre, y=0.
    const node = scene.createMesh({
        mesh: Mesh.plane(planeHalf, planeHalf, subdiv, subdiv),
        x: cfg.centerX, y: 0, z: cfg.centerZ,
        color: [1, 1, 1],
        metallic: 0.0,
        roughness: 1.0,
        doubleSided: true,     // seen from above (roof) and below (underside)
        castsShadow: false,
        receivesShadow: false,
    });

    node.setShader({
        vertex: VERTEX_CHUNK,
        fragment: FRAGMENT_CHUNK,
        uniforms: {
            u_groundY: groundY,
            u_canopyTopY: cfg.canopyTopY,
            u_fadeLow: fadeLow,
            u_fadeHigh: fadeHigh,
            u_canopyTint: tintLin,
            u_noiseTiles: noiseTiles,
        },
    });

    // Map the R32F field so texel (0,0) aligns to the plane UV (0,0) corner
    // = patch min-XZ. The plane UV runs u:+X, v:+Z linearly over the patch,
    // which is exactly how buildCanopyField rasterised the field.
    node.setShaderTexture('u_canopyField', {
        width: cfg.field.width,
        height: cfg.field.height,
        data: cfg.field.data,
    });

    let curX = cfg.centerX, curZ = cfg.centerZ;

    return {
        node,
        crossfade: { canopyTopY: cfg.canopyTopY, fadeLow, fadeHigh },
        // Re-park the shell on the camera in XZ (keeps it spanning the view for a
        // moving camera). The field is patch-anchored, so re-parking also needs
        // the UVs re-anchored — for a patch that already covers the view we just
        // translate the node; the descent test keeps the camera over the patch,
        // so parking is optional there.
        parkXZ(x, z) {
            curX = x; curZ = z;
            node.setPosition(x, 0, z);
        },
        position() { return [curX, 0, curZ]; },
    };
}
