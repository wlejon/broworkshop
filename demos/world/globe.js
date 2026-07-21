// =============================================================================
// THE GLOBE — the whole planet as a small ball, rendered CLOSE.
//
// The surface clipmap is the planet seen from INSIDE: it bends the ground onto
// a sphere of the true radius and you stand on it. The globe is the same planet
// seen from OUTSIDE, and the trick of this world is that "outside" is not far
// away. Flying "to orbit" does not translate the camera a thousand kilometres
// into fp32's death zone; a small textured ball is simply present a few dozen
// units in front of the eye, and the zoom controller cross-fades the clipmap
// into it. Powers-of-ten, Google-Earth style: a new representation at a nearby
// depth, not a real recession.
//
// It reads as the SAME planet because it is shaded from the SAME data (the
// resident equirectangular coarse chart) with the SAME material rule as the
// ground (clipmap_material.glsl): rock on steep faces, snow above the snow line,
// sand at the coast, water below sea level. What it does NOT copy is the metre-
// scale mottle — there is no scale to resolve at this distance, so the surface
// fades to its material's average colour, which is exactly right for a ball.
//
// WHY THE RELIEF IS BAKED ON THE CPU. The obvious build displaces the icosphere
// in the vertex shader by sampling the chart. But vertex-stage sampling of an
// R32F texture returns garbage on this driver (fragment sampling is fine — it is
// a known vertex-texture-fetch limitation for float formats). So the chart is a
// CONSTANT resident asset, the displacement is baked once into the mesh here in
// JS, and the engine recomputes smooth normals from the displaced geometry. The
// FRAGMENT still samples the chart for crisp coasts and the snow line. Nothing
// depends on vertex texture fetch.
//
// RELIEF IS EXAGGERATED. Real relief on a small ball is a fraction of a texel
// and would be invisible; the exaggeration makes mountain ranges read as ridges
// the terminator rakes across. An explicit visual choice, like PLANET.heightScale.
// =============================================================================
import { PLANET, closePoles } from "/app/planet.js";

const TAU = Math.PI * 2;

// Area-average the chart down to cw x ch. The displacement mesh has ~100 km
// vertex spacing; point-sampling a 7.68 km chart at that spacing aliases the
// high-frequency terrain into per-vertex spikes (the mesh looks like an
// asteroid). Low-passing the chart to roughly the vertex density first is what
// makes the relief read as smooth mountains. The FRAGMENT still samples the
// full-resolution chart, so coasts and the snow line stay crisp.
function downsampleChart(chart, cw, ch) {
    const { data, width: w, height: h } = chart;
    const out = new Float32Array(cw * ch);
    for (let j = 0; j < ch; j++) {
        const y0 = Math.floor(j * h / ch), y1 = Math.max(y0 + 1, Math.floor((j + 1) * h / ch));
        for (let i = 0; i < cw; i++) {
            const x0 = Math.floor(i * w / cw), x1 = Math.max(x0 + 1, Math.floor((i + 1) * w / cw));
            let s = 0, n = 0;
            for (let y = y0; y < y1; y++)
                for (let x = x0; x < x1; x++) { s += data[y * w + x]; n++; }
            out[j * cw + i] = s / n;
        }
    }
    return { data: out, width: cw, height: ch };
}

// Bilinear sample of the equirect chart by (lon, lat), matching the fragment's
// mapping: periodic in longitude (wrap S), single-valued at the poles (clamp T),
// row 0 = north pole.
function sampleChart(chart, lon, lat) {
    const w = chart.width, h = chart.height, d = chart.data;
    let u = lon / TAU + 0.5;
    u -= Math.floor(u);                       // wrap to [0,1)
    const v = Math.min(1, Math.max(0, 0.5 - lat / Math.PI));
    const x = u * w - 0.5, y = v * h - 0.5;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const xa = ((x0 % w) + w) % w, xb = (xa + 1) % w;
    const ya = Math.min(h - 1, Math.max(0, y0)), yb = Math.min(h - 1, Math.max(0, y0 + 1));
    const e00 = d[ya * w + xa], e10 = d[ya * w + xb];
    const e01 = d[yb * w + xa], e11 = d[yb * w + xb];
    return (e00 * (1 - fx) + e10 * fx) * (1 - fy) + (e01 * (1 - fx) + e11 * fx) * fy;
}

