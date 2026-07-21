// terrain.js — the clipmap terrain spine.

import { configureMaterials } from './materials.js';

export function createTerrain(scene, atlas, island) {
    const clipmap = scene.createClipmapTerrain({
        levels:      10,
        resolution:  128,
        cellSize:    8,
        heightScale: 1,
        seaLevel:    atlas.seaLevel,
        snowLine:    Math.max(600, atlas.max * 0.72),
    });

    // 1. Upload base height layer.
    clipmap.setHeightLayer(0, {
        data:          atlas.elevation,
        width:         atlas.width,
        height:        atlas.height,
        originX:       atlas.originX,
        originZ:       atlas.originZ,
        metresPerCell: atlas.metresPerCell,
    });

    // 2. Configure materials and snowLine based on regional climate.
    const { palette, snowLine } = configureMaterials(
        clipmap,
        atlas.regionalTemp,
        atlas.regionalPrecip,
        atlas.max
    );

    // 3. Upload surface layer (biome ID, moisture, local temperature) to spatially modulate shader.
    clipmap.setSurfaceLayer({
        data:          atlas.surfaceData,
        width:         atlas.width,
        height:        atlas.height,
        originX:       atlas.originX,
        originZ:       atlas.originZ,
        metresPerCell: atlas.metresPerCell,
    });

    return {
        clipmap,
        node: clipmap.node,
        palette,
        snowLine,
        update(x, y, z) { clipmap.update(x, y, z); },
        elevationAt(x, z) { return clipmap.elevationAt(x, z); },
        farDistance() { return clipmap.farDistance; },
        destroy() { clipmap.destroy(); },
    };
}
