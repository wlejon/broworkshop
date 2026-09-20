// kinds.js — Mesh definitions and TileWorld object kind registration for DeepDelve.

export function registerKinds(world) {
    const M = Mesh;
    return {
        player: world.addObjectKind(
            M.merge([
                M.cylinder(0.15, 0.04, 10).translate(0, 0.04, 0),
                M.capsule(0.115, 0.13, 10, 6).translate(0, 0.30, 0),
                M.sphere(0.085, 10, 8).translate(0, 0.52, 0),
                M.box(0.03, 0.30, 0.03).rotate(0, 0, 1, 0.5).translate(0.17, 0.36, 0.03),
            ]), { color: [1, 1, 1, 1], roughness: 0.7 }),
        rat: world.addObjectKind(
            M.merge([
                M.capsule(0.085, 0.09, 8, 6).rotate(1, 0, 0, Math.PI / 2).translate(0, 0.09, 0),
                M.sphere(0.06, 8, 6).translate(0, 0.12, 0.11),
                M.cone(0.02, 0.14, 5, 1, true).rotate(1, 0, 0, -Math.PI / 2).translate(0, 0.08, -0.16),
            ]), { color: [1, 1, 1, 1], roughness: 0.9 }),
        wolf: world.addObjectKind(
            M.merge([
                M.box(0.14, 0.12, 0.34).translate(0, 0.16, 0),
                M.sphere(0.075, 8, 6).translate(0, 0.24, 0.20),
                M.cone(0.035, 0.05, 4, 1, true).translate(-0.04, 0.31, 0.22),
                M.cone(0.035, 0.05, 4, 1, true).translate(0.04, 0.31, 0.22),
            ]), { color: [1, 1, 1, 1], roughness: 0.9 }),
        archer: world.addObjectKind(
            M.merge([
                M.capsule(0.09, 0.15, 8, 6).translate(0, 0.28, 0),
                M.sphere(0.075, 8, 6).translate(0, 0.50, 0),
                M.torus(0.11, 0.014, 10, 6).rotate(0, 1, 0, Math.PI / 2).translate(0.14, 0.32, 0),
            ]), { color: [1, 1, 1, 1], roughness: 0.85 }),
        ogre: world.addObjectKind(
            M.merge([
                M.box(0.26, 0.26, 0.20).translate(0, 0.26, 0),
                M.sphere(0.11, 10, 8).translate(0, 0.48, 0.02),
                M.box(0.08, 0.24, 0.08).translate(-0.20, 0.22, 0),
                M.box(0.08, 0.24, 0.08).translate(0.20, 0.22, 0),
            ]), { color: [1, 1, 1, 1], roughness: 0.95 }),
        potion: world.addObjectKind(
            M.merge([
                M.sphere(0.075, 8, 6).translate(0, 0.08, 0),
                M.cylinder(0.03, 0.07, 6).translate(0, 0.16, 0),
            ]), { color: [0.85, 0.16, 0.26, 1], roughness: 0.3 }),
        gold: world.addObjectKind(
            M.merge([
                M.sphere(0.07, 8, 6).translate(0, 0.05, 0),
                M.sphere(0.055, 8, 6).translate(0.09, 0.045, 0.05),
                M.sphere(0.05, 8, 6).translate(-0.06, 0.04, 0.08),
            ]), { color: [1.0, 0.82, 0.28, 1], roughness: 0.35, metallic: 0.7 }),
        weapon: world.addObjectKind(
            M.merge([
                M.box(0.035, 0.36, 0.035).translate(0, 0.24, 0),
                M.box(0.15, 0.03, 0.05).translate(0, 0.12, 0),
                M.sphere(0.03, 6, 5).translate(0, 0.045, 0),
            ]).rotate(0, 0, 1, 0.35), { color: [0.80, 0.85, 0.95, 1], roughness: 0.25, metallic: 0.8 }),
        armor: world.addObjectKind(
            M.merge([
                M.box(0.20, 0.20, 0.13).translate(0, 0.14, 0),
                M.sphere(0.055, 8, 6).translate(-0.12, 0.24, 0),
                M.sphere(0.055, 8, 6).translate(0.12, 0.24, 0),
            ]), { color: [0.55, 0.62, 0.75, 1], roughness: 0.35, metallic: 0.75 }),
        amulet: world.addObjectKind(
            M.merge([
                M.cylinder(0.10, 0.06, 8).translate(0, 0.06, 0),
                M.cylinder(0.045, 0.42, 8).translate(0, 0.28, 0),
                M.cylinder(0.09, 0.03, 8).translate(0, 0.50, 0),
                M.torus(0.09, 0.028, 14, 8).translate(0, 0.66, 0),
            ]), { color: [1.0, 0.80, 0.25, 1], roughness: 0.25, metallic: 0.8 }),
        door: world.addObjectKind(
            M.box(0.46, 0.40, 0.05).translate(0, 0.40, 0),   // box() takes half-extents
            { color: [0.42, 0.28, 0.15, 1], roughness: 0.9 }),
        spikes: world.addObjectKind(
            M.merge([
                M.cone(0.035, 0.16, 5, 1, true).translate(-0.10, 0.08, -0.08),
                M.cone(0.035, 0.18, 5, 1, true).translate(0.08, 0.09, 0.06),
                M.cone(0.035, 0.14, 5, 1, true).translate(-0.02, 0.07, 0.12),
                M.cone(0.035, 0.15, 5, 1, true).translate(0.10, 0.075, -0.10),
            ]), { color: [0.72, 0.72, 0.78, 1], roughness: 0.3, metallic: 0.6 }),
        rubble: world.addObjectKind(
            M.rock(0.13, 8, 2).translate(0, 0.07, 0),
            { color: [0.45, 0.45, 0.52, 1], roughness: 1.0 }),
        bone: world.addObjectKind(
            M.merge([
                M.cylinder(0.02, 0.22, 5).rotate(0, 0, 1, Math.PI / 2).translate(0, 0.03, 0),
                M.sphere(0.03, 6, 5).translate(-0.11, 0.03, 0),
                M.sphere(0.03, 6, 5).translate(0.11, 0.03, 0),
            ]), { color: [0.85, 0.83, 0.74, 1], roughness: 0.85 }),
        mushroom: world.addObjectKind(
            M.merge([
                M.cylinder(0.022, 0.09, 6).translate(0, 0.045, 0),
                M.sphere(0.055, 8, 6).translate(0, 0.11, 0),
            ]), { color: [0.35, 0.95, 0.88, 1], roughness: 0.4 }),
    };
}
