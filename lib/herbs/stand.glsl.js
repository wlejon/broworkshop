// stand.glsl.js — the herb module's every-stage half: which plant stands in
// a cell (herbStand), and the layer as the far tier and the turf take it
// (herbFarMean, herbFarLocal, herbFarLook). See index.js.
//
// The data (index.js packs it; herbData(i) reads it):
//   0                      x the species' count
//   1 + i * 14 + k         species i's broflora herbRecord, vec4 k:
//     0 habit, height, spread, leaves      7 bloomColor, nod
//     1 stems, leafShape, length, width    8 centreColor, ribDiameter
//     2 tip, teeth, toothDepth, pinnae     9 shade, shadeRange, abundance, patch
//     3 lobes, stalk, rise, arch           10 patchCover, bloomShare, cover, hairs
//     4 leafColor, gloss                   11 stem freq, stem sway, leaf freq, leaf sway
//     5 stemColor, stemDiameter            12 spacing, side cover, its blooms' share, leaf top
//     6 bloomForm, bloomSize, bloomCount, petals   13 stemLeaves, stemLeafSize, -, -
//   HERB_MEAN_AT + s * 3   the herbs' mean over their colonies at canopy
//                          s / (HERB_MEAN_STEPS - 1) (index.js meanTable)
//
// Each cell holds at most one plant, and nothing about it is stored:
//   - each species weighs in at a point by its abundance, by how well the
//     light there suits it (the canopy overhead against its shade
//     preference) and by its colonies (value noise of its own period, its
//     patchCover of the ground inside them), times how many of its plants a
//     cell holds (a daisy in every cell, a foxglove in one of several: its
//     spacing);
//   - the cell holds a plant with the weights' sum (to 1) times the floor's
//     herb density, and which one by a hash among the weights.

