// water.js — ocean water plane.

export function createWater(scene, atlas) {
    const sea = scene.createMesh({
        mesh:      'plane',
        color:     [0.04, 0.14, 0.22],  // Deep naturalistic ocean blue
        metallic:  0.1,
        roughness: 0.05,                // Shiny reflective surface
        scale:     [80000, 1, 80000],   // Reaches all the way to the horizon
        y:         atlas.seaLevel,
    });
    sea.castsShadow = false;
    sea.receivesShadow = true;

    return {
        sea,
        destroy() {
            if (scene.destroyNode) scene.destroyNode(sea);
            else if (sea.destroy) sea.destroy();
        }
    };
}
