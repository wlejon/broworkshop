// Pure-JS scientific download & ingest helpers for bro-headless (NO Python).
// Supports: resumable curl downloads, streaming gzipped CSV/TSV via OS gzip (`bash -c "gzip -dc"`
// or fallback Node/DecompressionStream), binary FITS BINTABLE header+row streaming, and batched bro.table inserts.

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

export function ensureParentDir(filePath) {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
}

export function downloadIfNeeded(url, destPath, label) {
    ensureParentDir(destPath);
    if (fs.existsSync(destPath) && fs.statSync(destPath).size > 256) {
        console.log(`[download] cached ${label || path.basename(destPath)} (${(fs.statSync(destPath).size / 1e6).toFixed(1)} MB)`);
        return destPath;
    }
    const tmpPath = destPath + '.part';
    console.log(`[download] fetching ${label || path.basename(destPath)} <- ${url}`);
    const res = cp.spawnSync('curl.exe', [
        '-L', '--fail', '--retry', '4', '--retry-delay', '2',
        '-C', '-', '-o', tmpPath, url,
    ], { stdio: 'inherit' });
    if (res.status !== 0) {
        throw new Error(`curl failed (${res.status}) for ${url}`);
    }
    if (fs.existsSync(destPath)) {
        try { fs.unlinkSync(destPath); } catch (_) {}
    }
    fs.renameSync(tmpPath, destPath);
    console.log(`[download] saved ${path.basename(destPath)} (${(fs.statSync(destPath).size / 1e6).toFixed(1)} MB)`);
    return destPath;
}

// Streams UTF-8 lines from a plain text or `.gz` file using async DecompressionStream on 4 MB file slices
// so multi-GB files never exceed the JS heap. Calls `onLine(line, lineIndex)` for each non-empty line.
export async function streamTextLines(filePath, onLine) {
    const isGz = filePath.endsWith('.gz');
    const st = fs.statSync(filePath);
    const fd = fs.openSync(filePath, 'r');
    const CHUNK = 4 * 1024 * 1024;
    const rawBuf = new Uint8Array(CHUNK);
    const dec = new TextDecoder('utf-8');
    let carry = '';
    let lineIdx = 0;

    try {
        if (!isGz) {
            let pos = 0;
            while (pos < st.size) {
                const n = fs.readSync(fd, rawBuf, 0, Math.min(CHUNK, st.size - pos), pos);
                if (n <= 0) break;
                pos += n;
                const text = carry + dec.decode(rawBuf.subarray(0, n), { stream: pos < st.size });
                let start = 0;
                while (true) {
                    const nl = text.indexOf('\n', start);
                    if (nl < 0) break;
                    let end = nl;
                    if (end > start && text.charCodeAt(end - 1) === 13) end--;
                    if (end > start) onLine(text.slice(start, end), lineIdx++);
                    start = nl + 1;
                }
                carry = text.slice(start);
            }
            if (carry.length > 0) onLine(carry, lineIdx++);
            return lineIdx;
        }

        const ds = new DecompressionStream('gzip');
        const writer = ds.writable.getWriter();
        const reader = ds.readable.getReader();

        const pumpRead = (async () => {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                const text = carry + dec.decode(value, { stream: true });
                let start = 0;
                while (true) {
                    const nl = text.indexOf('\n', start);
                    if (nl < 0) break;
                    let end = nl;
                    if (end > start && text.charCodeAt(end - 1) === 13) end--;
                    if (end > start) onLine(text.slice(start, end), lineIdx++);
                    start = nl + 1;
                }
                carry = text.slice(start);
            }
            const tail = carry + dec.decode();
            if (tail.length > 0) onLine(tail, lineIdx++);
        })();

        let pos = 0;
        while (pos < st.size) {
            const n = fs.readSync(fd, rawBuf, 0, Math.min(CHUNK, st.size - pos), pos);
            if (n <= 0) break;
            pos += n;
            await writer.write(rawBuf.slice(0, n));
        }
        await writer.close();
        await pumpRead;
        return lineIdx;
    } finally {
        fs.closeSync(fd);
    }
}

