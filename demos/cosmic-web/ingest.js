// Pure-JS DESI DR1 FITS BINTABLE downloader & columnar .brotable v2 ingester (NO Python).
// Default catalog: zpix-main-dark.fits (11.29 GB, 12.78M rows).
// Run via bro-headless:
//   bro-headless --grant files,net,spawn demos/cosmic-web demos/cosmic-web/ingest.js
// Flags:
//   --url <URL_OR_PATH>   (e.g. zpix-main-bright.fits or local FITS/CSV path)
//   --max-rows <N>        (optional row cap after filtering)
//   --keep-raw            (preserve temporary downloaded FITS file)

import {
    downloadIfNeeded,
    streamTextLines,
    parseFitsBinTableHeader,
    TypedBatchFlusher,
} from "/lib/sci-atlas/ingest-common.js";
import { resolveDataDir, resolveDataFile, ensureDir, fmtInt } from "/lib/sci-atlas/data-paths.js";
import {
    COSMO_SCHEMA,
    classifyDesiSpectype,
    comovingDistanceMpcH,
    lookbackGyr,
} from "/app/data.js";

const fs = require('fs');
const path = require('path');

const DEFAULT_URL = 'https://data.desi.lbl.gov/public/dr1/spectro/redux/iron/zcatalog/v1/zpix-main-dark.fits';

function parseCliOpts() {
    const argv = (globalThis.bro && bro.app && bro.app.argv) || (globalThis.process && process.argv) || [];
    let url = DEFAULT_URL;
    let maxRows = Infinity;
    let keepRaw = false;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--url' && argv[i + 1]) url = argv[++i];
        else if (argv[i] === '--max-rows' && argv[i + 1]) maxRows = Math.max(1, parseInt(argv[++i], 10) || Infinity);
        else if (argv[i] === '--keep-raw') keepRaw = true;
    }
    return { url, maxRows, keepRaw };
}

const COL_SPEC = [
    { name: 'ord', kind: 'u32' },
    { name: 'cx', kind: 'f32' },
    { name: 'cy', kind: 'f32' },
    { name: 'cz', kind: 'f32' },
    { name: 'z', kind: 'f32' },
    { name: 'lookback_gyr', kind: 'f32' },
    { name: 'g_r', kind: 'f32' },
    { name: 'r_z', kind: 'f32' },
    { name: 'flux_r', kind: 'f32' },
    { name: 'spectype', kind: 'i32' },
    { name: 'void_score', kind: 'f32' },
];

// FITS BINTABLE numbers are big-endian IEEE floats/ints (`littleEndian = false`).
function readFitsNum(dv, byteOff, col) {
    if (!col) return NaN;
    const off = byteOff + col.offset;
    const k = col.kind;
    if (k === 'D') return dv.getFloat64(off, false);
    if (k === 'E') return dv.getFloat32(off, false);
    if (k === 'K') return Number(dv.getBigInt64(off, false));
    if (k === 'J') return dv.getInt32(off, false);
    if (k === 'I') return dv.getInt16(off, false);
    if (k === 'B') return dv.getUint8(off);
    return NaN;
}

function isFitsZeroInt(dv, byteOff, col) {
    if (!col) return true;
    const off = byteOff + col.offset;
    const k = col.kind;
    if (k === 'K') return dv.getBigInt64(off, false) === 0n;
    if (k === 'J') return dv.getInt32(off, false) === 0;
    if (k === 'I') return dv.getInt16(off, false) === 0;
    if (k === 'B') return dv.getUint8(off) === 0;
    return false;
}

function readFitsBigInt(dv, byteOff, col) {
    if (!col) return 0n;
    const off = byteOff + col.offset;
    if (col.kind === 'K') return dv.getBigInt64(off, false);
    if (col.kind === 'J') return BigInt(dv.getInt32(off, false));
    return 0n;
}

function depositVoxel(volCounts, cx, cy, cz) {
    const BOX = 2400.0;
    const scale = 64.0 / (2.0 * BOX);
    const gx = Math.floor((cx + BOX) * scale);
    const gy = Math.floor((cy + BOX) * scale);
    const gz = Math.floor((cz + BOX) * scale);
    if (gx >= 0 && gx < 64 && gy >= 0 && gy < 64 && gz >= 0 && gz < 64) {
        volCounts[(gz * 64 + gy) * 64 + gx]++;
    }
}