// The vertex chunk only forwards the object-space direction; the chart lookup is
// done per fragment (so coasts/snow are crisp) from this interpolated direction,
// not from an interpolated UV (which would tear across the longitude seam).
const VERT = `
out vec3 v_dir;
void userVertex(inout vec3 pos, inout vec3 normal, inout vec2 uv) {
    v_dir = normalize(pos);   // baked relief is radial, so this is the sphere dir
}
`;

const FRAG = `
in vec3 v_dir;
uniform sampler2D u_chart;
uniform float u_radius;      // planet radius, metres — the noise domain's scale
uniform float u_cell0;       // chart metres per texel at mip 0 (~7.68 km)
uniform float u_snowLine;
uniform float u_seaLevel;
uniform float u_relief;      // fBm height roughness, dimensionless (per octave slope)
uniform float u_bump;        // relief-shading strength
uniform float u_limb;
uniform vec3  u_limbColor;
uniform float u_alpha;       // cross-fade opacity, driven by the zoom controller
const float GB_PI  = 3.14159265358979;
const float GB_TAU = 6.28318530717959;

// --- 3D gradient noise on an INTEGER-hashed lattice. -------------------------
// Not fract(sin(dot(...))): the noise domain is the planet surface in metres, so
// the coordinate reaches ~6.4e6, where fp32 sin() is stripes. The bit-mix hash
// (same idea as the clipmap's cmHashU) resolves every cell. 3D, keyed off the
// surface point itself, so there is no equirect seam and no polar pinch to dodge
// — the two problems that forced the old fixed-LOD, texture-only material.
uint gbHash(ivec3 c) {
    uvec3 v = uvec3(c + 0x1000000);
    uint h = v.x * 0x8da6b343u + v.y * 0xd8163841u + v.z * 0xcb1ab31fu;
    h ^= h >> 15; h *= 0x2c1b3c6du;
    h ^= h >> 13; h *= 0x297a2d39u;
    h ^= h >> 15;
    return h;
}
vec3 gbGrad(ivec3 c) {
    uint h = gbHash(c);
    float a = float(h & 0xffffu) * (GB_TAU / 65536.0);
    float z = float((h >> 16) & 0xffffu) * (2.0 / 65536.0) - 1.0;
    float r = sqrt(max(0.0, 1.0 - z * z));
    return vec3(r * cos(a), r * sin(a), z);
}
float gbNoise(vec3 p) {
    vec3 fl = floor(p); ivec3 i = ivec3(fl); vec3 f = p - fl;
    vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    float v000 = dot(gbGrad(i + ivec3(0,0,0)), f - vec3(0,0,0));
    float v100 = dot(gbGrad(i + ivec3(1,0,0)), f - vec3(1,0,0));
    float v010 = dot(gbGrad(i + ivec3(0,1,0)), f - vec3(0,1,0));
    float v110 = dot(gbGrad(i + ivec3(1,1,0)), f - vec3(1,1,0));
    float v001 = dot(gbGrad(i + ivec3(0,0,1)), f - vec3(0,0,1));
    float v101 = dot(gbGrad(i + ivec3(1,0,1)), f - vec3(1,0,1));
    float v011 = dot(gbGrad(i + ivec3(0,1,1)), f - vec3(0,1,1));
    float v111 = dot(gbGrad(i + ivec3(1,1,1)), f - vec3(1,1,1));
    float x00 = mix(v000, v100, u.x), x10 = mix(v010, v110, u.x);
    float x01 = mix(v001, v101, u.x), x11 = mix(v011, v111, u.x);
    return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}

// Band-limited fBm relief in metres. Every octave whose wavelength drops toward
// the pixel footprint \`foot\` fades out — the same Nyquist window the clipmap's
// cmDetail uses — so the far, small ball loses its detail to its average instead
// of boiling into speckle. Amplitude is proportional to wavelength (scale-free),
// matching cmDetail so the two surfaces roughen the same way through the fade.
// The fade dies EARLY — an octave is gone by the time the pixel footprint reaches
// half its wavelength (2 px per feature, Nyquist). Letting octaves live nearer
// the pixel gave the land a harsh 2-px stipple ("static"); this keeps the finest
// visible feature several pixels wide, so the surface reads as gentle terrain,
// the way the clipmap does from altitude (its metre-scale mottle is long dead by
// the time you are looking at a whole continent).
float gbBand(float lambda, float foot) {
    return 1.0 - smoothstep(0.22 * lambda, 0.50 * lambda, foot);
}
float gbHeight(vec3 P, float foot) {
    float h = 0.0, lambda = 6000.0;   // start just under the 7.68 km chart cell
    for (int o = 0; o < 6; ++o) {
        float w = gbBand(lambda, foot);
        if (w > 0.0) h += u_relief * lambda * w * gbNoise(P / lambda);
        lambda *= 0.5;
    }
    return h;
}
// Band-limited scalar mottle in ~[-1,1] at one scale (fades below the pixel).
float gbMottle(vec3 P, float foot, float scale) {
    float w = gbBand(scale, foot);
    return w > 0.0 ? w * gbNoise(P / scale) : 0.0;
}

void userFragment(inout vec3 baseColor, inout vec3 normal, inout float metallic,
                  inout float roughness, inout vec3 emissive, inout float alpha) {
    vec3 d = normalize(v_dir);
    float lat = asin(clamp(d.y, -1.0, 1.0));
    float lon = atan(d.x, d.z);
    vec2 uv = vec2(lon / GB_TAU + 0.5, 0.5 - lat / GB_PI);

    // Planet-fixed surface point in metres — the domain for all the procedural
    // detail. It is object-space (before the node's per-frame reorientation), so
    // terrain stays pinned to the planet as the ball turns under the camera.
    vec3 P = u_radius * d;
    // One pixel's footprint on that surface, from the derivative of P. This is
    // what makes the detail self-regulate: near the sub-camera point it is a few
    // hundred metres (fine detail alive), toward the foreshortened limb and when
    // the ball has shrunk to a dot it blows up (all detail fades to average).
    float foot = max(length(fwidth(P)), 1.0);

    // Chart at the mip that matches the footprint: crisp at the near point,
    // minified toward the limb. Computed, not auto-selected — R32F auto-mip is
    // stuck at level 0 on this driver.
    float clod = max(0.0, log2(foot / u_cell0));
    float eChart = textureLod(u_chart, uv, clod).r;

    // Detail below the 7.68 km chart: ragged coasts and terrain relief. Held off
    // the open ocean (landness) so deep water stays a smooth sheet, not noise.
    float landness = smoothstep(u_seaLevel - 600.0, u_seaLevel + 200.0, eChart);
    float relief = gbHeight(P, foot) * mix(0.25, 1.0, landness);
    float e = eChart + relief;

    float coarse = gbMottle(P, foot, 2800.0);   // breaks the large colour washes
    float fine   = gbMottle(P, foot, 520.0);    // the grain you read up close

    // --- Material bands: the clipmap's rock/snow/sand/grass palette verbatim
    // (clipmap_material.glsl), each albedo varied by the fine/coarse mottle so the
    // colour has grain instead of a flat wash. The BANDS themselves key off the
    // SMOOTH chart elevation (eChart), not the relief-perturbed e: snow caps and
    // highlands read as coherent regions like the ground does, while the relief
    // still ragges the coast (below) and lights the terrain (bump, below). Keying
    // the bands off e instead turned every fBm bump into a fleck of snow. ---
    vec3 cRock  = mix(vec3(0.246,0.232,0.221), vec3(0.336,0.313,0.288), 0.5 + 0.35*fine);
    vec3 cSnow  = vec3(0.760,0.790,0.830) * (1.0 + 0.04*fine);
    vec3 cSand  = mix(vec3(0.480,0.430,0.330), vec3(0.560,0.510,0.400), 0.5 + 0.35*fine);
    vec3 cGrass = mix(vec3(0.180,0.235,0.128), vec3(0.268,0.322,0.170),
                      clamp(0.5 + 0.5*coarse + 0.14*fine, 0.0, 1.0));

    float highland = smoothstep(u_snowLine * 0.28, u_snowLine * 0.92, eChart + 180.0*coarse);
    vec3 land = mix(cGrass, cRock, highland);
    float sand = 1.0 - smoothstep(u_seaLevel + 15.0, u_seaLevel + 160.0, eChart + 50.0*coarse);
    land = mix(land, cSand, sand * 0.5);
    float snowLine = u_snowLine + 260.0*coarse;
    float snow = max(smoothstep(snowLine + 350.0, snowLine + 1500.0, eChart),
                     smoothstep(1.15, 1.36, abs(lat)));   // coherent caps + latitude ice
    land = mix(land, cSnow, snow);
    float landRough = mix(0.94, 0.62, snow);

    // Ocean below sea level (not the focus yet — kept simple, coast perturbed by
    // the same relief so the shoreline is ragged, not a smooth arc).
    float water = 1.0 - smoothstep(u_seaLevel - 250.0, u_seaLevel + 120.0, e);
    vec3 deep = mix(vec3(0.05,0.11,0.20), vec3(0.02,0.05,0.12),
                    smoothstep(u_seaLevel - 400.0, u_seaLevel - 3000.0, e));

    baseColor = mix(land, deep, water);
    roughness = mix(landRough, 0.72, water);
    metallic  = 0.0;

    // --- Relief shading. Bump the normal from the height's screen-space gradient
    // (Mikkelsen derivative bump — no tangents, correct in the camera-relative
    // world space \`normal\`/vWorldPos already live in, and self-cancelling because
    // \`relief\` fades to zero when the ball is small). This is what makes the
    // terminator rake across ridges instead of sliding over a smooth ball. ---
    vec3 N = normalize(normal);
    vec3 dpx = dFdx(vWorldPos), dpy = dFdy(vWorldPos);
    float dhx = dFdx(relief),   dhy = dFdy(relief);
    vec3 r1 = cross(dpy, N), r2 = cross(N, dpx);
    float det = dot(dpx, r1);
    if (abs(det) > 1e-8) {
        vec3 g = (dhx * r1 + dhy * r2) / det;   // world-space surface gradient of relief
        N = normalize(N - u_bump * (1.0 - water) * g);
        normal = N;
    }

    // Atmospheric limb: a thin rim of sky colour hugging the silhouette.
    float rim = pow(1.0 - max(dot(N, normalize(-vWorldPos)), 0.0), 6.0);
    emissive += u_limbColor * (rim * u_limb);

    // Cross-fade coverage (mesh is drawn translucent; at 1 it hides the cap).
    alpha = u_alpha;
}
`;

