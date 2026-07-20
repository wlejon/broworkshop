// Bisect the shingled overlay on close mountainsides.
//
// Ruled out: shadows (byte-identical with the light's shadows off and with one
// cascade) and aerial perspective (unchanged with the atmosphere off). Dropping
// the detail exemplar DOES remove it, so this walks the config around the
// exemplar tap — the question is whether the shingle footprint tracks the ring
// cell size (geometry) or the exemplar's own repeat (the tap).
import { cam, terrain, scene, coarseField, exemplar, ready } from '/app/app.js';

for (let i = 0; i < 900; i++) { wallSleep(100); advanceTime(16); if (ready()) break; }
assert(ready(), 'terrain never became ready');
assert(exemplar(), 'no exemplar patch');

const POS = [-75570, 3063, 103510];
const ROT = Camera.quatNorm(Camera.quatMul(
    Camera.quatFromAxis(0, 1, 0, 2.6),
    Camera.quatFromAxis(1, 0, 0, -0.30)));

function shoot(t, name) {
    cam.pos = POS.slice(); cam.vel = [0, 0, 0]; cam.rot = ROT;
    for (let i = 0; i < 90; i++) {
        advanceTime(16);
        t.update(cam.pos[0], cam.pos[1], cam.pos[2]);
    }
    screenshot(name);
    console.log(name + '  (' + (t.triangleCount / 1000).toFixed(0) + 'k tris, ' +
                t.layerCount + ' layer)');
}

const cf = coarseField();
const ex = exemplar();

function variant(cfg, name) {
    const t = scene.createClipmapTerrain(Object.assign({
        levels: 11, resolution: 128, cellSize: 8, heightScale: 1, seaLevel: 0,
        detailWavelength: 48, detailRelief: 0.35, detailOctaves: 7, snowLine: 1700,
    }, cfg));
    t.setHeightLayer(0, {
        data: cf.data.data, width: cf.data.width, height: cf.data.height,
        originX: cf.origin, originZ: cf.origin, metresPerCell: cf.data.cellSize,
    });
    t.setDetailExemplar(ex);
    shoot(t, name);
    t.destroy();
}

shoot(terrain, 'bisect-0-baseline.png');
terrain.destroy();

// Same everything, half the ring resolution => every quad is twice as wide.
// If the shingles are the mesh, their footprint doubles with it.
variant({ resolution: 64 },  'bisect-1-res64.png');
variant({ resolution: 256 }, 'bisect-2-res256.png');
// Same rings, no procedural noise — isolates the exemplar tap on its own.
variant({ detailRelief: 0 }, 'bisect-3-exemplar-only.png');

console.log('BISECT OK');
