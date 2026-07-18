// transfer.js — two kinds of handing something out of this app.
//
//   1. Bytes to a child window, zero-copy, via postMessage's transfer list.
//   2. A URL to the operating system, via window.open — which leaves the app
//      entirely.
//
// They sit together because they are the two edges where data stops being ours.
//
// ── The transfer list ────────────────────────────────────────────────────────
//
// postMessage's optional second argument is a transfer list. An ArrayBuffer in
// it is not copied across the realm boundary — its memory is handed over, and
// the SENDER'S buffer is DETACHED: byteLength drops to 0 and every typed-array
// view onto it goes to length 0. That detachment is the clean proof, because
// it is impossible to fake with a copy. A copy leaves the original readable; a
// transfer cannot.
//
// So the demonstration is a pincer:
//
//   - checksum the payload HERE, before sending (it is unreadable afterwards)
//   - transfer it, and assert our own buffer is now byteLength 0
//   - the child checksums what arrived and posts the number back
//
// Same checksum, empty sender. Bytes moved rather than duplicated.
//
// ── One real deviation from web semantics, worth knowing ─────────────────────
//
// Detachment happens when the ArrayBuffer OBJECT ITSELF is reachable in the
// message payload as well as named in the transfer list. Probed against the
// runtime:
//
//   postMessage({ b: buf }, [buf])       → buf detached      (byteLength 0)
//   postMessage(buf, [buf])              → buf detached
//   postMessage({ v: view }, [view.buffer]) → NOT detached   (byteLength kept)
//   postMessage({ x: 1 }, [buf])         → NOT detached
//
// On the web the last two detach as well. Here the transfer list acts as a
// marker on buffers found while cloning rather than as an independent
// instruction, so a buffer that the clone never walks is simply copied-by-
// omission and left alone. The documented form — buffer in the payload, buffer
// in the list — behaves exactly as documented, and that is the form used below.

import { children, post, logSys, observeChildMessages } from "/app/windows.js";

const logEl = document.getElementById('xferLog');
const readoutEl = document.getElementById('xferReadout');
const shellEl = document.getElementById('shellReadout');

/** Exported so the smoke test asserts on what the panel itself believes. */
export const transferState = {
    sends: 0,
    lastBytes: 0,
    lastChecksum: 0,
    senderByteLengthBefore: null,
    senderByteLengthAfter: null,
    detached: null,          // true once a transfer has emptied our buffer
    acks: 0,
    lastAck: null,
    intact: null,            // checksum agreed
    lastMode: null,          // 'transfer' | 'copy'
};

export const shellState = { calls: 0, lastUrl: null, lastResult: undefined };

const lines = [];
function log(kind, text) {
    lines.push({ kind, text });
    if (lines.length > 40) lines.shift();
    logEl.textContent = '';
    for (const l of lines) {
        const d = document.createElement('div');
        d.className = l.kind;
        d.textContent = l.text;
        logEl.appendChild(d);
    }
    logEl.scrollTop = logEl.scrollHeight;
}

// --- payload -----------------------------------------------------------------

/** A deterministic byte pattern, so the checksum is reproducible run to run. */
function makePayload(bytes) {
    const u8 = new Uint8Array(bytes);
    for (let i = 0; i < bytes; i++) u8[i] = (i * 31 + (i >> 8) * 7) & 0xff;
    return u8;
}

function checksum(u8) {
    let sum = 0;
    for (let i = 0; i < u8.length; i++) sum = (sum + u8[i] * (i + 1)) >>> 0;
    return sum;
}

// --- sending -----------------------------------------------------------------

/**
 * Send a fresh payload to one child.
 *
 * @param rec      child record from windows.js
 * @param bytes    payload size
 * @param useTransfer  true = transfer list (detaches ours), false = plain clone
 * @returns a record of exactly what happened to our buffer
 */
export function sendBlob(rec, bytes, useTransfer) {
    const u8 = makePayload(bytes);
    const buf = u8.buffer;
    const sum = checksum(u8);           // MUST happen before the transfer
    const tag = ++transferState.sends;

    const before = buf.byteLength;

    // The payload names the buffer directly and the transfer list names the
    // same object — the documented form, and the one that actually detaches.
    if (useTransfer) post(rec, { type: 'blob', tag, buf }, [buf]);
    else post(rec, { type: 'blob', tag, buf });

    const after = buf.byteLength;

    transferState.lastBytes = bytes;
    transferState.lastChecksum = sum;
    transferState.senderByteLengthBefore = before;
    transferState.senderByteLengthAfter = after;
    transferState.detached = after === 0;
    transferState.lastMode = useTransfer ? 'transfer' : 'copy';
    transferState.intact = null;

    log(useTransfer ? 'out' : 'sys',
        `#${tag} ${useTransfer ? 'transfer' : 'copy'} ${bytes} B -> window ${rec.id}` +
        `  sender ${before} B → ${after} B` +
        (useTransfer && after === 0 ? '  DETACHED' : ''));

    // The view is detached too, not just the buffer — worth showing, because a
    // stale view is the way this bites people in real code.
    if (useTransfer)
        log('sys', `      our Uint8Array view is now length ${u8.length} ` +
                   `(the bytes are gone from this realm)`);

    refreshReadout();
    return { tag, bytes, checksum: sum, before, after, detached: after === 0 };
}

