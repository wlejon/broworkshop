// lib/city/cache.js — the generated city kept on disk, so a later run reads
// it back instead of growing it again (generateCity takes seconds; reading
// it, a fraction of that).
//
// loadOrGenerateCity(site, { sources, opts }) -> { city, hit, path }
//   city: what generateCity(site, opts) returns, from the cache when its key
//   matches, else generated and written for the next run.
//   sources: the site's own module directories (mount paths such as
//   '/app/world'); every .js file in them and in lib/city goes into the key,
//   so an edit to any code the city is grown from misses the cache.
//
// The key is a hash of FORMAT, those files' names and bytes, the site's data
// (JSON: its numbers and centres, not its functions) and opts. The file is
// city-<key>.bin in bro.app.cacheDir (an app without an id: .cache/ under
// the app's folder, which git ignores); writing one removes the others.
//
// File: a 16-byte head (magic, FORMAT, the JSON's byte length, 0), the JSON
// (UTF-8, padded to 8 bytes), then the blobs, each 8-byte aligned. The JSON
// is the city's data tree with these in place of values:
//   { $t: [type, offset, length] }  a typed array, its bytes in the blobs
//   { $a: [offset, length, 'i'?] } a plain array of four or more numbers, as
//                                   float64s, or int32s when every one is an int32 ('i')
//   { $c: [of, [[keys, columns]...]] }   an array of plain objects by columns:
//                                   element i has shape of[i]'s keys, its values the
//                                   next row of that shape's columns
//   { $n: 'NaN' | 'Infinity' | '-Infinity' | '-0' }   numbers JSON cannot hold
//   { $u: 0 }                       undefined
// Only data is stored: the field keeps its sampled grids and gets its lookups
// back from fieldFrom(), and `graded` is rebuilt over the ground. Anything
// else the encoder does not know (a function, a Map, a class instance, an
// object reached twice) throws, rather than come back different.

import { generateCity } from "./generate.js";
import { fieldFrom } from "./field.js";
import { gradedHeight } from "./ground.js";

/** Bump when the encoding or what generateCity's output means changes without a source edit. */
const FORMAT = 1;
const MAGIC = 0x5954434d; // 'MCTY'

const TYPED = {
    Float32Array, Float64Array, Int8Array, Int16Array, Int32Array,
    Uint8Array, Uint8ClampedArray, Uint16Array, Uint32Array,
};

export function loadOrGenerateCity(site, { sources = [], opts = {}, dir: inDir = null, mounts = null } = {}) {
    const fs = require('fs');
    let dir = null, key = null, path = null;
    try {
        dir = inDir ?? cacheDir();
        key = cityKey(fs, site, sources, opts, mounts);
        path = `${dir}/city-${key}.bin`;
    } catch (e) {
        console.warn(`city cache: off (${e.message})`);
    }
    if (path && fs.existsSync(path)) {
        const t0 = perf.now();
        try {
            const city = decodeCity(fs.readFileSync(path), key, site);
            city.timings = { load: perf.now() - t0 };
            return { city, hit: true, path };
        } catch (e) {
            // A torn or foreign file: grow the city again and overwrite it.
            console.warn(`city cache: ${path} unreadable (${e.message}), regenerating`);
        }
    }
    const city = generateCity(site, opts);
    if (path) {
        try {
            const t0 = perf.now();
            const bytes = encodeCity(city, key);
            // Written beside and renamed over, so a run killed mid-write leaves no torn file under the key's name.
            fs.mkdirSync(dir, { recursive: true });
            const tmp = `${path}.tmp`;
            fs.writeFileSync(tmp, bytes);
            fs.renameSync(tmp, path);
            for (const f of fs.readdirSync(dir)) {
                if (f.startsWith('city-') && f.endsWith('.bin') && `${dir}/${f}` !== path) fs.unlinkSync(`${dir}/${f}`);
            }
            city.timings.cacheWrite = perf.now() - t0;
        } catch (e) {
            console.warn(`city cache: could not write ${path} (${e.message})`);
        }
    }
    return { city, hit: false, path };
}

/** Where the city's files live: the app's cache dir (an app without an id: .cache/ in the app). */
export function cacheDir() {
    const d = bro.app?.cacheDir;
    if (d) return d;
    return `${bro.appDir}/.cache`;
}

/**
 * Grow the city in a worker (url: the app's script calling city_worker.js's
 * serveGrow with its site) into the cache dir, so the page's own
 * loadOrGenerateCity after it is a read. Resolves to the worker's reply
 * ({ ok, hit, ms } or { ok: false, error }).
 */
export function growInWorker(url, { sources = [] } = {}) {
    return new Promise((resolve) => {
        const w = new Worker(url, { type: 'module' });
        w.onmessage = (ev) => { resolve(ev.data); w.terminate(); };
        w.onerror = (e) => { resolve({ ok: false, error: e.message }); w.terminate(); };
        w.postMessage(cacheWhere(sources));
    });
}

