// lib/city/traffic_worker.js — the traffic simulation off the page's thread.
// Messages in: { init: { graph (trafficGraph), count, seed, edgeDensity, names } }
// then { frame: { dt, eye, fwd, range, nearR } }; out, a frame each:
// { bufs: [Float32Array a type and near/far], stats } (bufs transferred).

import { createTraffic, carInstances } from "./traffic.js";

let traffic = null, names = null;
self.onmessage = (ev) => {
    const m = ev.data;
    if (m.init) {
        traffic = createTraffic(m.init.graph, { count: m.init.count, seed: m.init.seed, edgeDensity: m.init.edgeDensity });
        names = m.init.names;
        self.postMessage({ ready: { cars: traffic.cars.length, lanes: traffic.lanes.length, typeCounts: names.map((n) => traffic.cars.filter((c) => c.type === n).length) } });
        return;
    }
    if (m.frame && traffic) try {
        const f = m.frame;
        const t0 = performance.now();
        traffic.step(f.dt, f.eye);
        const t1 = performance.now();
        const bufs = carInstances(traffic, names, f.eye, f.fwd, f.range, f.nearR);
        const t2 = performance.now();
        let moving = 0;
        if (f.stats) for (const c of traffic.cars) if (c.v > 1) moving++;
        self.postMessage({ bufs, stats: { time: traffic.time, stepMs: t1 - t0, poseMs: t2 - t1, moving } }, bufs.map((b) => b.buffer));
    } catch (err) {
        console.error('traffic worker: ' + err + '\n' + err.stack);
    }
};