// Parses FITS primary + BINTABLE header starting at offset 0 of `fd` (blocks of 2880 bytes).
// Returns { dataOffset, rowBytes, numRows, cols: { NAME: { offset, form, count, kind } } }.
export function parseFitsBinTableHeader(fd) {
    const blk = new Uint8Array(2880);
    const dec = new TextDecoder('ascii');
    let offset = 0;

    function readHeaderHdu() {
        const cards = [];
        while (true) {
            const n = fs.readSync(fd, blk, 0, 2880, offset);
            if (n < 2880) throw new Error('unexpected EOF reading FITS header at ' + offset);
            offset += 2880;
            const s = dec.decode(blk);
            let ended = false;
            for (let i = 0; i < 36; i++) {
                const card = s.slice(i * 80, (i + 1) * 80);
                if (card.startsWith('END     ')) { ended = true; break; }
                cards.push(card);
            }
            if (ended) break;
        }
        return cards;
    }

    function cardVal(cards, key) {
        for (const c of cards) {
            if (c.slice(0, 8).trim() === key && c[8] === '=') {
                let raw = c.slice(10);
                const slash = raw.indexOf('/');
                if (slash >= 0) raw = raw.slice(0, slash);
                raw = raw.trim();
                if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).trim();
                return raw;
            }
        }
        return null;
    }

    // HDU 0 (Primary, skip any data payload if NAXIS > 0)
    const pCards = readHeaderHdu();
    const pNaxis = parseInt(cardVal(pCards, 'NAXIS') || '0', 10);
    if (pNaxis > 0) {
        const bp = Math.abs(parseInt(cardVal(pCards, 'BITPIX') || '8', 10)) / 8;
        let elems = 1;
        for (let a = 1; a <= pNaxis; a++) elems *= parseInt(cardVal(pCards, 'NAXIS' + a) || '0', 10);
        const dataBytes = bp * elems;
        offset += Math.ceil(dataBytes / 2880) * 2880;
    }

    // HDU 1 (BINTABLE)
    const tCards = readHeaderHdu();
    const xtension = cardVal(tCards, 'XTENSION');
    if (xtension !== 'BINTABLE') {
        throw new Error('expected HDU 1 XTENSION=BINTABLE, got ' + xtension);
    }
    const rowBytes = parseInt(cardVal(tCards, 'NAXIS1'), 10);
    const numRows = parseInt(cardVal(tCards, 'NAXIS2'), 10);
    const tfields = parseInt(cardVal(tCards, 'TFIELDS'), 10);

    const cols = {};
    let byteCursor = 0;
    for (let f = 1; f <= tfields; f++) {
        const name = (cardVal(tCards, 'TTYPE' + f) || ('COL_' + f)).trim();
        const form = (cardVal(tCards, 'TFORM' + f) || '').trim();
        const m = /^(\d*)([A-Z])/.exec(form);
        const rep = m && m[1] ? parseInt(m[1], 10) : 1;
        const kind = m ? m[2] : 'B';
        const elemSizes = { L: 1, X: 1, B: 1, I: 2, J: 4, K: 8, A: 1, E: 4, D: 8, C: 8, M: 16 };
        const sz = (kind === 'X') ? Math.ceil(rep / 8) : rep * (elemSizes[kind] || 1);
        cols[name] = { offset: byteCursor, form, rep, kind, byteLength: sz };
        byteCursor += sz;
    }
    return { dataOffset: offset, rowBytes, numRows, cols };
}

export class TypedBatchFlusher {
    constructor(tbl, batchSize, colSpec) {
        this.tbl = tbl;
        this.batchSize = batchSize;
        this.colSpec = colSpec; // [{ name, kind: 'i32'|'u32'|'i64'|'f32'|'f64'|'bool'|'dict' }]
        this.arrays = {};
        for (const c of colSpec) {
            if (c.kind === 'i32') this.arrays[c.name] = new Int32Array(batchSize);
            else if (c.kind === 'u32' || c.kind === 'dict') this.arrays[c.name] = new Uint32Array(batchSize);
            else if (c.kind === 'i64') this.arrays[c.name] = new BigInt64Array(batchSize);
            else if (c.kind === 'f32') this.arrays[c.name] = new Float32Array(batchSize);
            else if (c.kind === 'f64') this.arrays[c.name] = new Float64Array(batchSize);
            else if (c.kind === 'bool') this.arrays[c.name] = new Uint8Array(batchSize);
        }
        this.len = 0;
        this.total = 0;
        this.dictCache = new Map();
    }

    intern(str) {
        let id = this.dictCache.get(str);
        if (id === undefined) {
            id = this.tbl.internString(str);
            this.dictCache.set(str, id);
        }
        return id;
    }

    flush() {
        if (this.len === 0) return;
        const map = {};
        if (this.len === this.batchSize) {
            for (const c of this.colSpec) map[c.name] = this.arrays[c.name];
        } else {
            for (const c of this.colSpec) map[c.name] = this.arrays[c.name].subarray(0, this.len);
        }
        this.tbl.insertMany(map);
        this.total += this.len;
        this.len = 0;
    }
}
