// store.js — the batch processor's records on disk, under the output dir.
//
//   records.jsonl   one JSON object per line, one line per photo (RECORDS.md).
//                   Appended as each photo finishes, so an interrupted run
//                   keeps what it did; the last line for a path wins, and the
//                   end of a run rewrites the file with one line per photo
//                   still on the card (compaction).
//   thumbs.jsonl    a small luma thumbnail per photo, for the burst scene
//                   check (needs neighbours' pixels, so they are kept).
//   bursts.jsonl, meta.json, summary.md: rewritten whole at the end of a run.
//
// Writes that replace a file go to <name>.tmp and are renamed over it.

const fs = require('fs');

/** The key that decides whether a photo is processed again. */
export function fileKey(stat) {
    return stat.size + ':' + Math.round(stat.mtimeMs);
}

/** Lines of a JSONL file as objects, keyed by `path` (last wins); bad lines skipped. */
export function readJsonl(file) {
    const out = new Map();
    let text = '';
    try { text = fs.readFileSync(file, 'utf-8'); } catch (_) { return out; }
    for (const line of String(text).split('\n')) {
        if (!line.trim()) continue;
        try {
            const o = JSON.parse(line);
            if (o && typeof o.path === 'string') out.set(o.path, o);
        } catch (_) { /* a torn last line from an interrupted run */ }
    }
    return out;
}

/** Replace `file` with `text`, through a temporary file and a rename. */
export function writeAtomic(file, text) {
    fs.writeFileSync(file + '.tmp', text, 'utf-8');
    fs.renameSync(file + '.tmp', file);
}

/** Replace `file` with one JSON line per object. */
export function writeJsonl(file, objects) {
    writeAtomic(file, objects.map((o) => JSON.stringify(o)).join('\n') + (objects.length ? '\n' : ''));
}

/** An appender for one JSONL file: `add(obj)` writes a line now. */
export function appender(file) {
    // A torn line from an interrupted run must not swallow the next one.
    try {
        const st = fs.statSync(file);
        if (st.size > 0) {
            const fd = fs.openSync(file, 'r');
            const last = new Uint8Array(1);
            fs.readSync(fd, last, 0, 1, st.size - 1);
            fs.closeSync(fd);
            if (last[0] !== 10) fs.appendFileSync(file, '\n', 'utf-8');
        }
    } catch (_) {}
    return { add(obj) { fs.appendFileSync(file, JSON.stringify(obj) + '\n', 'utf-8'); } };
}

/** Bytes as base64 (no btoa round trip through a binary string). */
export function toBase64(bytes) {
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let s = '';
    let i = 0;
    for (; i + 2 < bytes.length; i += 3) {
        const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
        s += A[n >> 18] + A[(n >> 12) & 63] + A[(n >> 6) & 63] + A[n & 63];
    }
    if (i < bytes.length) {
        const n = (bytes[i] << 16) | ((i + 1 < bytes.length ? bytes[i + 1] : 0) << 8);
        s += A[n >> 18] + A[(n >> 12) & 63] + (i + 1 < bytes.length ? A[(n >> 6) & 63] : '=') + '=';
    }
    return s;
}

/** base64 -> Uint8Array. */
export function fromBase64(s) {
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const clean = s.replace(/=+$/, '');
    const out = new Uint8Array(Math.floor(clean.length * 3 / 4));
    let o = 0, acc = 0, bits = 0;
    for (let i = 0; i < clean.length; i++) {
        acc = (acc << 6) | A.indexOf(clean[i]);
        bits += 6;
        if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 255; }
    }
    return out;
}