function assignVoidScoresFromVolume(tbl, volCounts) {
    const nChunks = tbl.chunkCount;
    const BOX = 2400.0;
    const scale = 64.0 / (2.0 * BOX);
    // Estimate mean non-empty voxel count for scale-invariant normalization
    let sumOccupied = 0, occCells = 0;
    for (let i = 0; i < volCounts.length; i++) {
        if (volCounts[i] > 0) { sumOccupied += volCounts[i]; occCells++; }
    }
    const meanDens = occCells > 0 ? (sumOccupied / occCells) : 1.0;

    for (let ci = 0; ci < nChunks; ci++) {
        const rc = tbl.chunkRowCount(ci);
        const cx = tbl.chunkColumnView(ci, 'cx');
        const cy = tbl.chunkColumnView(ci, 'cy');
        const cz = tbl.chunkColumnView(ci, 'cz');
        const vs = tbl.chunkColumnView(ci, 'void_score');
        for (let r = 0; r < rc; r++) {
            const gx = Math.floor((cx[r] + BOX) * scale);
            const gy = Math.floor((cy[r] + BOX) * scale);
            const gz = Math.floor((cz[r] + BOX) * scale);
            if (gx >= 0 && gx < 64 && gy >= 0 && gy < 64 && gz >= 0 && gz < 64) {
                const cnt = volCounts[(gz * 64 + gy) * 64 + gx];
                const rel = cnt / Math.max(1.0, meanDens);
                vs[r] = Math.max(0.02, Math.min(0.98, Math.exp(-0.75 * rel)));
            } else {
                vs[r] = 0.55;
            }
        }
    }
    tbl.notifyColumnUpdated('void_score');
}

