// lib/destruct/builder.js — structures built for a solver off the thread (build_worker.js), one at a time,
// in the order asked: each is built for where the solver's buffers stand once the one before it is placed.
//
// createBuilder(solver) -> {
//   add(s, placed)     addStructure(s), later: placed(out) is called with what solver.addStructure would
//                      have returned (null: no room), from update(), on the thread
//   update()           places what has come back, and sends the next: once a frame
//   flush()            builds and places all that is asked for now, on the thread
//   pending            how many have been asked for and not placed yet
//   ready              one has come back and waits for update() to place it (update() without one only sends
//                      the next: it asks nothing of the solver but where its buffers stand)
//   destroy() }

export function createBuilder(solver) {
    const worker = new Worker(new URL('./build_worker.js', import.meta.url), { type: 'module' });
    const queue = [];   // { s, placed }
    let out = null, back = null, id = 0;
    worker.onmessage = (ev) => { if (out && ev.data.id === out.id) back = ev.data.built; };
    // (The Worker's code runs cold the first time, as the page's would: a block of some 9,000 pieces through
    // it a few times now, so the first real one is built by code already compiled.)
    {
        const members = [{ c: [0, -0.5, 0], h: [10, 0.5, 10], mass: 1, ground: true }], joints = [];
        for (let k = 0; k < 12; k++) { members.push({ c: [0, 2 + 4 * k, 0], h: [8, 2, 8], mass: 1e5 }); joints.push([k, k + 1]); }
        for (let k = 0; k < 4; k++) worker.postMessage({ id: -1, s: { frame: { x: 0, y: 0, z: 0, yaw: 0 }, members, joints }, at: { origin: [0, 0, 0], n: 0, nj: 0, nm: 0, me: 0 } });
    }
    return {
        add(s, placed) { queue.push({ s, placed }); },
        update() {
            if (back) {
                const o = out;
                const built = back;
                out = null; back = null;
                o.placed(solver.place(built));
            }
            if (!out && queue.length) {
                out = { ...queue.shift(), id: ++id };
                worker.postMessage({ id: out.id, s: out.s, at: solver.where() });
            }
        },
        flush() {
            const all = out ? [out, ...queue] : [...queue];
            out = null; back = null; queue.length = 0;
            for (const q of all) q.placed(solver.addStructure(q.s));
        },
        get pending() { return queue.length + (out ? 1 : 0); },
        get ready() { return back !== null; },
        destroy() { worker.terminate(); },
    };
}
