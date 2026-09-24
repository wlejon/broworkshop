// transfer.js — two ways data leaves this app:
//
//   1. Bytes to a child window, zero-copy, via postMessage's transfer list.
//   2. A URL to the operating system, via window.open(url), which leaves the app.
//
// ── The transfer list ─────────────────────────────────────────────────────────
// An ArrayBuffer named in the transfer list is handed over, not copied, and
// the SENDER'S buffer is DETACHED: byteLength 0, every view length 0. A copy
// can never do that, so the demonstration is a pincer:
//   - checksum the payload here, before sending (unreadable afterwards)
//   - transfer it and read our own buffer's byteLength (0)
//   - the child checksums what arrived and posts the number back
// Same checksum, empty sender: the bytes moved rather than duplicated.
//
// The payload carries the ArrayBuffer itself. Carrying a typed-array VIEW with
// its buffer in the list (`postMessage({ v }, [v.buffer])`, fine on the web)
// throws DataCloneError here: see ENGINE-ISSUES.md.

import { logView, readout } from "/lib/kit/index.js";
import { children, post, logSys, observeChildMessages } from "/app/windows.js";

/** What the panel itself believes (tests assert on it). */
export const transferState = {
    sends: 0, lastBytes: 0, lastChecksum: 0,
    senderByteLengthBefore: null, senderByteLengthAfter: null,
    detached: null,          // true once a transfer emptied our buffer
    acks: 0, lastAck: null,
    intact: null,            // the child's checksum agreed
    lastMode: null,          // 'transfer' | 'copy'
};

export const shellState = { calls: 0, lastUrl: null, lastResult: undefined };

let log = null, ro = null, shellRo = null;

/** A deterministic byte pattern, so the checksum is reproducible. */
function makePayload(bytes) {
    const u8 = new Uint8Array(bytes);
    for (let i = 0; i < bytes; i++) u8[i] = (i * 31 + (i >> 8) * 7) & 0xff;
    return u8;
}

export function checksum(u8) {
    let sum = 0;
    for (let i = 0; i < u8.length; i++) sum = (sum + u8[i] * (i + 1)) >>> 0;
    return sum;
}

/**
 * Send a fresh payload to one child, by transfer (detaches ours) or as a
 * plain clone. Returns exactly what happened to our buffer.
 */
export function sendBlob(rec, bytes, useTransfer) {
    const u8 = makePayload(bytes);
    const buf = u8.buffer;
    const sum = checksum(u8);                        // MUST happen before the transfer
    const tag = ++transferState.sends;
    const before = buf.byteLength;

    if (useTransfer) post(rec, { type: 'blob', tag, buf }, [buf]);
    else post(rec, { type: 'blob', tag, buf });
    const after = buf.byteLength;

    Object.assign(transferState, {
        lastBytes: bytes, lastChecksum: sum,
        senderByteLengthBefore: before, senderByteLengthAfter: after,
        detached: after === 0, lastMode: useTransfer ? 'transfer' : 'copy', intact: null,
    });
    log.add(`#${tag} ${useTransfer ? 'transfer' : 'copy'} ${bytes} B -> window ${rec.id}  ` +
            `sender ${before} B → ${after} B${useTransfer && after === 0 ? '  DETACHED' : ''}`,
            useTransfer ? 'out' : 'sys');
    // The view is detached too: the way this bites real code.
    if (useTransfer) log.add(`   our Uint8Array view is now length ${u8.length}`, 'sys');
    refreshReadout();
    return { tag, bytes, checksum: sum, before, after, detached: after === 0 };
}

export function sendToAll(bytes, useTransfer) {
    for (const rec of children) sendBlob(rec, bytes, useTransfer);
    if (!children.length) log.add('no windows open — open one first', 'sys');
    return children.length;
}

// The child answers every blob with the size and checksum it computed.
observeChildMessages((rec, d) => {
    if (!d || d.type !== 'blobAck') return;
    transferState.acks++;
    transferState.lastAck = d;
    transferState.intact = d.checksum === transferState.lastChecksum && d.bytes === transferState.lastBytes;
    if (log) {
        log.add(`<- window ${rec.id} got ${d.bytes} B, checksum ${d.checksum} ` +
                (transferState.intact ? '✓ matches' : '✗ MISMATCH'), 'in');
    }
    refreshReadout();
});

function refreshReadout() {
    if (!ro) return;
    const s = transferState;
    const bytes = (n) => (n === null ? '—' : n + ' bytes');
    ro.set({
        mode: s.lastMode || '—',
        payload: `${s.lastBytes} bytes, checksum ${s.lastChecksum}`,
        before: bytes(s.senderByteLengthBefore),
        after: bytes(s.senderByteLengthAfter) +
            (s.detached === true ? '  ← DETACHED' : s.detached === false ? '  ← still ours (copy)' : ''),
        child: s.lastAck ? `${s.lastAck.bytes} bytes, checksum ${s.lastAck.checksum}` : '—',
        intact: s.intact === null ? '—' : s.intact ? 'yes' : 'NO',
        acks: `${s.acks} of ${s.sends} send(s)`,
    });
}

// --- shell handoff -----------------------------------------------------------
// A URL with a scheme of its own goes to the OS handler (SDL_OpenURL) and the
// call returns null: there is no popup Window object. (An app-relative url
// would open a bro window instead; bro.window.open is the panel above.)
// Headless never shells out, but the button is still a two-step arm, because
// a button that silently launches a browser is rude.

export function shellOpen(url) {
    shellState.calls++;
    shellState.lastUrl = url;
    shellState.lastResult = window.open(url);
    logSys(`window.open(${url}) -> ${shellState.lastResult}`);
    shellRo.set({
        calls: shellState.calls,
        url: shellState.lastUrl,
        result: String(shellState.lastResult) + (shellState.lastResult === null ? '  (no popup object)' : ''),
    });
    return shellState.lastResult;
}

export function bindTransferPanel() {
    log = logView('#xferLog', { max: 40, time: false });
    ro = readout('#xferReadout', {
        mode: 'mode', payload: 'payload', before: 'sender before', after: 'sender after',
        child: 'child reported', intact: 'bytes intact', acks: 'acks',
    });
    shellRo = readout('#shellReadout', { calls: 'calls', url: 'last url', result: 'returned' });

    const sizeEl = document.getElementById('xferSize');
    const size = () => {
        const v = parseInt(sizeEl.value, 10);
        return Number.isFinite(v) && v > 0 ? Math.min(v, 4 * 1024 * 1024) : 65536;
    };
    const first = () => {
        if (!children.length) log.add('no windows open — open one first', 'sys');
        return children[0] || null;
    };
    document.getElementById('xferSend').addEventListener('click', () => { const r = first(); if (r) sendBlob(r, size(), true); });
    document.getElementById('xferCopy').addEventListener('click', () => { const r = first(); if (r) sendBlob(r, size(), false); });
    document.getElementById('xferAll').addEventListener('click', () => sendToAll(size(), true));

    // Arm, then fire; firing disarms, so leaving the app is never a repeatable click.
    const arm = document.getElementById('shellArm');
    const url = document.getElementById('shellUrl');
    const go = document.getElementById('shellGo');
    const sync = () => { go.disabled = !arm.checked; go.classList.toggle('danger', arm.checked); };
    arm.addEventListener('change', sync);
    go.addEventListener('click', () => {
        if (!arm.checked) return;
        shellOpen(url.value);
        arm.checked = false;
        sync();
    });
    for (const b of document.querySelectorAll('#shellPresets button')) {
        b.addEventListener('click', () => { url.value = b.dataset.url; });
    }
    sync();
    refreshReadout();
}
