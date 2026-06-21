// Client — main-thread wrapper around the diffusion worker.
//
// Requests are strictly serialized (load, then prime, then a stream of
// steps), so a single outstanding callback is enough. Each call takes a
// node-style cb(err, data); the worker's matching reply or any 'error'
// message resolves it.
  function create() {
    var worker = new Worker('lab/diffusion-worker.js');
    var pending = null;     // cb for the in-flight request
    var readyCb = null;     // one-shot: worker announced itself
    var ready = false;

    worker.onmessage = function (e) {
      var msg = e.data || {};

      if (msg.type === 'ready') {
        ready = true;
        if (readyCb) { var r = readyCb; readyCb = null; r(); }
        return;
      }
      var cb = pending;
      pending = null;
      if (!cb) return;       // stray message (e.g. after cancel) — drop

      if (msg.type === 'error') {
        cb(new Error('[' + msg.stage + '] ' + msg.message), null);
      } else {
        cb(null, msg);
      }
    };

    function send(message, transfer, cb) {
      if (pending) { cb(new Error('client busy'), null); return; }
      pending = cb;
      worker.postMessage(message, transfer || []);
    }

    return {
      // Resolve once the worker has booted.
      onReady: function (cb) {
        if (ready) cb(); else readyCb = cb;
      },

      load: function (spec, cb) {
        send({ type: 'load', spec: spec }, null, cb);
      },

      prime: function (prompt, opts, controls, cb) {
        send({ type: 'prime', prompt: prompt, opts: opts, controls: controls },
             null, cb);
      },

      // Build a conditioning-control axis from two word sets (diff-of-means);
      // the worker encodes the phrases and registers a runtime axis `name`.
      search: function (neg, pos, name, cb) {
        send({ type: 'search', neg: neg, pos: pos, name: name }, null, cb);
      },

      // Drop a built axis from the pipeline.
      removeAxis: function (name, cb) {
        send({ type: 'remove', name: name }, null, cb || function () {});
      },

      // ctrl is forwarded verbatim to PipelineState.stepOnce() in the worker
      // ({trace:true} or {attnBias:[...]}); transfer carries the bias buffers.
      step: function (ctrl, transfer, cb) {
        send({ type: 'step', ctrl: ctrl }, transfer, cb);
      },

      // Abandon the active generation. The worker keeps the loaded model;
      // any in-flight step reply will be dropped by the next caller.
      reset: function () {
        worker.postMessage({ type: 'reset' });
        pending = null;
      },

      dispose: function () {
        try { worker.terminate(); } catch (e) { /* ignore */ }
      },
    };
  }

  export const Client = { create: create };
