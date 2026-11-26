// The hangar the machine stands in: sky and sun, a floor ruled in ten-metre
// squares that runs under it when it walks, and a street's worth of plain
// buildings to give fifty metres a scale.

import { SKY, daylight } from "/lib/kit/sky.js";

export function createStage(scene) {
    const rig = daylight(scene, {
        // The machine faces -Z; the sun stands in front of it and to one side.
        presets: { day: { ...SKY.afternoon, sun: { elevation: 44, heading: 32 }, exposure: { mode: 'auto', meter: 'incident' } } },
        order: ['day'], pcf: 3, ground: [0.16, 0.17, 0.18],
    });
    rig.apply('day');
    rig.setScale(12);
    scene.setToneMap({ mode: 'aces' });
    if (scene.setMSAA) scene.setMSAA(4);        // thin frames and far floor rules shimmer without it
    scene.setSSAO({ enabled: true, radius: 1.6, intensity: 1.1, bias: 0.03 });
    scene.setBloom({ threshold: 1.3, intensity: 0.22, radius: 0.7, iterations: 4 });

    const floor = scene.createMesh({ mesh: 'plane', halfW: 600, halfD: 600, color: [0.19, 0.20, 0.215], roughness: 0.92, metallic: 0, castsShadow: false });
    floor.y = -0.02;

    // Rules every 10 m; the ones across the way it walks slide under it.
    const STEP = 10, SPAN = 300;
    const across = [], rule = [0.30, 0.32, 0.35];
    for (let x = -SPAN; x <= SPAN; x += STEP) {
        const n = scene.createMesh({ mesh: 'box', halfW: 0.14, halfH: 0.01, halfD: SPAN, color: rule, roughness: 0.9, castsShadow: false });
        n.position = [x, 0, 0];
    }
    for (let z = -SPAN; z <= SPAN; z += STEP) {
        const n = scene.createMesh({ mesh: 'box', halfW: SPAN, halfH: 0.01, halfD: z % 50 === 0 ? 0.26 : 0.14, color: rule, roughness: 0.9, castsShadow: false });
        n.position = [0, 0, z];
        across.push({ n, z });
    }

    // A block of plain buildings, storeys marked, off to one side.
    const block = [];
    const tower = (x, z, w, d, h, tone) => {
        const body = scene.createMesh({ mesh: 'box', halfW: w / 2, halfH: h / 2, halfD: d / 2, color: [tone * 0.62, tone * 0.64, tone * 0.68], roughness: 0.8 });
        body.position = [x, h / 2, z];
        block.push(body);
        for (let y = 3.5; y < h - 1; y += 3.5) {
            const band = scene.createMesh({ mesh: 'box', halfW: w / 2 + 0.06, halfH: 0.9, halfD: d / 2 + 0.06, color: [tone * 0.55, tone * 0.60, tone * 0.68], roughness: 0.35, metallic: 0.3, castsShadow: false });
            band.position = [x, y, z];
            block.push(band);
        }
    };
    // A ring of them well out, so the camera can go all the way round the machine inside it.
    tower(-150, 150, 30, 30, 28, 0.52);
    tower(-60, 205, 34, 28, 42, 0.46);
    tower(40, 215, 36, 34, 105, 0.40);
    tower(150, 165, 28, 30, 63, 0.44);
    tower(215, 40, 30, 40, 24.5, 0.50);
    tower(-215, 20, 26, 26, 17.5, 0.56);
    tower(190, -130, 32, 32, 49, 0.48);
    tower(-170, -150, 30, 36, 77, 0.42);

    let offset = 0;
    return {
        rig,
        /** Slides the floor's rules back by what the machine has walked. */
        advance(metres) {
            offset = (offset + metres) % STEP;
            for (const a of across) a.n.z = a.z + offset;
        },
        setBlock(on) { for (const n of block) n.visible = on; },
    };
}
