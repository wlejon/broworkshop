// compression.js — CompressionStream / DecompressionStream (Compression Streams).
//
// brokit ships the web-standard classes backed by miniz, in three formats:
//   gzip        RFC 1952 container (magic 1f 8b, CRC32 + ISIZE footer)
//   deflate     RFC 1950 zlib container (2-byte header, Adler-32 footer)
//   deflate-raw RFC 1951 bare DEFLATE, no container at all
//
// The interesting thing about these is that they are TRANSFORM STREAMS, not
// functions. That is easy to under-demonstrate: `compress(bytes)` in one gulp
// looks like a library call and tells you nothing about backpressure, chunk
// boundaries, or whether the codec holds state across writes. So this panel
// drives them the way real code does — pipeThrough, chained pipelines, and a
// chunked writer — and MEASURES the things only a stream can get wrong:
//
//   - chunk counts in and out (a codec that buffered everything would emit 1)
//   - round-trip byte identity across a multi-chunk write
//   - compressed size vs input for both compressible and incompressible data
//   - container bytes on the wire, so 'gzip' really is gzip and 'deflate-raw'
//     really has no header
//
// The last one matters more than it sounds: all three formats round-trip
// against themselves even if they were secretly the same codec. Only the
// header bytes distinguish them.

export const cmpState = {
    runs: [],           // [{ label, format, inBytes, outBytes, ratio, ok, chunksIn, chunksOut }]
    lastError: null,
    log: [],
    busy: false,
};

const enc = new TextEncoder();
const dec = new TextDecoder();

export const FORMATS = ['gzip', 'deflate', 'deflate-raw'];

function logLine(text) {
    cmpState.log.push(text);
    if (cmpState.log.length > 60) cmpState.log.shift();
    const el = document.getElementById('cmpLog');
    if (el) {
        el.textContent = cmpState.log.slice(-16).join('\n');
        el.scrollTop = el.scrollHeight;
    }
}

// ── Stream plumbing ─────────────────────────────────────────────────────────

export function streamFrom(chunks) {
    return new ReadableStream({
        start(c) {
            for (const ch of chunks) c.enqueue(ch);
            c.close();
        },
    });
}

