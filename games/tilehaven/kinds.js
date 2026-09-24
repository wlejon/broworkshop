// kinds.js — TileHaven's instanced object meshes (TileWorld object kinds).
// TileWorld.load() keeps registered kinds, so this runs once per world.

/** Register every kind on `world`; returns { name: kindId }. */
export function registerKinds(world) {
    const M = Mesh;
    const add = (mesh, look) => world.addObjectKind(mesh, look);
    const roof = (r, h, y) => M.cone(r, h, 4, 1, true).rotate(0, 1, 0, Math.PI / 4).translate(0, y, 0);
    const wheel = (x, z) => M.cylinder(0.045, 0.03, 8).rotate(0, 0, 1, Math.PI / 2).translate(x, 0.055, z);
    const leg = (x, z) => M.box(0.025, 0.20, 0.025).translate(x, 0.20, z);
    const pole = (x, z) => M.cylinder(0.02, 0.16, 5).translate(x, 0.16, z);

    return {
        // Decor
        tree: add(M.merge([
            M.cylinder(0.045, 0.16, 6).translate(0, 0.08, 0),
            M.cone(0.20, 0.30, 7, 1, true).translate(0, 0.32, 0),
            M.cone(0.16, 0.26, 7, 1, true).translate(0, 0.50, 0),
            M.cone(0.11, 0.20, 7, 1, true).translate(0, 0.66, 0),
        ]), { color: [0.18, 0.42, 0.20, 1], roughness: 0.95 }),
        rock: add(M.rock(0.20, 9, 2).translate(0, 0.11, 0),
            { color: [0.48, 0.47, 0.50, 1], roughness: 1.0 }),
        oreChunk: add(M.rock(0.10, 7, 1).translate(0, 0.06, 0),
            { color: [0.85, 0.58, 0.25, 1], roughness: 0.5, metallic: 0.5 }),

        // Buildings
        depot: add(M.merge([
            M.box(0.42, 0.05, 0.42).translate(0, 0.05, 0),               // pad
            M.box(0.28, 0.18, 0.21).translate(0, 0.28, 0),               // hall
            roof(0.40, 0.26, 0.45),
            M.cylinder(0.015, 0.24, 5).translate(0.33, 0.34, 0.33),       // flag pole
            M.box(0.08, 0.045, 0.005).translate(0.42, 0.52, 0.33),        // flag
        ]), { color: [0.92, 0.76, 0.38, 1], roughness: 0.6 }),
        house: add(M.box(0.16, 0.13, 0.14).translate(0, 0.13, 0),
            { color: [0.85, 0.72, 0.55, 1], roughness: 0.8 }),
        houseRoof: add(roof(0.25, 0.20, 0.255),
            { color: [0.72, 0.30, 0.24, 1], roughness: 0.85 }),
        farm: add(M.merge([
            M.box(0.15, 0.12, 0.12).translate(0, 0.12, 0),               // barn
            roof(0.22, 0.16, 0.235),
            M.cylinder(0.05, 0.15, 8).translate(0.16, 0.15, 0.07),       // silo
            M.cone(0.062, 0.08, 8, 1, true).translate(0.16, 0.30, 0.07), // silo cap
        ]), { color: [0.78, 0.34, 0.26, 1], roughness: 0.85 }),
        lumber: add(M.merge([
            M.box(0.16, 0.11, 0.13).translate(0, 0.11, 0),               // cabin
            roof(0.22, 0.14, 0.215),
            M.cylinder(0.035, 0.14, 6).rotate(0, 0, 1, Math.PI / 2).translate(0.02, 0.035, 0.24),  // logs
            M.cylinder(0.035, 0.12, 6).rotate(0, 0, 1, Math.PI / 2).translate(-0.02, 0.10, 0.24),
        ]), { color: [0.55, 0.40, 0.24, 1], roughness: 0.9 }),
        mine: add(M.merge([
            M.box(0.16, 0.05, 0.16).translate(0, 0.05, 0),               // base
            leg(-0.10, -0.10), leg(0.10, -0.10), leg(-0.10, 0.10), leg(0.10, 0.10),  // headframe
            M.box(0.13, 0.025, 0.13).translate(0, 0.42, 0),              // top deck
            M.torus(0.07, 0.02, 10, 6).rotate(0, 0, 1, Math.PI / 2).translate(0, 0.52, 0),  // winding wheel
        ]), { color: [0.45, 0.42, 0.40, 1], roughness: 0.7, metallic: 0.2 }),
        market: add(M.merge([
            M.box(0.20, 0.03, 0.16).translate(0, 0.03, 0),               // counter
            pole(-0.16, -0.12), pole(0.16, -0.12), pole(-0.16, 0.12), pole(0.16, 0.12),
            roof(0.30, 0.15, 0.315),                                      // awning
            M.box(0.05, 0.05, 0.05).translate(0.06, 0.11, 0.02),         // crates
            M.box(0.04, 0.04, 0.04).translate(-0.07, 0.10, -0.02),
        ]), { color: [0.30, 0.55, 0.80, 1], roughness: 0.7 }),

        // Traffic + markers
        cart: add(M.merge([
            M.box(0.11, 0.045, 0.15).translate(0, 0.115, 0),             // bed
            wheel(-0.115, 0.09), wheel(0.115, 0.09), wheel(-0.115, -0.09), wheel(0.115, -0.09),
            M.sphere(0.05, 8, 6).translate(0, 0.10, 0.20),               // pony
            M.box(0.035, 0.055, 0.055).translate(0, 0.055, 0.20),
        ]), { color: [0.52, 0.36, 0.20, 1], roughness: 0.9 }),
        cargo: add(M.box(0.075, 0.075, 0.075), { color: [1, 1, 1, 1], roughness: 0.7 }),
        warn: add(M.merge([
            M.box(0.030, 0.10, 0.030).translate(0, 0.10, 0),
            M.box(0.038, 0.038, 0.038).translate(0, -0.06, 0),
        ]), { color: [1.0, 0.22, 0.16, 1], roughness: 0.4 }),
    };
}