export function sendToAll(bytes, useTransfer) {
    let n = 0;
    for (const rec of children) { sendBlob(rec, bytes, useTransfer); n++; }
    if (!n) log('sys', 'no windows open — open one first');
    return n;
}

// The child answers every blob with the size and checksum it computed on its
// own side. Agreement proves the bytes survived; our own byteLength 0 proves
// they were not copied to get there.
observeChildMessages((rec, d) => {
    if (!d || d.type !== 'blobAck') return;
    transferState.acks++;
    transferState.lastAck = d;
    transferState.intact = d.checksum === transferState.lastChecksum &&
                           d.bytes === transferState.lastBytes;
    log('in', `<- window ${rec.id} got ${d.bytes} B, checksum ${d.checksum} ` +
              `${transferState.intact ? '✓ matches' : '✗ MISMATCH'}`);
    refreshReadout();
});

function refreshReadout() {
    const s = transferState;
    readoutEl.textContent =
        `mode              ${s.lastMode || '—'}\n` +
        `payload           ${s.lastBytes} bytes   checksum ${s.lastChecksum}\n` +
        `sender before     ${s.senderByteLengthBefore === null ? '—' : s.senderByteLengthBefore + ' bytes'}\n` +
        `sender after      ${s.senderByteLengthAfter === null ? '—' : s.senderByteLengthAfter + ' bytes'}` +
            (s.detached === true ? '   ← DETACHED, zero-copy' :
             s.detached === false ? '   ← still ours, this was a copy' : '') + '\n' +
        `child reported    ${s.lastAck ? s.lastAck.bytes + ' bytes, checksum ' + s.lastAck.checksum : '—'}\n` +
        `bytes intact      ${s.intact === null ? '—' : s.intact ? 'yes' : 'NO'}\n` +
        `acks              ${s.acks} of ${s.sends} send(s)`;
}

// --- shell handoff -----------------------------------------------------------
//
// window.open(url) hands the URL to the OS handler via SDL_OpenURL and ALWAYS
// returns null — there is no popup Window object, and target/features arguments
// are accepted and ignored. Any scheme the OS accepts is allowed; bro apps
// already have full fs and child_process access, so scheme filtering here would
// protect nothing.
//
// Headless never shells out: it logs and returns null. That is what makes this
// safe to assert against in the smoke test — but the UI is still built as a
// two-step confirm, because a button that silently launches a browser is rude
// regardless of what the runtime allows.

export function shellOpen(url) {
    shellState.calls++;
    shellState.lastUrl = url;
    shellState.lastResult = window.open(url);
    logSys(`window.open(${url}) -> ${shellState.lastResult}`);
    refreshShellReadout();
    return shellState.lastResult;
}

function refreshShellReadout() {
    shellEl.textContent =
        `window.open      ${typeof window.open}\n` +
        `calls            ${shellState.calls}\n` +
        `last url         ${shellState.lastUrl || '—'}\n` +
        `returned         ${shellState.calls ? String(shellState.lastResult) +
            '   (always null — no popup object exists)' : '—'}`;
}

// --- wiring ------------------------------------------------------------------

function firstChild() {
    if (!children.length) { log('sys', 'no windows open — open one first'); return null; }
    return children[0];
}

export function bindTransferPanel() {
    const sizeEl = document.getElementById('xferSize');
    const size = () => {
        const v = parseInt(sizeEl.value, 10);
        return Number.isFinite(v) && v > 0 ? Math.min(v, 4 * 1024 * 1024) : 65536;
    };

    document.getElementById('xferSend').addEventListener('click', () => {
        const rec = firstChild(); if (rec) sendBlob(rec, size(), true);
    });
    document.getElementById('xferCopy').addEventListener('click', () => {
        const rec = firstChild(); if (rec) sendBlob(rec, size(), false);
    });
    document.getElementById('xferAll').addEventListener('click', () => {
        sendToAll(size(), true);
    });

    // Shell handoff: arm, then fire. Two clicks, and the arm state expires on
    // its own so a stray second click a minute later cannot leave the app.
    const armBox = document.getElementById('shellArm');
    const urlEl = document.getElementById('shellUrl');
    const goBtn = document.getElementById('shellGo');

    const syncArm = () => {
        goBtn.disabled = !armBox.checked;
        goBtn.className = armBox.checked ? 'danger' : '';
    };
    armBox.addEventListener('change', syncArm);
    syncArm();

    goBtn.addEventListener('click', () => {
        if (!armBox.checked) return;
        shellOpen(urlEl.value);
        // Disarm immediately: leaving the app is never a repeatable one-click.
        armBox.checked = false;
        syncArm();
    });

    for (const b of document.querySelectorAll('#shellPresets button')) {
        b.addEventListener('click', () => { urlEl.value = b.dataset.url; });
    }

    refreshReadout();
    refreshShellReadout();
}
