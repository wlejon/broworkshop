// Client — main-thread wrapper around the splat worker.
//
// The pipeline is heavy (multi-GB weights, seconds-to-minutes per image), so it
// lives in a Worker and the main thread stays responsive — the orbit camera and
// the spinner keep animating while a generation runs. Requests are serialized
// (load, then a stream of generates), so one outstanding callback is enough.
// Each call takes a node-style cb(err, data).
(function () {
  'use strict';

  function create() {
    var worker = new Worker('lab/splat-worker.js');
    var pending = null;      // cb for the in-flight request
    var readyCb = null;      // one-shot: worker announced itself
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
      if (!cb) return;       // stray message — drop
      if (msg.type === 'error') cb(new Error('[' + msg.stage + '] ' + msg.message), null);
      else cb(null, msg);
    };

    function send(message, transfer, cb) {
      if (pending) { cb(new Error('client busy'), null); return; }
      pending = cb;
      worker.postMessage(message, transfer || []);
    }

    return {
      // Resolve once the worker has booted.
      onReady: function (cb) { if (ready) cb(); else readyCb = cb; },

      // Load the four (+ optional birefnet) checkpoints into the worker.
      load: function (weights, cb) { send({ type: 'load', weights: weights }, null, cb); },

      // Reconstruct a cloud from an ImageData-shaped { data, width, height }.
      // The pixel buffer is transferred (zero-copy), so pass a throwaway copy —
      // the caller keeps the source intact.
      generate: function (image, opts, cb) {
        send({ type: 'generate', image: image, opts: opts }, [image.data.buffer], cb);
      },

      // Ask an in-flight generate() to abort. generate() runs synchronously in
      // the worker thread (its message loop is blocked), so we can't postMessage
      // a cancel — instead flip the native cancel flag from THIS (main) thread.
      // The worker's generate() polls it and returns a { type: 'cancelled' }
      // reply, which lands in the pending generate callback like any other.
      cancel: function () {
        if (typeof bro !== 'undefined' && bro.triposplat && bro.triposplat.cancel) {
          bro.triposplat.cancel();
        }
      },

      dispose: function () { try { worker.terminate(); } catch (e) { /* ignore */ } },
    };
  }

  window.TSLab = window.TSLab || {};
  window.TSLab.Client = { create: create };
})();