/** Where a worker finds the city the page grew: { sources, dir, mounts } for its loadOrGenerateCity. */
export function cacheWhere(sources = []) {
    const mounts = Object.fromEntries(['/lib/city', ...sources].map((m) => [m, bro.resolvePath(m)]));
    return { sources, dir: cacheDir(), mounts };
}

/**
 * Whether the city's file is already in the cache (no decoding): the
 * worker's quick answer on a warm start.
 */
export function cachedCity(site, { sources = [], opts = {}, dir = null, mounts = null } = {}) {
    try {
        const fs = require('fs');
        return fs.existsSync(`${dir ?? cacheDir()}/city-${cityKey(fs, site, sources, opts, mounts)}.bin`);
    } catch (e) {
        return false;
    }
}

/** 64 bits (two 32-bit lanes) over FORMAT, the source files and the site's data, as 16 hex digits. */
function cityKey(fs, site, sources, opts, mounts) {
    let h1 = 0x811c9dc5 ^ FORMAT, h2 = 0x9747b28c;
    const mix = (b) => {
        h1 = Math.imul(h1 ^ b, 0x01000193);
        h2 = Math.imul(h2 ^ b, 0x5bd1e995); h2 ^= h2 >>> 15;
    };
    const text = (s) => { for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); mix(c & 0xff); mix(c >>> 8); } mix(0); };
    for (const mount of ['/lib/city', ...sources]) {
        // (A worker has no bro.resolvePath: the page passes the mounts resolved.)
        const real = mounts ? mounts[mount] : bro.resolvePath(mount);
        const names = fs.readdirSync(real).filter((f) => f.endsWith('.js')).sort();
        for (const name of names) {
            text(`${mount}/${name}`);
            const b = fs.readFileSync(`${real}/${name}`);
            const u8 = b instanceof Uint8Array ? b : new Uint8Array(b);
            for (let i = 0; i < u8.length; i++) mix(u8[i]);
            mix(0xff);
        }
    }
    text(JSON.stringify(site));
    text(JSON.stringify(opts));
    const hex = (h) => (h >>> 0).toString(16).padStart(8, '0');
    return hex(h1) + hex(h2);
}

