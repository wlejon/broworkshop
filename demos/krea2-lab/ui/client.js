// Worker client. The worker owns the native Krea 2 pipeline; every technique
// is a message through here. One request runs at a time; anything sent while
// one is in flight queues FIFO and dispatches as responses land — so a click
// during the post-load minted-axis restore (a burst of registerAxis sends)
// waits its turn instead of failing with "worker busy".

export function createClient() {
  const worker = new Worker('lab/krea2-worker.js');
  const queue = [];
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
    // Dispatch the next queued request BEFORE running the callback, so a
    // send() from inside the callback keeps FIFO order behind it.
    if (queue.length) {
      const nxt = queue.shift();
      pending = nxt.cb;
      worker.postMessage(nxt.message);
    }
    if (!cb) return;
    if (msg.type === 'error') cb(new Error('[' + msg.stage + '] ' + msg.message), null);
    else cb(null, msg);
  };

  function send(message, cb) {
    if (pending) { queue.push({ message: message, cb: cb }); return; }
    pending = cb;
    worker.postMessage(message);
  }
  return {
    onReady: (cb) => { if (ready) cb(); else readyCb = cb; },
    onProgress: (cb) => { progressCb = cb; },
    send: send,
  };
}
