// surface.glsl.js — the trees module's fragment half (PLANT_SHADE): a leaf
// lit as its lobe's form more than its own face (more so as an element
// stands for more leaves), a near leaf's face toned toward its stalk with a
// pale midrib, and the light the sun shows through it from behind. Bark is
// as built. See index.js.

export const SURFACE = /* glsl */ `
#ifdef PLANT_SHADE
float treeHash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1) * 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float treeNoise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(treeHash(i), treeHash(i + vec3(1, 0, 0)), f.x),
                   mix(treeHash(i + vec3(0, 1, 0)), treeHash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(treeHash(i + vec3(0, 0, 1)), treeHash(i + vec3(1, 0, 1)), f.x),
                   mix(treeHash(i + vec3(0, 1, 1)), treeHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

// Bark, in world metres (stretched up the trunk: a limb's runs along its
// world axis no better than a trunk's do, and is mostly hidden). A dark
// bark is ridged by furrows running up it, with grey-green lichen in
// patches; a pale one (a birch's) is smooth with dark dashes across it and
// dark blotches. Its relief tilts the normal while the furrows span
// pixels, and fades to the mean colour as they do not.
PlantSurface treeBark(PlantFragment f) {
    vec3 N = normalize(f.normal);
    vec3 wp = f.pos + camera.eyeWorld.xyz;
    vec3 dpx = dFdx(f.pos), dpy = dFdy(f.pos);
    float px = max(length(dpx), length(dpy));
    float fine = 1.0 - smoothstep(0.004, 0.02, px);      // the furrows resolved
    bool pale = dot(f.albedo, vec3(0.3333)) > 0.3;
    float relief, tone;
    vec3 col;
    if (!pale) {
        float n1 = treeNoise(wp * vec3(11.0, 1.1, 11.0));
        float n2 = treeNoise(wp * vec3(37.0, 3.5, 37.0) + 7.3);
        float ridge = 1.0 - abs(2.0 * n1 - 1.0);           // 1 a ridge's crest, 0 a furrow
        relief = mix(0.55, ridge * 0.75 + n2 * 0.25, fine);
        tone = mix(0.45, 1.3, relief);
        col = f.albedo * tone;
        float lichen = smoothstep(0.55, 0.8, treeNoise(wp * vec3(2.2, 0.9, 2.2) + 3.1)) * smoothstep(0.3, 0.8, relief);
        col = mix(col, vec3(0.16, 0.18, 0.13), 0.6 * lichen);
    } else {
        float dash = smoothstep(0.62, 0.8, treeNoise(wp * vec3(5.0, 45.0, 5.0))) * fine;
        float blot = smoothstep(0.6, 0.78, treeNoise(wp * vec3(3.0, 1.6, 3.0) + 11.0));
        relief = 1.0 - 0.6 * dash - 0.3 * blot;
        col = f.albedo * (0.92 + 0.16 * treeNoise(wp * vec3(9.0, 3.0, 9.0)));
        col = mix(col, vec3(0.035, 0.03, 0.028), max(0.9 * dash, 0.75 * blot));
    }
    // The relief's bump (a few cm deep) on the tube's normal.
    float hgt = relief * 0.02 * fine;
    float dhx = dFdx(hgt), dhy = dFdy(hgt);
    vec3 r1 = cross(dpy, N), r2 = cross(N, dpx);
    float det = dot(dpx, r1);
    if (abs(det) > 1e-12) N = normalize(abs(det) * N - sign(det) * (dhx * r1 + dhy * r2));
    return PlantSurface(col, N, vec3(0.0));
}

// A painted crown (the engine's disc for the whole plant past the real
// band): its foliage as clumps, a few across the crown, each a dome of its
// own lit on its sunward side, darker in the hollows between. Their size
// is the crown's (its radius in metres from the disc's own derivatives: uv
// counts its horizontal radii), placed in world metres, so each tree's are
// its own.
// The clumps' relief fades to the mean as they span few pixels.
PlantSurface treePainted(PlantFragment f, TreeLook t) {
    vec3 N = normalize(f.crownNormal);
    vec3 wp = f.pos + camera.eyeWorld.xyz;
    vec3 dpx = dFdx(f.pos), dpy = dFdy(f.pos);
    float duv = max(length(dFdx(f.uv)), length(dFdy(f.uv)));
    float px = max(length(dpx), length(dpy));
    float radius = px / max(duv, 1e-6);
    float clump = max(0.3 * radius, 0.4);
    float h = smoothstep(0.2, 0.8, 0.65 * treeNoise(wp / clump) + 0.35 * treeNoise(wp / (0.45 * clump) + 5.7));
    float seen = 1.0 - smoothstep(0.08, 0.3, px / clump);   // the clumps resolved
    // Their bump on the dome.
    float hgt = h * 0.5 * clump * seen;
    float dhx = dFdx(hgt), dhy = dFdy(hgt);
    vec3 r1 = cross(dpy, N), r2 = cross(N, dpx);
    float det = dot(dpx, r1);
    if (abs(det) > 1e-12) N = normalize(abs(det) * N - sign(det) * (dhx * r1 + dhy * r2));
    vec3 col = f.albedo * mix(1.0, mix(0.4, 1.35, h), seen);
    return PlantSurface(col, N, t.glowColor * t.glow);
}

PlantSurface plantSurface(PlantFragment f) {
    if (f.wood) return treeBark(f);
    if (f.painted) return treePainted(f, treeLook(f.species));
    TreeLook t = treeLook(f.species);
    vec3 N = normalize(mix(f.normal, f.crownNormal, mix(0.6, 0.9, f.far)));
    // A near leaf's own face: darker toward its stalk, its midrib a pale
    // line, its blade a touch lighter toward the edge (thinner); gone as
    // the element stands for many.
    float along = clamp(f.uv.y, 0.0, 1.0), across = abs(f.uv.x);
    float tone = mix(0.78, 1.05, smoothstep(0.0, 0.8, along)) * (1.0 + 0.12 * smoothstep(0.15, 0.45, across));
    float rib = (1.0 - smoothstep(0.012, 0.035, across)) * (1.0 - smoothstep(0.75, 0.95, along));
    vec3 face = f.albedo * tone + rib * 0.35 * f.albedo;
    return PlantSurface(mix(face, f.albedo, f.far), N, t.glowColor * t.glow);
}
#endif
`;
