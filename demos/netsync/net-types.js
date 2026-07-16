// Shared replicated-type registry for Net Sync Arena.
//
// Both the host and every client register the exact same type names BEFORE
// connecting — factories create the 3D representation and return the plain
// state object that bro.net.sync replicates. We keep our own obj -> SceneNode
// map because sync.idOf(obj) is already null inside the destroy hook.

export const PORT = 29850;

export const PALETTE = [
    '#4fc3f7',  // P1 — sky blue
    '#ff8a65',  // P2 — coral
    '#aed581',  // P3 — leaf green
    '#ba68c8',  // P4 — violet
    '#ffd54f',  // P5 — amber
    '#f06292',  // P6 — pink
];

export function colorOf(slot) { return PALETTE[slot % PALETTE.length]; }

/** Synced object -> SceneNode (visuals live outside the replicated state). */
export const nodes = new Map();

export function registerTypes(scene) {
    const sync = bro.net.sync;

    // A player avatar: a colored capsule. Position replicates with
    // interpolation so remote avatars glide instead of snapping at tick rate.
    // Authority: the owning client (handed over by the host in onconnect),
    // so each player drives — and scores for — its own capsule.
    sync.register('player', {
        create(state) {
            const node = scene.createMesh({
                mesh: 'capsule', radius: 0.45, halfHeight: 0.45,
                y: 0.9,
                color: colorOf(state.slot | 0),
                metallic: 0.0, roughness: 0.35,
            });
            const obj = { x: 0, z: 0, slot: state.slot | 0, score: 0 };
            nodes.set(obj, node);
            return obj;
        },
        destroy(obj) {
            const node = nodes.get(obj);
            if (node) node.destroy();
            nodes.delete(obj);
        },
        sync: { props: ['x', 'z', 'slot', 'score'], interpolate: ['x', 'z'] },
    });

    // A pickup: a glowing gold cube. Host-authoritative and static — it only
    // ever spawns and despawns (the spin is a purely local animation).
    sync.register('pickup', {
        create(state) {
            const node = scene.createMesh({
                mesh: 'box', halfW: 0.3, halfH: 0.3, halfD: 0.3,
                y: 0.75,
                color: '#ffd700',
                metallic: 1.0, roughness: 0.25,
                emissive: 0.5, emissiveColor: [1.0, 0.85, 0.3],
            });
            const obj = { x: state.x || 0, z: state.z || 0 };
            nodes.set(obj, node);
            return obj;
        },
        destroy(obj) {
            const node = nodes.get(obj);
            if (node) node.destroy();
            nodes.delete(obj);
        },
        sync: ['x', 'z'],
    });
}