// Reading a stream to completion while COUNTING chunks — the count is data, not
// bookkeeping. A transform that emitted everything in one chunk would still
// round-trip; it just would not be a stream.
export async function readAll(stream) {
    const reader = stream.getReader();
    const parts = [];
    let total = 0;
    for (;;) {
        const r = await reader.read();
        if (r.done) break;
        parts.push(r.value);
        total += r.value.length;
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return { bytes: out, chunkCount: parts.length };
}

export function bytesEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

export async function compress(bytes, format, chunkSize) {
    const chunks = chunkSize ? sliceInto(bytes, chunkSize) : [bytes];
    return readAll(streamFrom(chunks).pipeThrough(new CompressionStream(format)));
}

export async function decompress(bytes, format, chunkSize) {
    const chunks = chunkSize ? sliceInto(bytes, chunkSize) : [bytes];
    return readAll(streamFrom(chunks).pipeThrough(new DecompressionStream(format)));
}

// A single pipeline with BOTH transforms chained. If the codec kept any global
// state, running compressor and decompressor concurrently over the same data
// is what would expose it — sequential calls would not.
export async function roundTripPiped(bytes, format, chunkSize) {
    const chunks = chunkSize ? sliceInto(bytes, chunkSize) : [bytes];
    return readAll(
        streamFrom(chunks)
            .pipeThrough(new CompressionStream(format))
            .pipeThrough(new DecompressionStream(format)),
    );
}

export function sliceInto(bytes, size) {
    const out = [];
    for (let i = 0; i < bytes.length; i += size) out.push(bytes.subarray(i, Math.min(i + size, bytes.length)));
    return out;
}

// ── Sample payloads ─────────────────────────────────────────────────────────
//
// Two payloads with opposite characters, because "compression works" is only
// interesting if you can also show it correctly REFUSING to shrink noise.

export function compressibleBytes(n) {
    // Highly repetitive English — should compress to a small fraction.
    const unit = 'the quick brown fox jumps over the lazy dog. ';
    let s = '';
    while (s.length < n) s += unit;
    return enc.encode(s.slice(0, n));
}

export function incompressibleBytes(n) {
    // xorshift32 — deterministic, so the panel and the test agree byte for
    // byte across runs, but statistically flat, so DEFLATE cannot win.
    const out = new Uint8Array(n);
    let x = 0x9e3779b9;
    for (let i = 0; i < n; i++) {
        x ^= x << 13; x ^= x >>> 17; x ^= x << 5; x |= 0;
        out[i] = x & 0xff;
    }
    return out;
}

export function unicodeBytes() {
    // Multi-byte UTF-8 including astral-plane characters, so a codec that
    // mangled bytes at a chunk boundary would produce mojibake rather than a
    // silent pass.
    const s = 'héllo wörld — 日本語テキスト — 🦊🐶🎉 — ' .repeat(64);
    return enc.encode(s);
}

// ── Container inspection ────────────────────────────────────────────────────
//
// The only thing that distinguishes the three formats on the wire. `gzip` must
// start 1f 8b 08 and carry a little-endian uncompressed-size in its last four
// bytes; `deflate` must start with a zlib CMF/FLG pair whose big-endian value
// is a multiple of 31; `deflate-raw` must be neither.

export function inspectContainer(bytes, format) {
    const info = { format, first: [...bytes.subarray(0, 4)], length: bytes.length };
    if (format === 'gzip') {
        info.gzipMagic = bytes[0] === 0x1f && bytes[1] === 0x8b;
        info.deflateMethod = bytes[2] === 0x08;
        info.isize = bytes.length >= 4
            ? (bytes[bytes.length - 4] | (bytes[bytes.length - 3] << 8) |
               (bytes[bytes.length - 2] << 16) | (bytes[bytes.length - 1] << 24)) >>> 0
            : null;
    } else if (format === 'deflate') {
        info.cmf = bytes[0];
        info.zlibHeaderValid = ((bytes[0] << 8) | bytes[1]) % 31 === 0;
        info.cm = bytes[0] & 0x0f;   // 8 = deflate
    } else {
        info.noGzipMagic = !(bytes[0] === 0x1f && bytes[1] === 0x8b);
    }
    return info;
}

// ── The bench ───────────────────────────────────────────────────────────────

async function runOne(label, bytes, format, chunkSize) {
    const t0 = performance.now();
    const compressed = await compress(bytes, format, chunkSize);
    const restored = await decompress(compressed.bytes, format, chunkSize);
    const ms = performance.now() - t0;
    const ok = bytesEqual(restored.bytes, bytes);
    const run = {
        label, format,
        inBytes: bytes.length,
        outBytes: compressed.bytes.length,
        ratio: compressed.bytes.length / bytes.length,
        ok,
        chunksIn: chunkSize ? Math.ceil(bytes.length / chunkSize) : 1,
        chunksOut: compressed.chunkCount,
        restoredChunks: restored.chunkCount,
        container: inspectContainer(compressed.bytes, format),
        ms,
    };
    cmpState.runs.push(run);
    logLine(
        `${label.padEnd(24)} ${format.padEnd(12)} ${String(bytes.length).padStart(8)} → ` +
        `${String(compressed.bytes.length).padStart(8)} (${(run.ratio * 100).toFixed(1)}%) ` +
        `chunks ${run.chunksIn}→${run.chunksOut} ${ok ? 'OK' : 'MISMATCH'}`);
    return run;
}

export async function runBench() {
    if (cmpState.busy) return cmpState.runs;
    cmpState.busy = true;
    cmpState.runs = [];
    try {
        const text = compressibleBytes(64 * 1024);
        const noise = incompressibleBytes(256 * 1024);
        const uni = unicodeBytes();

        for (const format of FORMATS) {
            await runOne('64 KB repetitive text', text, format, null);
        }
        // 4 KB chunks over 256 KB of noise: the multi-chunk case in both
        // directions, and the case where compression must NOT help.
        await runOne('256 KB noise, 4 KB chunks', noise, 'gzip', 4096);
        await runOne('UTF-8 astral text', uni, 'deflate', 1024);
    } finally {
        cmpState.busy = false;
    }
    renderRuns();
    return cmpState.runs;
}

function renderRuns() {
    const host = document.getElementById('cmpTable');
    if (!host) return;
    while (host.children.length > 1) host.removeChild(host.lastChild);
    for (const r of cmpState.runs) {
        const row = document.createElement('div');
        row.className = 'cmp-row mono';
        row.innerHTML =
            `<span>${r.label}</span><span>${r.format}</span>` +
            `<span>${r.inBytes}</span><span>${r.outBytes}</span>` +
            `<span>${(r.ratio * 100).toFixed(1)}%</span>` +
            `<span>${r.chunksIn} → ${r.chunksOut}</span>` +
            `<span class="${r.ok ? 'ok' : 'bad'}">${r.ok ? 'byte-identical' : 'MISMATCH'}</span>`;
        host.appendChild(row);
    }
}

// ── Error surface ───────────────────────────────────────────────────────────
//
// Failure modes are part of the API and the easiest part to get silently
// wrong (a codec that "recovers" from truncated input is worse than one that
// throws). Each of these must reject; the panel shows which did.

export async function probeErrors() {
    const results = [];

    for (const bad of ['br', 'zstd', 'GZIP', '']) {
        results.push({ case: `new CompressionStream("${bad}")`, ...await expectThrow(() => new CompressionStream(bad)) });
        results.push({ case: `new DecompressionStream("${bad}")`, ...await expectThrow(() => new DecompressionStream(bad)) });
    }

    const good = (await compress(enc.encode('hello compression'), 'gzip')).bytes;

    results.push({ case: 'decompress corrupt gzip', ...await expectReject(async () => {
        const bad = good.slice();
        bad[bad.length - 6] ^= 0xff;   // break the CRC, not the header
        await decompress(bad, 'gzip');
    }) });

    results.push({ case: 'decompress truncated gzip', ...await expectReject(async () => {
        await decompress(good.subarray(0, good.length - 6), 'gzip');
    }) });

    results.push({ case: 'decompress trailing garbage', ...await expectReject(async () => {
        const extra = new Uint8Array(good.length + 8);
        extra.set(good, 0);
        extra.set([1, 2, 3, 4, 5, 6, 7, 8], good.length);
        await decompress(extra, 'gzip');
    }) });

    results.push({ case: 'gzip bytes into deflate decoder', ...await expectReject(async () => {
        await decompress(good, 'deflate');
    }) });

    results.push({ case: 'non-BufferSource chunk', ...await expectReject(async () => {
        const cs = new CompressionStream('gzip');
        const w = cs.writable.getWriter();
        await w.write('a string, not bytes');
        await w.close();
    }) });

    renderErrors(results);
    return results;
}

async function expectThrow(fn) {
    try { fn(); return { threw: false, name: null }; }
    catch (e) { return { threw: true, name: e && e.name, isTypeError: e instanceof TypeError }; }
}

async function expectReject(fn) {
    try { await fn(); return { threw: false, name: null }; }
    catch (e) { return { threw: true, name: e && e.name, isTypeError: e instanceof TypeError }; }
}

function renderErrors(results) {
    const host = document.getElementById('cmpErrors');
    if (!host) return;
    host.textContent = results
        .map((r) => `${r.threw ? '✓' : '✗'} ${r.case.padEnd(36)} ${r.threw ? (r.name + (r.isTypeError ? ' (TypeError)' : '')) : 'DID NOT THROW'}`)
        .join('\n');
}

// ── A practical use: compressed localStorage ────────────────────────────────
//
// Round-tripping a buffer proves the codec. Storing something proves the API is
// usable — and it exercises the base64 hop every real "compress before you
// persist" path needs, since storage is a string store.

export async function saveCompressed(key, text) {
    const packed = (await compress(enc.encode(text), 'gzip')).bytes;
    let bin = '';
    for (let i = 0; i < packed.length; i++) bin += String.fromCharCode(packed[i]);
    const b64 = btoa(bin);
    localStorage.setItem(key, b64);
    return { rawBytes: enc.encode(text).length, packedBytes: packed.length, storedChars: b64.length };
}

export async function loadCompressed(key) {
    const b64 = localStorage.getItem(key);
    if (b64 === null) return null;
    const bin = atob(b64);
    const packed = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) packed[i] = bin.charCodeAt(i);
    return dec.decode((await decompress(packed, 'gzip')).bytes);
}

export async function demoStorage() {
    const text = 'platform-lab persisted note: ' + 'lorem ipsum dolor sit amet '.repeat(200);
    const stats = await saveCompressed('pl.note', text);
    const back = await loadCompressed('pl.note');
    const ok = back === text;
    setText('cmpStorage',
        `${stats.rawBytes} B → ${stats.packedBytes} B gzip → ${stats.storedChars} B base64 · ` +
        `round-trip ${ok ? 'exact' : 'MISMATCH'}`);
    return { ...stats, ok };
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el && el.textContent !== text) el.textContent = text;
}

export function initCompression() {
    bind('cmpRun', () => runBench());
    bind('cmpErrorsRun', () => probeErrors());
    bind('cmpStorageRun', () => demoStorage());

    setText('cmpAvailable',
        typeof CompressionStream === 'function' && typeof DecompressionStream === 'function'
            ? 'available' : 'MISSING');

    // Kick one bench so the panel is populated on open rather than empty.
    runBench().then(() => probeErrors()).then(() => demoStorage());
}

function bind(id, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
}
