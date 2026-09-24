// lib/kit/worker-rpc.js — request/response over a dedicated Worker, both ends.
//
// Page side:
//   import { workerClient } from "/lib/kit/worker-rpc.js";
//   const rpc = workerClient('lab/model-worker.js');
//   await rpc.ready;                                   // worker posted 'ready'
//   const info = await rpc.request({ type: 'load', dir });
//   rpc.on('progress', (msg) => bar.set(msg.f));      // side traffic
//   rpc.post({ type: 'reset' });                        // fire and forget
//   rpc.abandon();                                      // drop outstanding replies
//
// Worker side (a module worker; it may import from /lib):
//   import { serveWorker } from "/lib/kit/worker-rpc.js";
//   serveWorker({
//       load(msg) { model = load(msg.dir); return { type: 'loaded', layers: 12 }; },
//       async render(msg) { const bmp = await ...; return { type: 'frame', bitmap: bmp, transfer: [bmp] }; },
//   });
//
// Protocol: a request carries `_rid`; its reply (whatever a handler returns,
// or `{ type: '<request type>:ok' }` for undefined) echoes it. A handler that
// throws replies `{ type: 'error', stage: <request type>, message }`, which
// rejects the request with Error('[stage] message'). Messages without `_rid`
// are events: 'ready' (posted by serveWorker once its handlers are installed)
// and anything a worker posts on its own (`emit(type, fields)`).
//
// The worker handles messages in arrival order; replies may resolve out of
// order when a handler awaits (createImageBitmap). abandon() rejects every
// outstanding request with an error carrying `abandoned: true` and discards
// their late replies: cancelling a run is "stop asking, ignore the answer".

/** Page side. Returns { ready, onReady, request, call, post, on, off, abandon, pending, worker, terminate }. */
export function workerClient(url, opts) {
    const worker = new Worker(url, opts);
    const outstanding = new Map();         // rid -> { resolve, reject }
    const listeners = {};                  // type -> [fn]
    let nextRid = 1, isReady = false, readyResolve;
    const ready = new Promise((r) => { readyResolve = r; });

    worker.onmessage = (e) => {
        const msg = e.data || {};
        if (msg._rid != null) {
            const p = outstanding.get(msg._rid);
            if (!p) return;                // abandoned
            outstanding.delete(msg._rid);
            if (msg.type === 'error') p.reject(new Error('[' + msg.stage + '] ' + msg.message));
            else p.resolve(msg);
            return;
        }
        if (msg.type === 'ready') { isReady = true; readyResolve(); }
        for (const fn of listeners[msg.type] || []) fn(msg);
    };
    worker.onerror = (e) => {
        const err = new Error('worker error: ' + ((e && e.message) || e));
        for (const p of outstanding.values()) p.reject(err);
        outstanding.clear();
    };

    const api = {
        ready,
        get isReady() { return isReady; },
        onReady(fn) { ready.then(fn); },
        /** Send a request; resolves with the reply message, rejects on 'error'. */
        request(msg, transfer) {
            const rid = nextRid++;
            return new Promise((resolve, reject) => {
                outstanding.set(rid, { resolve, reject });
                worker.postMessage(Object.assign({}, msg, { _rid: rid }), transfer || []);
            });
        },
        /** Node-style form of request: cb(err, reply). Abandoned requests never call back. */
        call(msg, transfer, cb) {
            api.request(msg, transfer).then((r) => cb(null, r),
                (e) => { if (!e.abandoned) cb(e, null); });
        },
        /** Post without expecting a reply. */
        post(msg, transfer) { worker.postMessage(msg, transfer || []); },
        on(type, fn) { (listeners[type] = listeners[type] || []).push(fn); return fn; },
        off(type, fn) { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); },
        /** Reject every outstanding request (err.abandoned = true); their replies are dropped. */
        abandon() {
            for (const p of outstanding.values()) {
                const e = new Error('abandoned');
                e.abandoned = true;
                p.reject(e);
            }
            outstanding.clear();
        },
        get pending() { return outstanding.size; },
        worker,
        terminate() { api.abandon(); try { worker.terminate(); } catch (_) {} },
    };
    return api;
}

/** Worker side: dispatch requests to `handlers[msg.type]` and post 'ready'. */
export function serveWorker(handlers) {
    self.onmessage = async (e) => {
        const msg = e.data || {};
        const rid = msg._rid;
        try {
            const fn = handlers[msg.type];
            if (!fn) throw new Error('unknown message: ' + msg.type);
            let reply = await fn(msg);
            if (rid == null) return;
            reply = reply || { type: msg.type + ':ok' };
            const transfer = reply.transfer || [];
            delete reply.transfer;
            reply._rid = rid;
            self.postMessage(reply, transfer);
        } catch (err) {
            self.postMessage({
                type: 'error', stage: msg.type, _rid: rid,
                message: (err && err.message) ? err.message : String(err),
            });
        }
    };
    self.postMessage({ type: 'ready' });
}

/** Worker side: post an event (no `_rid`) the page receives through on(type). */
export function emit(type, fields) {
    self.postMessage(Object.assign({ type }, fields));
}