async function runIngest() {
    const app = globalThis.__cosmicApp;
    if (app) {
        try { app.rpc?.terminate?.(); } catch (_) {}
        try { app.dataset?.snap?.close?.(); } catch (_) {}
    }
    const { url, maxRows, keepRaw } = parseCliOpts();
    const dataDir = resolveDataDir();
    const rawDir = path.join(dataDir, 'raw-desi-dr1');
    ensureDir(rawDir);

    const isLocal = !/^https?:\/\//i.test(url);
    const baseName = path.basename(url.split('?')[0]) || 'zpix-main-dark.fits';
    const rawPath = isLocal ? url : path.join(rawDir, baseName);
    let downloadedTemp = false;

    if (!isLocal) {
        const hadBefore = fs.existsSync(rawPath);
        downloadIfNeeded(url, rawPath, `DESI DR1 (${baseName})`);
        downloadedTemp = !hadBefore;
    }

    const outFile = resolveDataFile('desi-dr1.brotable');
    const tbl = bro.table.create(COSMO_SCHEMA);
    const flusher = new TypedBatchFlusher(tbl, 65536, COL_SPEC);
    const arr = flusher.arrays;
    const volCounts = new Uint32Array(64 * 64 * 64);

    let kept = 0;
    let scanned = 0;
    const tStart = Date.now();
    const deg2rad = Math.PI / 180.0;

    if (/\.csv(\.gz)?$|\.tsv(\.gz)?$/i.test(rawPath)) {
        let colMap = null;
        await streamTextLines(rawPath, (line, idx) => {
            if (kept >= maxRows) return;
            const sep = line.includes('\t') ? '\t' : ',';
            const parts = line.split(sep);
            if (idx === 0) {
                colMap = {};
                for (let c = 0; c < parts.length; c++) colMap[parts[c].trim().toUpperCase()] = c;
                return;
            }
            if (!colMap) return;
            scanned++;
            const zWarn = +(parts[colMap.ZWARN] ?? 0);
            const z = +(parts[colMap.Z] ?? NaN);
            const ra = +(parts[colMap.TARGET_RA] ?? NaN);
            const dec = +(parts[colMap.TARGET_DEC] ?? NaN);
            if (zWarn !== 0 || !(z > 0.005 && z < 4.5) || !Number.isFinite(ra) || !Number.isFinite(dec)) return;

            const fg = +(parts[colMap.FLUX_G] ?? 1.0);
            const fr = +(parts[colMap.FLUX_R] ?? 1.0);
            const fz = +(parts[colMap.FLUX_Z] ?? 1.0);
            const g_r = (fg > 0.01 && fr > 0.01) ? Math.max(-1.0, Math.min(3.0, -2.5 * Math.log10(fg / fr))) : 0.7;
            const r_z = (fr > 0.01 && fz > 0.01) ? Math.max(-1.0, Math.min(3.0, -2.5 * Math.log10(fr / fz))) : 0.5;
            const flux_r = fr > 0.01 ? Math.max(-2.0, Math.min(4.0, Math.log10(fr))) : -1.5;

            const specStr = (parts[colMap.SPECTYPE] || 'GALAXY').trim().toUpperCase();
            const rawCode = specStr.charCodeAt(0) || 71;
            const dTgt = colMap.DESI_TARGET != null ? BigInt(parseInt(parts[colMap.DESI_TARGET], 10) || 0) : 0n;
            const st = classifyDesiSpectype(rawCode, dTgt, g_r, r_z, z);

            const chi = comovingDistanceMpcH(z);
            const raR = ra * deg2rad, decR = dec * deg2rad;
            const cosD = Math.cos(decR);
            const cx = chi * cosD * Math.cos(raR);
            const cy = chi * cosD * Math.sin(raR);
            const cz = chi * Math.sin(decR);

            const k = flusher.len;
            arr.ord[k] = kept++;
            arr.cx[k] = cx; arr.cy[k] = cy; arr.cz[k] = cz;
            arr.z[k] = z; arr.lookback_gyr[k] = lookbackGyr(z);
            arr.g_r[k] = g_r; arr.r_z[k] = r_z; arr.flux_r[k] = flux_r;
            arr.spectype[k] = st; arr.void_score[k] = 0.3;
            flusher.len++;
            depositVoxel(volCounts, cx, cy, cz);
            if (flusher.len >= flusher.batchSize) flusher.flush();
        });
    } else {
        const fd = fs.openSync(rawPath, 'r');
        try {
            const hdr = parseFitsBinTableHeader(fd);
            const { dataOffset, rowBytes, numRows, cols } = hdr;
            const cRa = cols.TARGET_RA;
            const cDec = cols.TARGET_DEC;
            const cZ = cols.Z;
            const cZwarn = cols.ZWARN;
            const cSpec = cols.SPECTYPE;
            const cFg = cols.FLUX_G;
            const cFr = cols.FLUX_R;
            const cFz = cols.FLUX_Z;
            const cTarget = cols.DESI_TARGET;

            if (!cRa || !cDec || !cZ || !cZwarn || !cSpec) {
                throw new Error('Missing required DESI FITS columns (TARGET_RA, TARGET_DEC, Z, ZWARN, SPECTYPE)');
            }

            const CHUNK_ROWS = Math.min(262144, Math.max(4096, Math.floor((176 * 1024 * 1024) / Math.max(1, rowBytes))));
            const rawBuf = new Uint8Array(CHUNK_ROWS * rowBytes);
            const dv = new DataView(rawBuf.buffer, rawBuf.byteOffset, rawBuf.byteLength);

            let filePos = dataOffset;
            let rowIdx = 0;
            console.log(`[ingest] streaming FITS BINTABLE: ${fmtInt(numRows)} rows (${rowBytes} B/row, chunk=${fmtInt(CHUNK_ROWS)})`);

            while (rowIdx < numRows && kept < maxRows) {
                const wantRows = Math.min(CHUNK_ROWS, numRows - rowIdx);
                const wantBytes = wantRows * rowBytes;
                const nRead = fs.readSync(fd, rawBuf, 0, wantBytes, filePos);
                if (nRead < rowBytes) break;
                const gotRows = Math.floor(nRead / rowBytes);
                filePos += gotRows * rowBytes;
                rowIdx += gotRows;

                for (let r = 0; r < gotRows && kept < maxRows; r++) {
                    scanned++;
                    const rowOff = r * rowBytes;
                    if (!isFitsZeroInt(dv, rowOff, cZwarn)) continue;

                    const z = readFitsNum(dv, rowOff, cZ);
                    if (!(z > 0.005 && z < 4.5)) continue;

                    const ra = readFitsNum(dv, rowOff, cRa);
                    const dec = readFitsNum(dv, rowOff, cDec);
                    if (!Number.isFinite(ra) || !Number.isFinite(dec)) continue;

                    const fg = cFg ? readFitsNum(dv, rowOff, cFg) : 1.0;
                    const fr = cFr ? readFitsNum(dv, rowOff, cFr) : 1.0;
                    const fz = cFz ? readFitsNum(dv, rowOff, cFz) : 1.0;
                    const g_r = (fg > 0.01 && fr > 0.01) ? Math.max(-1.0, Math.min(3.0, -2.5 * Math.log10(fg / fr))) : 0.7;
                    const r_z = (fr > 0.01 && fz > 0.01) ? Math.max(-1.0, Math.min(3.0, -2.5 * Math.log10(fr / fz))) : 0.5;
                    const flux_r = fr > 0.01 ? Math.max(-2.0, Math.min(4.0, Math.log10(fr))) : -1.5;

                    const rawCode = rawBuf[rowOff + cSpec.offset];
                    const dTgt = readFitsBigInt(dv, rowOff, cTarget);
                    const st = classifyDesiSpectype(rawCode, dTgt, g_r, r_z, z);

                    const chi = comovingDistanceMpcH(z);
                    const raR = ra * deg2rad, decR = dec * deg2rad;
                    const cosD = Math.cos(decR);
                    const cx = chi * cosD * Math.cos(raR);
                    const cy = chi * cosD * Math.sin(raR);
                    const cz = chi * Math.sin(decR);

                    const k = flusher.len;
                    arr.ord[k] = kept++;
                    arr.cx[k] = cx; arr.cy[k] = cy; arr.cz[k] = cz;
                    arr.z[k] = z; arr.lookback_gyr[k] = lookbackGyr(z);
                    arr.g_r[k] = g_r; arr.r_z[k] = r_z; arr.flux_r[k] = flux_r;
                    arr.spectype[k] = st; arr.void_score[k] = 0.3;
                    flusher.len++;
                    depositVoxel(volCounts, cx, cy, cz);
                    if (flusher.len >= flusher.batchSize) flusher.flush();
                }

                if ((rowIdx % (CHUNK_ROWS * 4)) === 0 || rowIdx >= numRows) {
                    console.log(`[ingest] scanned ${fmtInt(rowIdx)}/${fmtInt(numRows)} -> kept ${fmtInt(kept)} clean spectra`);
                }
            }
        } finally {
            fs.closeSync(fd);
        }
    }

    flusher.flush();
    console.log(`[ingest] computing 64^3 void contrast scores for ${fmtInt(tbl.rowCount)} objects...`);
    assignVoidScoresFromVolume(tbl, volCounts);

    console.log('[ingest] building RangeIndex(z) and SpatialIndex(cosmo3d)...');
    tbl.createRangeIndex('z');
    tbl.createSpatialIndex('cosmo3d', ['cx', 'cy', 'cz'], 60.0);

    console.log(`[ingest] saving ${fmtInt(tbl.rowCount)} rows to ${outFile}...`);
    tbl.save(outFile);

    if (downloadedTemp && !keepRaw && fs.existsSync(rawPath)) {
        try {
            fs.unlinkSync(rawPath);
            console.log(`[ingest] removed temporary raw FITS file ${rawPath}`);
        } catch (err) {
            console.warn('[ingest] failed to remove temporary FITS:', err && err.message ? err.message : err);
        }
    }

    const st = tbl.stats();
    const sec = ((Date.now() - tStart) / 1000).toFixed(1);
    console.log(`[ingest] done in ${sec}s: ${st.rowCount} rows (scanned ${scanned}), ${(st.totalBytes / 1e6).toFixed(1)} MB off-heap, file=${outFile}`);
}

await runIngest();
