// make_frames.js — generates the nine-slice PNG assets in ../assets/.
//
// Run once (the PNGs are committed; this exists so the fixtures are
// reproducible rather than mystery binaries):
//
//   ./build/Release/bro-headless.exe ../broworkshop/demos/platform-lab \
//       ../broworkshop/demos/platform-lab/tools/make_frames.js
//
// This is a pure-JS PNG encoder, and it is one deliberately: PNG's IDAT
// payload is a zlib stream, which is exactly what CompressionStream('deflate')
// emits. So the generator for the border-image fixture is itself a second,
// independent proof that the compression streams produce spec-shaped output —
// if brokit's 'deflate' were secretly raw DEFLATE (or gzip), the resulting
// files would not open as PNGs at all.

const fs = require('fs');

// ── PNG encoding ────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function u32(n) {
    return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function concat(parts) {
    let total = 0;
    for (const p of parts) total += p.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
}

function chunk(type, data) {
    const typeBytes = new Uint8Array([...type].map((c) => c.charCodeAt(0)));
    const body = concat([typeBytes, data]);
    return concat([u32(data.length), body, u32(crc32(body))]);
}

async function deflate(bytes) {
    // 'deflate' is the zlib container (RFC 1950), which is what PNG IDAT wants.
    const cs = new CompressionStream('deflate');
    const writer = cs.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const reader = cs.readable.getReader();
    const chunks = [];
    for (;;) {
        const r = await reader.read();
        if (r.done) break;
        chunks.push(r.value);
    }
    return concat(chunks);
}

// rgba: Uint8Array of w*h*4.
async function encodePNG(w, h, rgba) {
    // Filter type 0 (None) on every scanline — the fixtures are tiny and flat,
    // so a smarter filter would only obscure what the file contains.
    const raw = new Uint8Array(h * (1 + w * 4));
    for (let y = 0; y < h; y++) {
        raw[y * (1 + w * 4)] = 0;
        raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (1 + w * 4) + 1);
    }
    const ihdr = concat([u32(w), u32(h), new Uint8Array([8, 6, 0, 0, 0])]);
    return concat([
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', await deflate(raw)),
        chunk('IEND', new Uint8Array(0)),
    ]);
}

// ── The fixtures ────────────────────────────────────────────────────────────
//
// Every fixture is 48x48 with 16px slices, so `border-image-slice: 16` cuts it
// into nine exact 16x16 regions. Each region is a FLAT, DISTINCT colour. That
// matters: the smoke test reads back single pixels with getPixel() and asserts
// which slice landed where, which is only a meaningful assertion if a slice
// cannot be confused with its neighbour.

const S = 16, N = 48;

function blank() { return new Uint8Array(N * N * 4); }

function fillRect(buf, x0, y0, w, h, [r, g, b, a]) {
    for (let y = y0; y < y0 + h; y++) {
        for (let x = x0; x < x0 + w; x++) {
            const i = (y * N + x) * 4;
            buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
        }
    }
}

// Nine flat colours, laid out so no two adjacent regions share a channel
// pattern. The corners are fully saturated primaries/secondaries; the edges are
// mid-tones; the centre is a dark slate that only appears when `fill` is used.
const REGIONS = {
    tl: [255, 32, 32, 255],    tc: [255, 176, 32, 255],   tr: [248, 240, 48, 255],
    ml: [32, 200, 96, 255],    mc: [40, 44, 60, 255],     mr: [48, 168, 255, 255],
    bl: [128, 64, 224, 255],   bc: [232, 48, 200, 255],   br: [255, 255, 255, 255],
};

function ninePatch(regions) {
    const buf = blank();
    const cells = [
        ['tl', 0, 0], ['tc', 1, 0], ['tr', 2, 0],
        ['ml', 0, 1], ['mc', 1, 1], ['mr', 2, 1],
        ['bl', 0, 2], ['bc', 1, 2], ['br', 2, 2],
    ];
    for (const [key, cx, cy] of cells) fillRect(buf, cx * S, cy * S, S, S, regions[key]);
    return buf;
}

// A variant whose EDGE slices carry a hard two-tone split down their length.
// Flat edges look identical under stretch / repeat / round / space; a striped
// edge does not, so this is the fixture the repeat-mode row uses.
function stripedPatch() {
    const buf = ninePatch(REGIONS);
    // Top edge: left half of the slice goes dark, so tiling shows a seam count.
    fillRect(buf, S, 0, S / 2, S, [90, 60, 10, 255]);
    fillRect(buf, S, N - S, S / 2, S, [90, 20, 80, 255]);
    fillRect(buf, 0, S, S, S / 2, [10, 80, 40, 255]);
    fillRect(buf, N - S, S, S, S / 2, [16, 66, 100, 255]);
    return buf;
}

// Test scripts run as classic scripts (no import.meta), so the output path is
// derived from the app directory rather than the module URL.
const out = 'D:/projects/broworkshop/demos/platform-lab/assets/';

const files = [
    ['nine.png', ninePatch(REGIONS)],
    ['nine-striped.png', stripedPatch()],
];

for (const [name, rgba] of files) {
    const png = await encodePNG(N, N, rgba);
    fs.writeFileSync(out + name, png);
    console.log('wrote', out + name, png.length, 'bytes');
}