export const STAND = /* glsl */ `
#define HERB_MAX 12
#define HERB_RECORD 14
#define HERB_MEAN_STEPS 5
#define HERB_MEAN_AT 169

vec4 herbRec(int i, int k) { return herbData(1 + i * HERB_RECORD + k); }
int herbCount() { return min(int(herbData(0).x + 0.5), HERB_MAX); }

// A hairy stem's card reaches this many of the stem's diameters past each
// side, times its hairs, for the hairs to stand in.
const float HERB_STEM_HAIR_ROOM = 0.6;

// Species i's weight inside its colonies under canopy \`canopy\`: its
// abundance, how well the light suits it and how many of its plants a cell
// holds (one a cell where they stand closer than a cell, fewer where they
// stand further apart). 0 where it does not grow.
float herbWeightInside(int i, float canopy) {
    vec4 h9 = herbRec(i, 9);
    if (h9.z <= 0.0) return 0.0;
    float dl = (canopy - h9.x) / max(h9.y, 0.05);
    float light = exp(-dl * dl);
    if (light < 0.03) return 0.0;
    float s = herbRec(i, 12).x;
    float spacing = s > 0.0 ? s : 1.6 * max(herbRec(i, 0).z, 0.02);
    float occupy = min(1.0, pow(grass.herbInfo.y / spacing, 2.0));
    return h9.z * light * occupy;
}

// Species i's colonies at absolute xz: 0 outside .. 1 inside. Two octaves
// of value noise at its own period, offset species by species; the
// threshold leaves about patchCover inside. \`fp\` the pixel's footprint (m;
// 0: none): each octave fades out as its period nears two pixels, and the
// colonies to their mean cover (patchCover) as the first does, so far off
// they are a filter's mean, not a pattern aliasing (nor their noise paid).
float herbColony(int i, vec2 xz, float fp) {
    float period = max(herbRec(i, 9).w, 0.5);
    float seen = fp > 0.0 ? clamp(0.5 * period / fp - 1.0, 0.0, 1.0) : 1.0;
    float mean = clamp(herbRec(i, 10).x, 0.05, 1.0);
    if (seen <= 0.0) return mean;
    float seen2 = fp > 0.0 ? clamp(0.5 * period / (2.7 * fp) - 1.0, 0.0, 1.0) : 1.0;
    vec2 p = xz / period + vec2(float(i) * 37.13 + 11.0, float(i) * -19.71 + 3.0);
    float n = 0.5 + 0.33 * sceneWindNoise(p) + (seen2 > 0.0 ? 0.17 * seen2 * sceneWindNoise(p * 2.7 + 5.1) : 0.0);
    float t = mix(0.7, 0.3, clamp(herbRec(i, 10).x, 0.0, 1.0));
    return mix(mean, smoothstep(t - 0.07, t + 0.07, n), seen);
}

int herbStand(ivec2 cell, vec2 xz, vec2 floorAt) {
    int n = herbCount();
    float u0 = grassHash(cell, 105), u1 = grassHash(cell, 106);
    float canopy = floorAt.x, density = floorAt.y;
    // (The cell holds a plant with at most the density's chance: most cells
    // of a thin floor are settled before any species is weighed.)
    if (n <= 0 || u0 >= density) return -1;
    float w[HERB_MAX];
    float sum = 0.0;
    for (int i = 0; i < HERB_MAX; ++i) {
        float wi = i < n ? herbWeightInside(i, canopy) : 0.0;
        w[i] = wi > 0.0 ? wi * herbColony(i, xz, 0.0) : 0.0;
        sum += w[i];
    }
    if (sum <= 0.0 || u0 >= density * min(sum, 1.0)) return -1;
    float pick = u1 * sum;
    for (int i = 0; i < n; ++i) {
        pick -= w[i];
        if (pick < 0.0) return i;
    }
    return n - 1;
}

// The herbs' mean over their colonies (the table, by the canopy), seen at
// an elevation whose tangent is \`tanView\` (a grazing view sees the plants'
// sides over the ground between them, so a meadow seen across reads as its
// flowers and leaves, from above as much ground as they leave bare). No
// noise, no loop over the species.
HerbMix herbFarMean(float canopy, float density, float tanView) {
    float x = clamp(canopy, 0.0, 1.0) * float(HERB_MEAN_STEPS - 1);
    int i = min(int(x), HERB_MEAN_STEPS - 2);
    float f = x - float(i);
    int at = HERB_MEAN_AT + i * 3;
    vec4 a0 = mix(herbData(at), herbData(at + 3), f);
    vec4 a1 = mix(herbData(at + 1), herbData(at + 4), f);
    vec4 a2 = mix(herbData(at + 2), herbData(at + 5), f);
    float side = a2.x / max(tanView, 0.02);
    HerbMix m;
    m.cover = a2.z * (1.0 - exp(-density * (a0.x + side)));
    m.leaf = a0.yzw;
    m.bloom = a1.yzw;
    m.bloomShare = (a0.x * a1.x + side * a2.y) / max(a0.x + side, 1e-5);
    return m;
}

// The blooms past the plants, patch by patch: herbFarMean is the herbs'
// mean over every colony, so far off a meadow's poppies, daisies and
// foxgloves would blend into one muddy tint everywhere. This weighs each
// blooming species by its colonies at xz (as herbStand does for a plant)
// against its mean over them (its patchCover inside), so a stretch of
// poppies reads red and one of daisies white, and the blooms' mean over the
// land is the table's. (A loop over the species with two noises each: only
// where the turf or a far blade stands for the herbs' blooms.)
float herbFarLocal(vec2 xz, float canopy, float u, float fp, out vec3 bloom, out vec3 pick) {
    int n = herbCount();
    float B[HERB_MAX];
    float local = 0.0, mean = 0.0;
    vec3 col = vec3(0.0);
    for (int i = 0; i < HERB_MAX; ++i) {
        B[i] = 0.0;
        if (i >= n) continue;
        vec4 h10 = herbRec(i, 10), h12 = herbRec(i, 12);
        // Its blooms' cover from above and from the side, as far as they
        // stand over the grass (index.js meanTable).
        float sward = 0.7 * grass.blade.x;
        float over = clamp((herbRec(i, 0).y - 0.6 * sward) / (0.8 * sward), 0.0, 1.0);
        float shown = h10.z * h10.y + h12.y * h12.z * over;
        if (shown <= 0.0) continue;
        float w = herbWeightInside(i, canopy);
        if (w <= 0.0) continue;
        float spread = herbRec(i, 0).z;
        float b = w * shown * spread * spread;
        mean += b * clamp(h10.x, 0.05, 1.0);
        B[i] = b * herbColony(i, xz, fp);
        local += B[i];
        col += B[i] * herbRec(i, 7).rgb;
    }
    bloom = local > 0.0 ? col / local : vec3(0.0);
    pick = bloom;
    if (u >= 0.0 && local > 0.0) {
        float k = u * local;
        for (int i = 0; i < HERB_MAX; ++i) {
            if (i >= n) break;
            k -= B[i];
            if (k < 0.0) { pick = herbRec(i, 7).rgb; break; }
        }
    }
    return mean > 0.0 ? local / mean : 0.0;
}

// A species as one element of the far tier: a mound as tall as it grows and
// as wide as it spreads, in its leaves' colour, dotted with its blooms.
HerbFarLook herbFarLook(int variety, vec4 h) {
    vec4 r0 = herbRec(variety, 0);
    HerbFarLook l;
    l.size = mix(0.55, 1.35, h.y);
    l.height = max(r0.y, 0.05);
    l.width = 2.0 * r0.z;
    l.body = herbRec(variety, 4).rgb * mix(0.85, 1.15, h.x);
    l.bloom = herbRec(variety, 7).rgb;
    l.bloomShare = herbRec(variety, 10).y;
    return l;
}
`;
