// terrain.js — the clipmap terrain spine.
//
// One camera-centred geometry clipmap displaced on the GPU from the atlas's
// 30 m elevation field. The engine's clipmap shaders already synthesise the
// sub-30 m relief (clipmap_detail.glsl) and shade rock/snow/sand/grass by
// slope/elevation (clipmap_material.glsl), so a single height layer already
// renders as naturalistic terrain. Climate-driven materials arrive with the
// engine E-track (M2+); here we just wire the model's shape in.

export function createTerrain(scene, atlas, island) {
    // cellSize = finest geometry cell under the camera; procedural detail fills
    // everything below it. snowLine tuned to the island's own relief so the
    // peaks cap out. Flat world (planetRadius 0) for a bounded island.
    const clipmap = scene.createClipmapTerrain({
        levels:      10,
        resolution:  128,
        cellSize:    8,
        heightScale: 1,
        seaLevel:    atlas.seaLevel,
        snowLine:    Math.max(600, atlas.max * 0.72),
    });

    // The single 30 m field is the coarsest (and only) layer — the base of the
    // blend, assumed to cover everywhere the camera reaches. Beyond it,
    // clamp-to-edge holds the border value (ocean, thanks to the atlas falloff).
    clipmap.setHeightLayer(0, {
        data:          atlas.elevation,
        width:         atlas.width,
        height:        atlas.height,
        originX:       atlas.originX,
        originZ:       atlas.originZ,
        metresPerCell: atlas.metresPerCell,
    });

    return {
        clipmap,
        node: clipmap.node,
        update(x, y, z) { clipmap.update(x, y, z); },
        elevationAt(x, z) { return clipmap.elevationAt(x, z); },
        farDistance() { return clipmap.farDistance; },
        destroy() { clipmap.destroy(); },
    };
}
