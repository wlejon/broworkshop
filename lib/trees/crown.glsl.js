// crown.glsl.js — the trees module's build half: a plant as a crown of
// LOBES (clumps of foliage round its limbs) over a trunk with a limb to
// each, its foliage leaf-shaped elements about the lobes, bent by the wind.
// See index.js.
//
// One sequence at every distance: element k is in lobe k mod lobes, so
// every prefix the engine draws covers the whole crown, and each grows as
// the count falls (PlantElementIn.grow) so the crown stays covered: up close
// thousands of leaves, far off a few dozen broad daubs of its colours.

export const CROWN = /* glsl */ `
// A species' look, its plantData (index.js's treeSpecies packs it).
struct TreeLook {
    float lobeSize, leafWidth, trunk, spread;
    vec3 light;
    float droop;
    vec3 dark;
    float hueVar;
    vec3 bark;
    float glow;
    vec3 glowColor;
    float needle;
};

TreeLook treeLook(int species) {
    vec4 a = plantData(species, 0), b = plantData(species, 1), c = plantData(species, 2);
    vec4 d = plantData(species, 3), e = plantData(species, 4);
    TreeLook t;
    t.lobeSize = a.x; t.leafWidth = a.y; t.trunk = a.z; t.spread = a.w;
    t.light = b.xyz; t.droop = b.w;
    t.dark = c.xyz; t.hueVar = c.w;
    t.bark = d.xyz; t.glow = d.w;
    t.glowColor = e.xyz; t.needle = e.w;
    return t;
}

int treeLobes(PlantSpecies s) { return clamp(s.limbs, 1, PLANT_MAX_LIMBS); }

// Lobe j of a plant: its centre (plant frame) and radius. The lobes lie
// over the envelope on a golden-angle spiral from the top down, jittered by
// the seed, each pulled in by its own radius so the crown's outline is
// theirs: lumpy, with sky through the gaps between them.
vec4 treeLobe(PlantSpecies s, TreeLook t, PlantCrown c, uint seed, int j) {
    float n = float(treeLobes(s));
    float u = (float(j) + 0.5 + 0.6 * (plantRand(seed, uint(j) * 7u + 1u) - 0.5)) / n;
    // Lobes thin toward the crown's foot, where its lowest limbs reach out.
    float v = 1.0 - 2.0 * pow(u, 0.85);
    float ang = float(j) * 2.39996323 + plantRand(seed, 3u) * 6.2831853 + 0.5 * plantRand(seed, uint(j) * 7u + 2u);
    float w = plantCrownWidth(c, v);
    float lr = t.lobeSize * c.radii.x * (0.7 + 0.6 * plantRand(seed, uint(j) * 7u + 3u)) *
               mix(1.0, 0.55 + 0.45 * w, c.shape);
    float out_ = max(w * c.radii.x - 0.8 * lr, 0.0) * mix(0.55, 1.0, t.spread);
    // A round crown's clumps fill it, some deep inside, so it is a mass and
    // not a shell; a cone's are its branches' tips, out at its skin.
    out_ *= mix(0.3 + 0.7 * sqrt(plantRand(seed, uint(j) * 7u + 5u)), 1.0, c.shape);
    vec3 at = c.center + vec3(cos(ang) * out_, v * max(c.radii.y - 0.6 * lr, 0.0), sin(ang) * out_);
    return vec4(at, lr);
}

// The wind's push on a point up metres up a plant: the trunk bends as a
// cantilever (the square of the height up it), each lobe rides it with a
// lag of its own. World metres, horizontal.
vec3 plantSway(Plant p, PlantSpecies s, float up, float lag) {
    float height = s.height * p.scale;
    vec4 w = sceneWind(p.pos - camera.eyeWorld.xyz);
    float t = camera.windParams.x;
    float f = clamp(up / max(height, 0.1), 0.0, 1.2);
    float bend = f * f * (0.012 + 0.03 * w.w) * height;
    float sway = 0.6 + 0.4 * sin(t * 1.3 + plantRand(p.seed, 11u) * 6.2831853 + lag);
    return vec3(w.x, 0.0, w.z) * (bend * sway / max(length(w.xz), 0.5));
}

// The element polygon's point c (base, left 1, right 1, left 2, right 2,
// tip) as (across, along). A needle tree's is a spray of shoots: narrower
// at the base, square at the tip.
vec2 plantLeafPoint(int species, int c) {
    const vec2 pts[6] = vec2[6](vec2(0.0, 0.0), vec2(-0.48, 0.32), vec2(0.48, 0.32),
                                vec2(-0.36, 0.72), vec2(0.36, 0.72), vec2(0.0, 1.0));
    vec2 q = pts[clamp(c, 0, 5)];
    q.x *= mix(1.0, q.y < 0.5 ? 0.6 : 1.1, plantData(species, 4).w);
    return q;
}

#ifdef PLANT_BUILD
// Element k. Drawn with fewer elements than its crown has lobes, a plant
// spreads them over the lobes and lets each grow past its lobe's size, as
// wide as its share of the crown, drawn in toward the crown's centre as
// it grows: a far tree is a few broad daubs over its whole crown, its
// shadow the same.
bool plantElement(Plant p, PlantSpecies s, PlantCrown cr, PlantElementIn k, inout PlantElement e) {
    TreeLook t = treeLook(s.index);
    int lobes = treeLobes(s);
    float share = max(float(lobes) / max(ceil(k.n), 1.0), 1.0);
    int j = share > 1.0 ? int(float(k.k) * share) % lobes : k.k % lobes;
    vec4 lobe = treeLobe(s, t, cr, p.seed, j);
    lobe.xyz = mix(lobe.xyz, cr.center, 1.0 - inversesqrt(share));
    uint ks = p.seed * 0x2c1b3c6du + uint(k.k) * 0x297a2d39u;

    // Where in its lobe: mostly near its skin, facing out from the crown's
    // centre more than from the lobe's, and up toward the light.
    vec3 fromCrown = normalize((lobe.xyz - cr.center) / max(cr.radii, vec3(0.1)) + vec3(0.0, 0.35, 0.0));
    vec3 d = normalize(plantSphere(plantRand(ks, 1u), plantRand(ks, 2u)) + 0.8 * fromCrown);
    float depth = 1.0 - sqrt(plantRand(ks, 3u));       // 0 skin .. 1 core
    // A needle tree's lobe is a branch's tier: a flat spray, wider than it
    // is deep, hanging at its tips.
    vec3 lobeShape = vec3(1.0, mix(1.0, 0.35, t.needle), 1.0);
    vec3 local = lobe.xyz + d * lobeShape * lobe.w * (1.0 - 0.75 * depth);
    local.y -= t.needle * t.droop * lobe.w * dot(d.xz, d.xz) * 0.8;

    // Fewer elements, each bigger, never past its share of the crown.
    float maxGrow = 1.7 * lobe.w * sqrt(share) / max(s.leafLen * p.scale, 1e-3);
    float grow = min(k.grow, max(maxGrow, 1.0));
    float size = s.leafLen * p.scale * grow * (0.75 + 0.5 * plantRand(ks, 4u)) * k.last;
    e.far = clamp((grow - 1.0) / 6.0, 0.0, 1.0);

    // Its facing: about the crown's outward normal, scattered; daubs turn
    // toward the eye as they grow, so a few still cover the crown edge-on.
    vec3 crownN = normalize((local - cr.center) / max(cr.radii * cr.radii, vec3(0.01)));
    vec3 scatter = plantSphere(plantRand(ks, 5u), plantRand(ks, 6u));
    vec3 nrm = normalize(mix(crownN, scatter, mix(0.65, 0.45, t.needle)));
    vec3 worldBase = plantToWorld(p, local);
    vec3 toEye = normalize(camera.eyeWorld.xyz - worldBase);
    vec3 nW = normalize(mix(plantDirToWorld(p, nrm), toEye, 0.85 * e.far));
    // Along the leaf: outward and down by its droop, square to its normal.
    vec3 alongW = plantDirToWorld(p, normalize(d + vec3(0.0, -1.2 * t.droop, 0.0) + 0.6 * scatter));
    alongW = alongW - nW * dot(alongW, nW);
    if (dot(alongW, alongW) < 1e-6) alongW = abs(nW.y) < 0.9 ? cross(nW, vec3(0.0, 1.0, 0.0)) : vec3(1.0, 0.0, 0.0);
    alongW = normalize(alongW);
    vec3 acrossW = cross(nW, alongW);

    // The wind: the trunk's bend at the lobe's height, and the leaf's flutter.
    vec3 sway = plantSway(p, s, local.y, float(j) * 0.7);
    float time = camera.windParams.x;
    float flutter = sin(time * (6.0 + 5.0 * plantRand(ks, 7u)) + 6.2831853 * plantRand(ks, 8u)) * (1.0 - e.far);
    vec4 wind = sceneWind(worldBase - camera.eyeWorld.xyz);
    vec3 nF = normalize(nW + alongW * flutter * (0.15 + 0.25 * wind.w) * (1.0 - t.needle * 0.7));

    float width = size * mix(t.leafWidth, 0.5, e.far);
    // The element's centre sits on its point: the leaf hangs from a petiole
    // behind it, the daub is centred.
    e.base = worldBase + sway - alongW * size * mix(0.15, 0.5, e.far) - camera.eyeWorld.xyz;
    e.along = alongW * size;
    e.across = acrossW * width;
    e.leafNormal = nF;
    // The form it is lit as: its lobe's round, on the crown's (a crown of
    // lobes reads as a cluster of lit domes, each with its shaded side).
    e.crownNormal = plantDirToWorld(p, normalize(0.6 * d + 0.4 * crownN));

    // Its colour: the species' light and dark mixed by how deep in the
    // crown it is and how far up, shifted per plant and per lobe. A daub
    // standing for many leaves is their mean: its own depth and jitter fade
    // with how many it stands for, so a far crown is its form's light and
    // shade, not a speckle of single leaves.
    float hp = (plantRand(p.seed, 21u) - 0.5) * t.hueVar + 0.35 * p.tint;
    float hl = (plantRand(p.seed, uint(j) * 7u + 4u) - 0.5) * t.hueVar;
    float up = clamp((local.y - cr.center.y) / max(cr.radii.y, 0.1) * 0.5 + 0.5, 0.0, 1.0);
    float near_ = 1.0 - e.far;
    vec3 col = mix(t.dark, t.light, clamp(0.35 + 0.45 * up - 0.4 * mix(0.35, depth, near_) + hl, 0.0, 1.0));
    col *= 1.0 + hp;
    col *= vec3(1.0 + 0.6 * hl, 1.0, 1.0 - 0.8 * hl);   // warmer or cooler
    col *= 1.0 + (0.2 * plantRand(ks, 9u) - 0.1) * near_;
    e.albedo = max(col, vec3(0.0));
    e.crownCenter = plantToWorld(p, cr.center) + sway - camera.eyeWorld.xyz;
    e.depth = depth;
    return true;
}
#endif

// Tube limb: 0 the trunk, up through the crown to most of the way to its
// top; then a limb to each lobe, from the trunk out to the lobe's heart,
// rising to it as a limb does (a broadleaf's steeply, a conifer's nearly
// level), never below the crown's foot.
bool plantLimb(Plant p, PlantSpecies s, PlantCrown cr, int limb, out PlantLimb l) {
    TreeLook t = treeLook(s.index);
    float h = s.height * p.scale;
    float r0 = t.trunk * p.scale;
    float hp = (plantRand(p.seed, 22u) - 0.5) * 0.3;
    l = PlantLimb(vec3(0.0), vec3(0.0), 0.0, 0.0, 0.0, t.bark * (1.0 + hp));
    if (limb > treeLobes(s)) return false;
    if (limb == 0) {
        l.a = vec3(0.0, -0.3, 0.0);
        l.b = vec3(0.0, mix(cr.center.y, h, 0.6 * (1.0 - s.shape) + 0.35 * s.shape), 0.0);
        l.ra = r0;
        l.rb = r0 * 0.35;
        return true;
    }
    vec4 lobe = treeLobe(s, t, cr, p.seed, limb - 1);
    float fy = clamp((lobe.y - cr.center.y) / max(cr.radii.y, 0.1) * 0.5 + 0.5, 0.0, 1.0);
    float reach = length(lobe.xz);
    l.a = vec3(0.0, max(lobe.y - reach * mix(1.1, 0.15, s.shape), h * s.base * 0.8), 0.0);
    l.b = lobe.xyz - vec3(lobe.x, 0.0, lobe.z) / max(reach, 1e-3) * 0.3 * lobe.w;
    l.ra = r0 * mix(0.5, 0.28, fy) * (0.6 + 0.6 * lobe.w / max(cr.radii.x, 0.1));
    l.rb = l.ra * 0.35;
    l.lag = float(limb - 1) * 0.7;
    return true;
}
`;
