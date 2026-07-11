// Worker client (one outstanding request at a time). The worker owns the
// native Krea 2 pipeline; every technique is a message through here.

export function createClient() {
  const worker = new Worker('lab/krea2-worker.js');
  let pending = null, readyCb = null, ready = false, progressCb = null;

  worker.onmessage = function (e) {
    const msg = e.data || {};
    if (msg.type === 'ready') {
      ready = true;
      if (readyCb) { const r = readyCb; readyCb = null; r(); }
      return;
    }
    // Interim progress — reported mid-request, must NOT consume the pending
    // response callback.
    if (msg.type === 'mintProgress') {
      if (progressCb) progressCb(msg);
      return;
    }
    const cb = pending; pending = null;
    if (!cb) return;
    if (msg.type === 'error') cb(new Error('[' + msg.stage + '] ' + msg.message), null);
    else cb(null, msg);
  };

  function send(message, cb) {
    if (pending) { cb(new Error('worker busy'), null); return; }
    pending = cb;
    worker.postMessage(message);
  }
  return {
    onReady: (cb) => { if (ready) cb(); else readyCb = cb; },
    onProgress: (cb) => { progressCb = cb; },
    send: send,
  };
}
