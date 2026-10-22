// surface.glsl.js — the trees module's fragment half (PLANT_SHADE): a leaf
// lit as its lobe's form more than its own face (more so as an element
// stands for more leaves), a near leaf's face toned toward its stalk with a
// pale midrib, and the light the sun shows through it from behind. Bark is
// as built. See index.js.

export const SURFACE = /* glsl */ `
#ifdef PLANT_SHADE
PlantSurface plantSurface(PlantFragment f) {
    if (f.wood) return PlantSurface(f.albedo, normalize(f.normal), vec3(0.0));
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
