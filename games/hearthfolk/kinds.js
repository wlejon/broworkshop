// Object kinds (instanced meshes) placed on the tile world.
//
// Registered exactly ONCE per world. world.load() preserves registered kinds
// (kind ids stay valid; only instance placements are cleared), so a load
// re-places instances without re-registering; stats.kindRegistrations proves it.

import { VILLAGER_DEFS } from "/app/defs.js";

// A hat, hood, cap, toque or staff per role, on top of the shared body + head.
const ROLE_PART = {
    farmer: (M) => M.cone(0.11, 0.045, 9, 1, true).translate(0, 0.345, 0),   // straw hat
    forester: (M) => M.cone(0.07, 0.11, 7, 1, true).translate(0, 0.36, 0),   // pointed hood
    mason: (M) => M.box(0.10, 0.03, 0.10).translate(0, 0.355, 0),            // flat cap
    cook: (M) => M.cylinder(0.055, 0.06, 8).translate(0, 0.37, 0),           // toque
    elder: (M) => M.cylinder(0.012, 0.34, 5).translate(0.10, 0.17, 0),       // staff
};

/** Register every kind on `world`; returns { tree, stump, ..., villagers: [] }. */
export function registerKinds(world, stats) {
    stats.kindRegistrations++;
    const M = Mesh;
    const kind = (mesh, color, roughness) => world.addObjectKind(mesh, { color, roughness });
    const logAt = (len, y, z) => M.cylinder(0.035, len, 6).rotate(0, 0, 1, Math.PI / 2).translate(0, y, z);
    const kinds = {
        tree: kind(M.merge([
            M.cylinder(0.05, 0.18, 6).translate(0, 0.09, 0),
            M.cone(0.22, 0.34, 7, 1, true).translate(0, 0.36, 0),
            M.cone(0.17, 0.28, 7, 1, true).translate(0, 0.56, 0),
            M.cone(0.11, 0.22, 7, 1, true).translate(0, 0.74, 0),
        ]), [0.16, 0.36, 0.18, 1], 0.95),
        stump: kind(M.cylinder(0.07, 0.08, 7).translate(0, 0.04, 0), [0.42, 0.30, 0.18, 1], 1.0),
        hut: kind(M.merge([
            M.box(0.20, 0.16, 0.17).translate(0, 0.16, 0),
            M.cone(0.30, 0.22, 4, 1, true).rotate(0, 1, 0, Math.PI / 4).translate(0, 0.42, 0),
            M.box(0.05, 0.09, 0.02).translate(0, 0.09, 0.175),                  // door
        ]), [0.62, 0.50, 0.36, 1], 0.85),
        hutRoof: kind(M.cone(0.32, 0.10, 4, 1, true).rotate(0, 1, 0, Math.PI / 4).translate(0, 0.55, 0),
            [0.55, 0.33, 0.20, 1], 0.9),
        hearth: kind(M.merge([
            M.torus(0.20, 0.05, 10, 6).translate(0, 0.05, 0),                   // stone ring
            M.cylinder(0.04, 0.16, 5).rotate(0, 0, 1, 0.5).translate(0.05, 0.09, 0),
            M.cylinder(0.04, 0.16, 5).rotate(0, 0, 1, -0.5).translate(-0.05, 0.09, 0),
        ]), [0.40, 0.38, 0.38, 1], 1.0),
        flame: kind(M.merge([
            M.cone(0.10, 0.26, 6, 1, true).translate(0, 0.20, 0),
            M.cone(0.05, 0.16, 6, 1, true).translate(0.05, 0.16, 0.03),
        ]), [1.0, 0.55, 0.12, 1], 0.3),
        bench: kind(M.merge([
            M.box(0.16, 0.02, 0.06).translate(0, 0.10, 0),
            M.box(0.02, 0.05, 0.05).translate(-0.12, 0.05, 0),
            M.box(0.02, 0.05, 0.05).translate(0.12, 0.05, 0),
        ]), [0.50, 0.38, 0.24, 1], 0.9),
        kitchen: kind(M.merge([
            M.box(0.16, 0.10, 0.10).translate(0, 0.10, 0),                      // table
            M.cylinder(0.06, 0.05, 8).translate(0.04, 0.225, 0),                // pot
        ]), [0.46, 0.34, 0.24, 1], 0.8),
        meal: kind(M.merge([
            M.cylinder(0.045, 0.015, 8).translate(0, 0.008, 0),
            M.sphere(0.028, 8, 6).translate(0, 0.035, 0),
        ]), [0.75, 0.58, 0.28, 1], 0.6),
        stone: kind(M.rock(0.09, 8, 2).translate(0, 0.05, 0), [0.52, 0.52, 0.56, 1], 1.0),
        boulder: kind(M.rock(0.22, 9, 3).translate(0, 0.12, 0), [0.44, 0.43, 0.46, 1], 1.0),
        logPile: kind(M.merge([
            logAt(0.16, 0.035, 0.03), logAt(0.16, 0.035, -0.04), logAt(0.14, 0.10, -0.005),
        ]), [0.48, 0.35, 0.20, 1], 0.95),
        // One kind per villager: distinct silhouettes + colours per role.
        villagers: VILLAGER_DEFS.map((def) => kind(M.merge([
            M.cylinder(0.075, 0.20, 8).translate(0, 0.13, 0),                   // body
            M.sphere(0.062, 10, 8).translate(0, 0.30, 0),                       // head
            ROLE_PART[def.role](M),
        ]), def.color, 0.8)),
    };
    return kinds;
}
