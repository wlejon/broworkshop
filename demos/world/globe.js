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
uniform float u_chartLod;    // fixed mip level to sample the chart at (see below)
uniform float u_snowLine;
uniform float u_seaLevel;
uniform float u_limb;
uniform vec3  u_limbColor;
uniform float u_alpha;       // cross-fade opacity, driven by the zoom controller
const float GB_PI = 3.14159265358979;
const float GB_TAU = 6.28318530717959;

// WHY A FIXED LOD, NOT texture(). Auto-LOD is useless here on three counts: the
// R32F auto-mip select is stuck at level 0 on this driver, the icosphere's tris
// are sub-pixel so the 2x2-quad derivatives are noise, and the equirect uv wraps
// at the longitude seam so dFdx spikes there. A single resolved level dodges all
// three; the controller can raise it as the globe grows to fill the frame.
float chartElev(vec2 uv) { return textureLod(u_chart, uv, u_chartLod).r; }

void userFragment(inout vec3 baseColor, inout vec3 normal, inout float metallic,
                  inout float roughness, inout vec3 emissive, inout float alpha) {
    vec3 d = normalize(v_dir);
    float lat = asin(clamp(d.y, -1.0, 1.0));
    float lon = atan(d.x, d.z);
    vec2 uv = vec2(lon / GB_TAU + 0.5, 0.5 - lat / GB_PI);

    float e = chartElev(uv);

    // Land is coloured by ELEVATION and LATITUDE only — no per-pixel slope term.
    // On the ground the clipmap keys rock off slope, but a globe pixel spans
    // ~150 km, where the slope between neighbouring chart cells is noise, not a
    // feature (it reads as radial fur). The baked relief still gives the
    // terminator ridges to rake across; here we just paint the biome bands. The
    // clipmap's rock/snow/sand/grass palette (clipmap_material.glsl) is kept so
    // the ball reads as the same planet as the ground.
    vec3 cRock  = vec3(0.291, 0.272, 0.254);
    vec3 cSnow  = vec3(0.760, 0.790, 0.830);
    vec3 cSand  = vec3(0.520, 0.470, 0.365);
    vec3 cGrass = vec3(0.224, 0.278, 0.149);

    // Grass in the lowlands giving way to bare rock on the high ground. Wide,
    // gentle bands: a globe texel is hundreds of km, so hard thresholds on the
    // elevation turn every stray high or low cell into a speck.
    float highland = smoothstep(u_snowLine * 0.30, u_snowLine * 0.95, e);
    vec3 land = mix(cGrass, cRock, highland);
    // A thin tan shore hugging the coast; the lowlands stay grass, not desert.
    float sand = 1.0 - smoothstep(u_seaLevel + 20.0, u_seaLevel + 180.0, e);
    land = mix(land, cSand, sand * 0.5);
    // Snow only on genuinely high massifs (a raised, wide threshold keeps single
    // high cells from flecking white) plus the latitude ice caps.
    float snow = max(smoothstep(u_snowLine + 300.0, u_snowLine + 1400.0, e),
                     smoothstep(1.13, 1.34, abs(lat)));   // ~65 to ~77 deg
    land = mix(land, cSnow, snow);
    float landRough = mix(0.95, 0.62, snow);

    // Ocean below sea level: deep in the basins, lighter over the shelves. A wide
    // shoreline band keeps coasts soft. The globe shows seas the clipmap never draws.
    float water = 1.0 - smoothstep(u_seaLevel - 250.0, u_seaLevel + 250.0, e);
    vec3 deep = mix(vec3(0.05, 0.11, 0.20), vec3(0.02, 0.05, 0.12),
                    smoothstep(u_seaLevel - 400.0, u_seaLevel - 3000.0, e));

    baseColor = mix(land, deep, water);
    roughness = mix(landRough, 0.72, water);   // sea is matte, not a mirror
    metallic  = 0.0;

    // Atmospheric limb: a thin rim of sky colour right at the silhouette. A high
    // power keeps it hugging the true limb, so it does not wash the surface when
    // the globe fills the frame during the dissolve.
    float rim = pow(1.0 - max(dot(normalize(normal), normalize(-vWorldPos)), 0.0), 6.0);
    emissive += u_limbColor * (rim * u_limb);

    // Cross-fade: the controller ramps this 0..1 as the surface dissolves into
    // the globe. The mesh is drawn translucent (colour alpha < 1), so this is the
    // final coverage — at 1 it fully occludes the clipmap cap behind it.
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

    // Medium-resolution chart for the fragment material (see setShaderTexture).
    const mid = downsampleChart(chart, 2048, 1024);
    closePoles(mid.data, mid.width, mid.height, 128);

    // Resolve the chart at a fixed mip whose cell is ~90 km: fine enough that
    // coastlines and whole continents survive (heavy averaging drowns land — the
    // mean elevation is below sea level, so a coarse tap reads as all-ocean),
    // coarse enough that it does not speckle now that the poles are closed and the
    // material bands are soft. exp2(lod) = 140 km / cell(level 0).
    const cell0 = (TAU * PLANET.radius) / mid.width;     // metres per texel, level 0
    const chartLod = opts.chartLod ?? Math.max(0, Math.log2(140000 / cell0));

    node.setShader({
        vertex: VERT,
        fragment: FRAG,
        uniforms: {
            u_chartLod:    chartLod,
            u_snowLine:    PLANET.snowLine,
            u_seaLevel:    PLANET.seaLevel,
            u_limb:        opts.limb ?? 0.4,
            u_limbColor:   opts.limbColor ?? [0.35, 0.55, 0.90],
            u_alpha:       1.0,
        },
    });
    // Fragment chart lookup on the MEDIUM-resolution chart (~19 km cells). The
    // full 7.68 km chart, minified to a screen where the whole planet is ~1000
    // px, speckles below the pixel even with mips; bounding the frequency here
    // gives crisp coastlines at every zoom without sub-pixel noise. Periodic in
    // longitude (repeat S), single-valued at the poles (clamp T), mipmapped.
    node.setShaderTexture('u_chart', {
        data: mid.data, width: mid.width, height: mid.height,
        mipmap: true, repeat: true, clampT: true,
    });
    return node;
}
