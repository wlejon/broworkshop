// Worker half of viz/terrain.js. Every TerrainWorld read is one synchronous
// native call that runs the UNets over any tile it has not cached, seconds
// per stage on a cold region, so the world lives here and the page only
// ever waits on a reply. One request at a time: the tile cache is not
// thread-safe, and this worker handles messages in order anyway.

import { serveWorker } from "/lib/kit/worker-rpc.js";

let world = null;

const READS = {
    coarse:    (w, r) => w.coarse(r.i1, r.j1, r.i2, r.j2),
    latent:    (w, r) => w.latent(r.i1, r.j1, r.i2, r.j2),
    residual:  (w, r) => w.residual(r.i1, r.j1, r.i2, r.j2),
    elevation: (w, r) => w.elevation(r.i1, r.j1, r.i2, r.j2),
};

serveWorker({
    load(msg) {
        if (!bro.diffusion || typeof bro.diffusion.loadTerrain !== 'function') {
            throw new Error('bro.diffusion.loadTerrain is not in this build (needs the full profile)');
        }
        if (world) { world.dispose(); world = null; }
        const t0 = Date.now();
        world = bro.diffusion.loadTerrain(msg.dir, { seed: msg.seed });
        return { type: 'loaded', config: world.config(), seed: world.seed, ms: Date.now() - t0 };
    },

    read(msg) {
        if (!world) throw new Error('no world loaded');
        const read = READS[msg.stage];
        if (!read) throw new Error('unknown stage ' + msg.stage);
        const t0 = Date.now();
        const r = read(world, msg);
        const data = r.data instanceof Float32Array ? r.data : Float32Array.from(r.data);
        return {
            type: 'region', stage: msg.stage, ms: Date.now() - t0,
            channels: r.channels, width: r.width, height: r.height, data,
            transfer: [data.buffer],
        };
    },

    dispose() {
        if (world) { world.dispose(); world = null; }
    },
});