/// Build the globe node (hidden until the zoom controller fades it in). `chart`
/// is the resident coarse field: { data:Float32Array, width, height, cellSize }.
export function createGlobe(scene, chart, opts = {}) {
    const relief = opts.relief ?? 30.0;
    const dispScale = relief / PLANET.radius;   // metres -> unit-sphere fraction

    // Bake the displacement into a unit icosphere: sample a LOW-PASSED chart per
    // vertex (see downsampleChart) and push the vertex out along its own radius.
    const base = Mesh.geodesicSphere(1, 6);     // 40962 verts, 81920 tris
    // The mesh has ~100 km vertex spacing, so Nyquist wants displacement cells
    // no finer than ~200 km. 160 columns ≈ 250 km cells keeps the relief below
    // that and reads as smooth continental swells; the crisp detail (coasts, the
    // snow line) comes from the full-res chart in the fragment, not the mesh.
    const lo = downsampleChart(chart, 160, 80);
    // The baked chart is not pole-closed (loadChart skips it), so every column of
    // the polar rows carries its own elevation — on the globe that renders as a
    // pinwheel of radial streaks converging on the pole (every longitude sampled
    // over a few pixels). Converge the polar bands to their row mean so the poles
    // are single-valued, as an equirect sphere requires. ~35 deg on lo, ~22 on mid.
    closePoles(lo.data, lo.width, lo.height, 16);
    const src = base.positions;                 // Float32Array, unit sphere
    const pos = new Float32Array(src.length);
    for (let i = 0; i < src.length; i += 3) {
        const x = src[i], y = src[i + 1], z = src[i + 2];
        const lat = Math.asin(Math.max(-1, Math.min(1, y)));
        const lon = Math.atan2(x, z);
        const e = sampleChart(lo, lon, lat);
        // Land bulges out; the sea is FLAT at radius 1. Displacing the seabed
        // downward gives the ocean a bumpy surface that catches the light as
        // radial fur — real oceans are a smooth sheet at sea level.
        const s = 1.0 + Math.max(0.0, Math.min(0.08, dispScale * e));
        pos[i] = x * s; pos[i + 1] = y * s; pos[i + 2] = z * s;
    }

    const node = scene.createMesh({
        positions: pos,
        indices: base.indices,
        recomputeNormals: true,                 // smooth normals of the relief
        name: 'globe',
        visible: false,
        // Colour alpha < 1 routes the mesh to the translucent "over" pass so the
        // cross-fade can dissolve it in; the fragment overwrites the actual alpha
        // from u_alpha, so this value is only the translucent-routing flag.
        color: [1, 1, 1, 0.999],
    });
    node.castsShadow = false;

    // The FRAGMENT samples the FULL-resolution chart (7.68 km cells), not a
    // downsample: soft coastlines were the biggest part of the "blurry ball"
    // look, and they come straight from the chart resolution. The fragment picks
    // the right mip per pixel from its own footprint (u_cell0 + fwidth), so this
    // stays crisp at the near point and mips down toward the limb on its own —
    // the fixed-LOD blur the old medium chart baked in is gone. Copy first, then
    // close the poles on the copy so the shared clipmap chart is left untouched.
    const full = { data: chart.data.slice(), width: chart.width, height: chart.height };
    closePoles(full.data, full.width, full.height,
               Math.max(8, Math.round(full.height * 0.12)));   // ~22 deg polar band
    const cell0 = (TAU * PLANET.radius) / full.width;          // metres per texel, mip 0

    node.setShader({
        vertex: VERT,
        fragment: FRAG,
        uniforms: {
            u_radius:      PLANET.radius,
            u_cell0:       cell0,
            u_snowLine:    PLANET.snowLine,
            u_seaLevel:    PLANET.seaLevel,
            u_relief:      opts.relief2 ?? 0.018,   // fBm slope per octave
            u_bump:        opts.bump ?? 0.5,        // relief-shading strength
            u_limb:        opts.limb ?? 0.4,
            u_limbColor:   opts.limbColor ?? [0.35, 0.55, 0.90],
            u_alpha:       1.0,
        },
    });
    // Periodic in longitude (repeat S), single-valued at the poles (clamp T),
    // mipmapped so the per-fragment LOD has levels to select.
    node.setShaderTexture('u_chart', {
        data: full.data, width: full.width, height: full.height,
        mipmap: true, repeat: true, clampT: true,
    });
    return node;
}
