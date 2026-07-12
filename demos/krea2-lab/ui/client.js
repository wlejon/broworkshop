// Worker client. The worker owns the native Krea 2 pipeline; every technique
// is a message through here. One request runs at a time; anything sent while
// one is in flight queues FIFO and dispatches as responses land — so a click
// during the post-load minted-axis restore (a burst of registerAxis sends)
// waits its turn instead of failing with "worker busy".

export function createClient() {
  const worker = new Worker('lab/krea2-worker.js');
  const queue = [];
  let pending = null, readyCb = null, ready = false, progressCb = null;
  let sideCb = null;

  // Mid-request side traffic — reported while a request is in flight, must
  // NOT consume the pending response callback: interim mint progress, plus
  // the character search's progress and judge callouts (the worker awaits a
  // sendAux'd judgeRes for each).
  const SIDE = { mintProgress: 1, searchProgress: 1, judgeReq: 1, softReq: 1 };

  worker.onmessage = function (e) {
    const msg = e.data || {};
    if (msg.type === 'ready') {
      ready = true;
      if (readyCb) { const r = readyCb; readyCb = null; r(); }
      return;
    }
    if (SIDE[msg.type]) {
      if (msg.type === 'mintProgress') { if (progressCb) progressCb(msg); }
      else if (sideCb) sideCb(msg);
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
  // Out-of-band post straight to the worker — answers to its mid-request
  // callouts (judgeRes). Never touches the FIFO.
  function sendAux(message) { worker.postMessage(message); }
  return {
    onReady: (cb) => { if (ready) cb(); else readyCb = cb; },
    onProgress: (cb) => { progressCb = cb; },
    onSide: (cb) => { sideCb = cb; },
    send: send,
    sendAux: sendAux,
  };
}