function encodeCity(city, key) {
    const { field, graded, timings, ...rest } = city;
    if (field.site === undefined || typeof graded !== 'function') throw new Error('not a generateCity result');
    const blobs = [];
    let blobBytes = 0;
    const blob = (u8) => {
        const off = blobBytes;
        blobs.push(u8);
        blobBytes += (u8.byteLength + 7) & ~7;
        return off;
    };
    const seen = new Set();
    const path = [];
    const fail = (what) => { throw new Error(`city cache: ${what} at ${path.join('.') || '(root)'}`); };

    const enc = (v) => {
        switch (typeof v) {
            case 'string': case 'boolean': return v;
            case 'number': return numberOut(v);
            case 'undefined': return { $u: 0 };
            case 'object': break;
            default: fail(`a ${typeof v}`);
        }
        if (v === null) return null;
        if (seen.has(v)) fail('an object reached twice');
        seen.add(v);
        if (ArrayBuffer.isView(v)) {
            const type = v.constructor.name;
            if (TYPED[type] !== v.constructor) fail(`a ${type}`);
            const off = blob(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
            return { $t: [type, off, v.length] };
        }
        if (Array.isArray(v)) {
            let numeric = v.length >= 4, ints = true;
            for (let i = 0; numeric && i < v.length; i++) {
                const x = v[i];
                numeric = typeof x === 'number';
                ints = ints && (x | 0) === x && !Object.is(x, -0);
            }
            if (numeric && ints) return { $a: [blob(new Uint8Array(Int32Array.from(v).buffer)), v.length, 'i'] };
            if (numeric) return { $a: [blob(new Uint8Array(Float64Array.from(v).buffer)), v.length] };
            const cols = v.length >= 16 && columns(v);
            if (cols) return cols;
            const out = new Array(v.length);
            for (let i = 0; i < v.length; i++) { path.push(i); out[i] = enc(v[i]); path.pop(); }
            return out;
        }
        const proto = Object.getPrototypeOf(v);
        if (proto !== Object.prototype && proto !== null) fail(`a ${v.constructor?.name ?? 'class'} instance`);
        const out = {};
        for (const k of Object.keys(v)) {
            if (k.startsWith('$')) fail(`the key ${k}`);
            path.push(k); out[k] = enc(v[k]); path.pop();
        }
        return out;
    };

    // An array of many plain objects of a few shapes (lots, buildings, edges,
    // faces) goes by columns: each shape's keys once, then one array per key,
    // so a column of numbers is one blob instead of a JSON number per object.
    // `of` says which shape each element has, in order.
    const columns = (v) => {
        const shapes = new Map();
        const of = new Array(v.length);
        for (let i = 0; i < v.length; i++) {
            const o = v[i];
            if (o === null || typeof o !== 'object' || Object.getPrototypeOf(o) !== Object.prototype || seen.has(o)) return null;
            const keys = Object.keys(o);
            const sig = keys.join('\0');
            let sh = shapes.get(sig);
            if (!sh) {
                if (shapes.size === 8) return null;
                for (const k of keys) if (k.startsWith('$')) return null;
                sh = { index: shapes.size, keys, rows: [] };
                shapes.set(sig, sh);
            }
            sh.rows.push(o);
            of[i] = sh.index;
        }
        for (const o of v) {
            if (seen.has(o)) fail('an object reached twice');
            seen.add(o);
        }
        const out = [];
        for (const sh of shapes.values()) {
            const cols = sh.keys.map((k) => {
                const col = new Array(sh.rows.length);
                for (let r = 0; r < sh.rows.length; r++) col[r] = sh.rows[r][k];
                path.push(`*.${k}`);
                const e = enc(col);
                path.pop();
                return e;
            });
            out.push([sh.keys, cols]);
        }
        return { $c: [enc(of), out] };
    };

    const data = enc({ field: { n: field.n, half: field.half, grids: field.grids }, ...rest });
    const json = new TextEncoder().encode(JSON.stringify({ key, data }));
    const jsonPad = (json.byteLength + 7) & ~7;
    const out = new Uint8Array(16 + jsonPad + blobBytes);
    new Uint32Array(out.buffer, 0, 4).set([MAGIC, FORMAT, json.byteLength, 0]);
    out.set(json, 16);
    let at = 16 + jsonPad;
    for (const b of blobs) { out.set(b, at); at += (b.byteLength + 7) & ~7; }
    return out;
}

function numberOut(v) {
    if (Number.isFinite(v)) return Object.is(v, -0) ? { $n: '-0' } : v;
    return { $n: String(v) };
}

function decodeCity(file, key, site) {
    let u8 = file instanceof Uint8Array ? file : new Uint8Array(file);
    // Typed views need their element alignment; a read that did not land on 8 bytes is copied once.
    if (u8.byteOffset & 7) u8 = u8.slice();
    if (u8.byteLength < 16) throw new Error('short file');
    const head = new Uint32Array(u8.buffer, u8.byteOffset, 4);
    if (head[0] !== MAGIC || head[1] !== FORMAT) throw new Error('not a city cache of this format');
    const jsonLen = head[2];
    const base = u8.byteOffset + 16 + ((jsonLen + 7) & ~7);
    if (base - u8.byteOffset > u8.byteLength) throw new Error('short file');
    const top = JSON.parse(new TextDecoder().decode(u8.subarray(16, 16 + jsonLen)));
    if (top.key !== key) throw new Error('key mismatch');
    const end = u8.byteOffset + u8.byteLength;
    const span = (off, bytes) => {
        if (base + off + bytes > end) throw new Error('blob past the end');
        return base + off;
    };

    const dec = (v) => {
        if (v === null || typeof v !== 'object') return v;
        if (Array.isArray(v)) {
            const out = new Array(v.length);
            for (let i = 0; i < v.length; i++) out[i] = dec(v[i]);
            return out;
        }
        if (v.$t) {
            const [type, off, n] = v.$t;
            const T = TYPED[type];
            // A copy of its own, so a consumer that transfers or reuses its buffer holds only this array.
            return new T(u8.buffer, span(off, n * T.BYTES_PER_ELEMENT), n).slice();
        }
        if (v.$a) {
            const [off, n, ints] = v.$a;
            const f = ints ? new Int32Array(u8.buffer, span(off, n * 4), n) : new Float64Array(u8.buffer, span(off, n * 8), n);
            const out = new Array(n);
            for (let i = 0; i < n; i++) out[i] = f[i];
            return out;
        }
        if (v.$c) {
            const of = dec(v.$c[0]);
            const shapes = v.$c[1].map(([keys, cols]) => ({ keys, cols: cols.map(dec), row: 0 }));
            const out = new Array(of.length);
            for (let i = 0; i < of.length; i++) {
                const sh = shapes[of[i]], r = sh.row++, o = {};
                for (let j = 0; j < sh.keys.length; j++) o[sh.keys[j]] = sh.cols[j][r];
                out[i] = o;
            }
            return out;
        }
        if (v.$n !== undefined) return v.$n === '-0' ? -0 : Number(v.$n);
        if (v.$u !== undefined) return undefined;
        const out = {};
        for (const k of Object.keys(v)) out[k] = dec(v[k]);
        return out;
    };

    const { field: f, streetLines, graph, ground, lots, masses, transit } = dec(top.data);
    if (f.half !== site.half) throw new Error('site extent differs');
    const field = fieldFrom(site, f.n, f.grids);
    const graded = (x, z) => gradedHeight(ground, site.height, x, z);
    return { field, streetLines, graph, ground, graded, lots, masses, transit, timings: {} };
}
