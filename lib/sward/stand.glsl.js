// stand.glsl.js — the sward module's every-stage half: where a cell's blades
// rise and how thickly they stand (swardRoot, swardDensity), and the sward
// as the far tier and the turf take it (swardFarLook, swardBake, swardTurf,
// swardLay). See index.js.
//
// The data (index.js packs it; swardData(i) reads it):
//   0  tufts, flowering, dead, minNormalY
//   1  lush colour, bulk
//   2  dry colour, clump frequency
//   3  root shade, sheen, variety, wind
//
// How the grass grows, each varying from place to place about the value by
// shared noise and the land's dryness (its cover, SwardCell.f):
//   - tufts: 0 a sward of many small tufts .. 1 bunch grass in tussocks with
//     bare ground between;
//   - flowering: the share of tufts sending up a flowering culm (a seed
//     head), more where lush and tall;
//   - dead: the share of a tuft's leaves that are dead (straw at its foot),
//     more where dry.

export const STAND = /* glsl */ `
#define SW_TUFTS swardData(0).x
#define SW_FLOWERING swardData(0).y
#define SW_DEAD swardData(0).z
#define SW_MIN_Y swardData(0).w
#define SW_LUSH swardData(1).rgb
#define SW_BULK swardData(1).w
#define SW_DRY swardData(2).rgb
#define SW_CLUMP_FREQ swardData(2).w
#define SW_ROOT_SHADE swardData(3).x
#define SW_SHEEN swardData(3).y
#define SW_VARIETY swardData(3).z
#define SW_WIND swardData(3).w

const float SW_REFERENCE_SPEED = 2.5;   // m/s: the steady wind blades flutter in as authored

// Bunch grass: tussocks one a SW_TUSSOCK square, a cell's roots gathered
// toward its own (up to SW_TUSSOCK_GATHER of the way), bare ground left
// between them. (index.js's reach tells the engine how far a root moves.)
const float SW_TUSSOCK = 0.42;          // m
const float SW_TUSSOCK_GATHER = 0.55;
// How bunched the grass grows at xz: 0 a sward of small tufts .. 1
// tussocks; the tufts about a shared noise of a few metres.
float swBunch(vec2 xz) {
    float n = sceneWindNoise(xz * 0.11 + vec2(23.1, -7.7)) * 0.5 + 0.5;
    return clamp(SW_TUFTS * (0.3 + 1.4 * n), 0.0, 1.0);
}
// The tussock whose square holds xz: xy its centre (anywhere in the square,
// so they lie in no lattice), z how hard it gathers its roots (some loose,
// some tight).
vec3 swTussock(vec2 xz) {
    vec2 g = floor(xz / SW_TUSSOCK);
    ivec2 gi = ivec2(g);
    vec2 o = vec2(sceneWindHash(gi + ivec2(311, 97)), sceneWindHash(gi + ivec2(-53, 211)));
    return vec3((g + 0.05 + 0.9 * o) * SW_TUSSOCK, 0.35 + 0.65 * sceneWindHash(gi + ivec2(19, -401)));
}
// The clump noise: thick and tall in some places, thin and short between.
float swClump(vec2 xz) {
    float k = SW_CLUMP_FREQ;
    return clamp((0.5 * sceneWindNoise(xz * k) + 0.25 * sceneWindNoise(xz * k * 2.03 + 17.3)) * 0.667 + 0.5, 0.0, 1.0);
}
// Flowering culms a square metre at a flowering share of 1.
const float SW_CULMS = 150.0;
const float SW_NEAR_BLADES = 1400.0;   // the near ring's blades a square metre (grass_node.cpp's kRingSpec[0])
// Where the grass flowers and how much of it is dead at xz: x the share of
// tufts sending up a culm (in patches of tens of metres, more where it is
// lush and tall), y the share of leaves that are dead (more where dry).
// (Its patches' noise, 0..1, apart: the turf's surface layer keeps it.)
float swKindsNoise(vec2 xz) { return sceneWindNoise(xz * 0.07 + vec2(-41.3, 12.9)) * 0.5 + 0.5; }
vec2 swKindsOf(float n, float lush, float tall) {
    float flower = SW_FLOWERING * 2.0 * smoothstep(0.2, 0.7, n) * (0.35 + 0.65 * lush * (0.6 + 0.4 * tall));
    float dead = min(SW_DEAD * (0.5 + 2.2 * (1.0 - lush)), 0.6);
    return vec2(min(flower, 1.0), dead);
}
vec2 swKinds(vec2 xz, float lush, float tall) { return swKindsOf(swKindsNoise(xz), lush, tall); }
// A dead leaf's colour: weathered straw to dun (t 0..1).
vec3 swDeadColor(float t) { return mix(vec3(0.30, 0.255, 0.16), vec3(0.15, 0.13, 0.095), t); }
// A culm's head: fresh, green flushed with purple; ripe, straw (r 0..1).
vec3 swHeadColor(float ripe) { return mix(vec3(0.105, 0.11, 0.065), vec3(0.40, 0.33, 0.18), ripe); }
// A whole head's mean colour once its spikelets are under a pixel: their
// green and purple with their pale anthers and the light on their glumes
// (surface.glsl.js's far heads; the turf's flowering).
vec3 swHeadFarColor(float ripe) { return mix(vec3(0.25, 0.2, 0.19), vec3(0.42, 0.35, 0.21), ripe); }

// The sward as one surface, as the eye sees it from afar (a far blade and
// the turf where it stands for the blades). Its blades stand on average
// along swUp: the ground's normal gn tipped downwind by lean (the wind and
// its gusts: swLay), the way the bent blades lean. The direct light on it
// is its blades' mean as each is lit (scene_lighting.glsl's
// sceneSwardLight, SceneSurface::sward), so how a far meadow takes the sun
// follows from how its blades stand and where the eye and the sun are, as
// the near blades' own faces do: darker than level ground under a high sun
// seen across, faces lit with the sun behind the eye, shaded sides glowing
// through looking toward it; a gust's wave turns the blades it bends. What
// it mirrors of the sky and the sky's light on it take the faces' mean
// facet (the engine's grassCanopyNormal).
vec3 swUp(vec3 gn, vec2 lean) { return normalize(gn + vec3(lean.x, 0.0, lean.y)); }
// A blade's bend in the wind with the gust gust over it: the tilt it gains
// along its length (swTilt's w) before the blade's own flex and the wind
// response.
float swWindBend(float gust) {
    float calm = clamp(camera.windField.z / SW_REFERENCE_SPEED, 0.0, 2.0);
    float spd = camera.windField.z + gust * 4.0;
    return 0.1 * min(calm, 1.0) + spd * 0.07 + gust * 0.45;
}
// The lay of the sward seen from afar: how its blades lean downwind in the
// wind and the gust over them, as a tilt of swUp. As far as the blades it
// stands for bend (swWindBend over the upper blade the eye sees from afar,
// SW_LAY_SEEN of the tilt a blade gains to its tip), so a gust lays the far
// sward as it lays the near blades and a far meadow shows its waves where
// single blades are too fine to see bend.
const float SW_LAY_SEEN = 0.6;
// How far the wind's lay and its gusts show in the sward's sheen: none in
// still air (the gust field and the wind's way run on whatever the steady
// wind), all from half the reference wind.
float swGustStir() { return clamp(2.0 * camera.windField.z / SW_REFERENCE_SPEED, 0.0, 1.0); }
vec2 swLay(float gust) {
    float tilt = SW_LAY_SEEN * swWindBend(gust) * swGustStir() * SW_WIND;
    return camera.windField.xy * tan(min(tilt, 1.2));
}
// What a gust shows of a far sward beyond the mean light of its blades
// (sceneSwardLight, which averages their faces and so keeps little of a
// gust running across the view): the pale length of the blades it bends
// over, and where it eases the darker sward between them. About the gust
// field's mean (SW_GUST_MEAN of its strength), so the meadow's tone stays as
// it was and only its waves stand out. Times the sheen; the far blades take
// it from 4-20 m, the turf as they do.
const float SW_GUST_FAR = 1.0;
const float SW_GUST_MEAN = 0.34;   // sceneWindGustAt's mean over the field, per unit of camera.windGust.x
float swGustFar(float gust) {
    return SW_GUST_FAR * (gust - SW_GUST_MEAN * camera.windGust.x) * swGustStir();
}
// The share of a blade's shade along it that the eye sees on average from
// afar (the dark root and lit tip, weighted to the upper part that shows
// over the blades in front): a far blade takes this once along its length.
float swMeanShade() { return mix(SW_ROOT_SHADE, 1.0, 0.62); }
// A culm's head runs from SW_CULM_HEAD up its card (the top fifth or so of
// the culm); the first row of the card ends its bare stem at SW_CULM_STEM.
const float SW_CULM_STEM = 0.7;
const float SW_CULM_HEAD = 0.76;
// A far ring's live leaf is a fan card (surface.glsl.js's swFanSurface):
// this many leaves, the card this many times the leaf's width at its
// middle, their widths together SW_FAN_COVER of it (the leaf's cover: they
// are shorter than the card).
const float SW_FAN_STRANDS = 4.0;   // swFanSurface's loop
const float SW_FAN_WIDTH = 2.2;
const float SW_FAN_COVER = 1.8;
// A blade's colour over its lush or dry colour on average: its hue's spread
// (build.glsl.js's hue, the blue cut a little more than it is lifted) and
// its paler, yellower sheath over its foot.
const vec3 SW_BLADE_MEAN_TINT = vec3(1.03, 1.025, 0.88);

// --- The contract (bro's scene_sward_layer.glsl) ---------------------------

// A cell's root gathers toward its tussock where the grass grows in bunches;
// own: its tussock's middle, how bunched it grows there.
void swardRoot(inout SwardCell s) {
    float bunch = swBunch(s.root);
    vec3 tus = swTussock(s.root);
    s.own.xy = tus.xy;
    s.own.z = bunch;
    s.root = mix(s.root, tus.xy, SW_TUSSOCK_GATHER * tus.z * bunch);
}

// Clumps: thick and tall in some places, thin and short between, none on
// slopes steeper than the limit. The density thins blade by blade, so a
// thin patch is sparse tufts. own.w: the clump noise.
float swardDensity(inout SwardCell s) {
    float clump = swClump(s.root);
    s.own.w = clump;
    float minY = SW_MIN_Y;
    return (0.55 + 0.7 * clump) * s.f.g * smoothstep(minY - 0.05, minY + 0.05, s.ground.y);
}

// A tuft of the far tier: as tall as its blades stand there, its colour
// theirs from lush to sun-dried, as shaded as the sward on average.
SwardFarLook swardFarLook(SwardCell s, vec4 h) {
    float clump = s.own.w;
    SwardFarLook l;
    l.height = grassSwardHeight() * max(s.f.a, 0.2) * mix(1.0, 1.6, clump) * mix(0.8, 1.2, h.y);
    l.width = grass.herbInfo.y * 1.3;
    float lush = 1.0 - clamp(s.f.b, 0.0, 1.0);
    vec3 green = SW_LUSH * mix(vec3(0.9, 0.97, 1.05), vec3(1.1, 1.03, 0.85), h.z);
    l.body = mix(SW_DRY, green, clamp(lush * 1.3 - 0.15 + clump * 0.2, 0.0, 1.0)) * swMeanShade() * mix(0.88, 1.12, h.x);
    return l;
}

// The turf layer's sward channels: the clumps, the tall patches, the
// flowering patches' noise, each band-limited to fp.
vec3 swardBake(vec2 xz, float fp) {
    float k = SW_CLUMP_FREQ;
    float clump = (0.5 * sceneWindNoise(xz * k) + 0.25 * sceneWindNoise(xz * k * 2.03 + 17.3)) * 0.667;
    float tall = mix(0.5, sceneWindNoise(xz * 0.045 + 3.0) * 0.5 + 0.5, groundSeen(0.045, fp));
    return vec3(clamp(clump * groundSeen(k, fp) + 0.5, 0.0, 1.0), smoothstep(0.35, 0.8, tall),
                mix(0.5, swKindsNoise(xz), groundSeen(0.07, fp)));
}

// Blades lying low (short live ones, fallen dead ones): in each size m cell
// one, a keep share of the cells, tapering to a point at each end. Returns
// the share of the pixel on a blade; tone the topmost one's own 0..1.
float swLowBlades(vec2 xz, float size, float keep, float width, float fp, out float tone) {
    ivec2 i = ivec2(floor(xz / size));
    float on = 0.0;
    tone = 0.5;
    for (int y = -1; y <= 1; ++y)
        for (int x = -1; x <= 1; ++x) {
            ivec2 c = i + ivec2(x, y);
            if (groundHash(c, 21) > keep) continue;
            vec2 p = (vec2(c) + vec2(groundHash(c, 22), groundHash(c, 23))) * size;
            float a = groundHash(c, 24) * 3.14159265;
            vec2 d = vec2(cos(a), sin(a));
            float len = size * (0.6 + 0.9 * groundHash(c, 25));
            vec2 v = xz - p;
            float t = clamp(dot(v, d) / (0.5 * len), -1.0, 1.0);
            float dist = abs(dot(v, vec2(-d.y, d.x)));
            float w = size * width * (0.5 + 0.8 * groundHash(c, 26)) * sqrt(max(1.0 - t * t, 0.0));
            float cov = clamp((w + 0.5 * fp - dist) / fp, 0.0, 1.0) * min(w / max(fp, 1e-6) + 0.3, 1.0) *
                        step(abs(dot(v, d)), 0.5 * len);
            if (cov > on) {
                on = cov;
                tone = groundHash(c, 27);
            }
        }
    return on;
}

// A far gap among the blades: the sward seen deeper in, this much of its
// tops' light.
const float SW_TURF_DEPTH = 0.75;
// Past the blades, the sward's tops as the far blades show them: their
// leaves over the deeper ones between (SW_TURF_DEPTH where they part).
const float SW_TURF_TOPS = 0.95;

// The sward as one surface: the blades' mean colour, their clumps and
// their large patches of taller, lusher grass, with their dead leaves and
// flowering heads as the blades have them there.
SwardTurf swardTurf(SwardTurfIn t) {
    float clump = t.baked.x;
    float lush = 1.0 - t.dry;
    // (Their shade along them as the eye sees it on average, and their
    // hue's spread and paler, yellower sheaths, a little warmer.)
    vec3 sward = mix(SW_DRY, SW_LUSH, clamp(lush * 1.3 - 0.15 + clump * 0.2, 0.0, 1.0)) * swMeanShade() *
                 SW_BLADE_MEAN_TINT;
    vec2 kinds = swKindsOf(t.baked.z, lush, t.baked.y);
    sward = mix(sward, swDeadColor(0.5), kinds.y * 0.45);
    // (Seen across, their heads' haze: surface.glsl.js's far heads.)
    float ripe = clamp(1.1 - lush, 0.0, 1.0);
    float graze = 1.0 - smoothstep(0.05, 0.4, -t.rel.y / max(length(t.rel.xz), 1e-3));
    sward = mix(sward, mix(swHeadColor(ripe), swHeadFarColor(ripe), graze), min(kinds.x * 0.35, 0.3));

    SwardTurf o;
    o.tops = sward * SW_TURF_TOPS;
    // How much of the ground the blades cover, seen from above; far off a
    // thin clump's ground is hidden by the blades around it (they lean over
    // it, and the eye sees across): only thin grass leaves soil.
    o.cover = clamp(t.density * (0.35 + 0.9 * clump) * 1.4, 0.0, 1.0);
    o.cover = mix(o.cover, clamp(t.density * 1.4, 0.0, 1.0), 0.7 * t.deep);
    // Between the blades the ground shows: their dark roots and the soil
    // near the eye; further off, where a gap is a few blades' depth of the
    // sward rather than the ground under it, the blades seen deeper in, in
    // their shade (a gap among far blades is more grass, not a paler
    // ground).
    o.roots = mix(mix(t.soil, sward * SW_ROOT_SHADE, 0.6), sward * SW_TURF_DEPTH, t.deep);
    // Close by, what lies between the blades: thatch (dead blades, pale
    // straws lying every way), crumbs of soil, and the green of the bases.
    if (t.nearSeen > 0.0) {
        vec2 xz = t.xz;
        float fp = t.fp;
        float crumb = groundFbm(xz + 13.0, 45.0, fp, 2);
        float base = groundFbm(xz + 41.0, 14.0, fp, 2);
        // The foot of the sward: dark, the bases' green in shadow, crumbs
        // of soil showing in its thin places.
        float fine = groundFbm(xz + 7.0, 110.0, fp, 1);
        float bare = smoothstep(0.66, 0.86, 0.6 * fine + 0.4 * crumb + 0.35 * (1.0 - t.density) - 0.2 * base) * 0.8;
        vec3 nearRoots = mix(sward * SW_ROOT_SHADE * (0.25 + 0.15 * crumb), t.soil * (0.4 + 0.4 * fine), bare);
        // Short live blades lying every way over it, each its own tone (some
        // turned to the light), and fewer fallen dead ones, thin and pale to
        // dun, tapering to their points.
        float tA, tB, tS;
        vec2 xr = vec2(xz.x * 0.5 - xz.y * 0.866, xz.x * 0.866 + xz.y * 0.5);
        float lowA = swLowBlades(xr + 5.3, 0.05, 0.85, 0.07, fp, tA);
        float lowB = swLowBlades(vec2(xz.y, -xz.x) + 2.9, 0.04, 0.75, 0.07, fp, tB);
        float straw = swLowBlades(xz + vec2(3.7, 1.3), 0.08, 0.3 + 0.4 * t.dry, 0.03, fp, tS);
        vec3 live = sward * SW_ROOT_SHADE;
        nearRoots = mix(nearRoots, live * (0.6 + 0.7 * tA), lowA * 0.9);
        nearRoots = mix(nearRoots, mix(live, SW_DRY * 0.7, 0.3 * tB) * (0.5 + 0.6 * tB), lowB * 0.85);
        vec3 strawC = mix(vec3(0.11, 0.09, 0.055), SW_DRY * 0.85, tS) * (0.75 + 0.4 * crumb);
        nearRoots = mix(nearRoots, strawC, straw * 0.8);
        o.roots = mix(o.roots, nearRoots, t.nearSeen);
    }
    return o;
}

// The way the sward's blades stand at xz over a ground of normal gn, tipped
// by its lay in the wind and its gusts as the far blades are; w: a gust's
// lift of the sheen of what it bends.
vec4 swardLay(vec2 xz, vec3 gn) {
    float gu = sceneWindGustAt(xz);
    return vec4(swUp(gn, swLay(gu)), SW_SHEEN * (gu * swGustStir() * 0.7 + swGustFar(gu)));
}
`;
