// Pure-JS FlyWire FAFB connectome ingestion script for bro-headless (NO Python).
// Run: ../bro/build/Release/bro-headless.exe --grant files,spawn demos/connectome-atlas demos/connectome-atlas/ingest.js

import { resolveDataDir, resolveDataFile, ensureDir, fmtInt, fmtMs } from "/lib/sci-atlas/data-paths.js";
import { downloadIfNeeded, streamTextLines, TypedBatchFlusher } from "/lib/sci-atlas/ingest-common.js";
import {
    NEURON_SCHEMA,
    EDGE_SCHEMA,
    NT_POLARITY,
    parseFlowId,
    parseNtId,
    deriveRegionTag,
} from "./data.js";

const TSV_URL = 'https://raw.githubusercontent.com/flyconnectome/flywire_annotations/main/supplemental_files/Supplemental_file1_neuron_annotations.tsv';
const CONN_URL = 'https://zenodo.org/api/records/23427197/files/fafb_connections.csv.gz/content';

function cleanToken(s) {
    if (!s) return '';
    let t = s.trim();
    if (t.length >= 2 && t.charCodeAt(0) === 34 && t.charCodeAt(t.length - 1) === 34) {
        t = t.slice(1, -1).trim();
    }
    return t;
}

function cleanRootKey(s) {
    const t = cleanToken(s);
    if (!t || t === 'NA' || t === 'nan') return '';
    const dot = t.indexOf('.');
    return dot >= 0 ? t.slice(0, dot) : t;
}

function parseFiniteNum(s) {
    const t = cleanToken(s);
    if (!t || t === 'NA' || t === 'NaN' || t === 'nan' || t === 'null') return NaN;
    const v = Number(t);
    return Number.isFinite(v) ? v : NaN;
}

function findCol(headers, names) {
    for (const n of names) {
        const idx = headers.indexOf(n);
        if (idx >= 0) return idx;
    }
    return -1;
}

async function runIngest() {
    const tStart = Date.now();
    // If booted alongside the app and .brotable files are currently mmap'd, release handles
    // before overwriting so Windows atomic file replacement succeeds cleanly.
    const app = globalThis.__connectomeAtlas;
    if (app) {
        try { app.tableWorker?.terminate?.(); } catch (_) {}
        try { app.neuronsSnap?.close?.(); } catch (_) {}
        try { app.edgesSnap?.close?.(); } catch (_) {}
    }
    const dataDir = resolveDataDir();
    const rawDir = dataDir + '/raw/flywire';
    ensureDir(dataDir);
    ensureDir(rawDir);

    const tsvPath = downloadIfNeeded(TSV_URL, rawDir + '/Supplemental_file1_neuron_annotations.tsv', 'FlyWire annotations TSV');
    const connPath = downloadIfNeeded(CONN_URL, rawDir + '/fafb_connections.csv.gz', 'FAFB connections CSV.gz');

    // 1. Stream neuron annotations TSV
    console.log('[ingest] streaming neuron annotations TSV...');
    const rawX = [];
    const rawY = [];
    const rawZ = [];
    const rawFlow = [];
    const rawNt = [];
    const rawRoot = [];
    const rawRegion = [];
    const rawCellType = [];
    const rootToOrd = new Map();

    let colIdx = null;
    let skipped = 0;
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    await streamTextLines(tsvPath, (line, lineNo) => {
        const parts = line.split('\t');
        if (lineNo === 0) {
            const hdr = parts.map((h) => cleanToken(h).toLowerCase());
            colIdx = {
                root: findCol(hdr, ['root_id']),
                px: findCol(hdr, ['pos_x', 'soma_x', 'x']),
                py: findCol(hdr, ['pos_y', 'soma_y', 'y']),
                pz: findCol(hdr, ['pos_z', 'soma_z', 'z']),
                flow: findCol(hdr, ['flow']),
                superClass: findCol(hdr, ['super_class']),
                nt: findCol(hdr, ['top_nt', 'nt_type', 'nt']),
                cellType: findCol(hdr, ['cell_type', 'hemibrain_type', 'class']),
                side: findCol(hdr, ['side']),
                region: findCol(hdr, ['region', 'neuropil']),
            };
            if (colIdx.root < 0 || colIdx.px < 0 || colIdx.py < 0 || colIdx.pz < 0) {
                throw new Error('Missing required columns in annotations TSV header: ' + hdr.join(','));
            }
            return;
        }

        const rootStr = cleanRootKey(parts[colIdx.root]);
        if (!rootStr) { skipped++; return; }
        const px = parseFiniteNum(parts[colIdx.px]);
        const py = parseFiniteNum(parts[colIdx.py]);
        const pz = parseFiniteNum(parts[colIdx.pz]);
        if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) {
            skipped++;
            return;
        }
        if (rootToOrd.has(rootStr)) return;

        let rootBig;
        try { rootBig = BigInt(rootStr); } catch (_) { skipped++; return; }

        const ord = rawX.length;
        rootToOrd.set(rootStr, ord);
        rawX.push(px);
        rawY.push(py);
        rawZ.push(pz);
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
        if (pz < minZ) minZ = pz;
        if (pz > maxZ) maxZ = pz;

        const flowStr = colIdx.flow >= 0 ? cleanToken(parts[colIdx.flow]) : '';
        const scStr = colIdx.superClass >= 0 ? cleanToken(parts[colIdx.superClass]) : '';
        rawFlow.push(parseFlowId(flowStr || scStr));

        const ntStr = colIdx.nt >= 0 ? cleanToken(parts[colIdx.nt]) : '';
        rawNt.push(parseNtId(ntStr));

        rawRoot.push(rootBig);

        const sideStr = colIdx.side >= 0 ? cleanToken(parts[colIdx.side]) : '';
        const regStr = colIdx.region >= 0 ? cleanToken(parts[colIdx.region]) : '';
        rawRegion.push(deriveRegionTag(scStr, sideStr, regStr));

        const ctStr = colIdx.cellType >= 0 ? cleanToken(parts[colIdx.cellType]) : '';
        rawCellType.push((!ctStr || ctStr === 'NA' || ctStr === 'nan') ? null : ctStr);
    });

    const N = rawX.length;
    console.log(`[ingest] parsed ${fmtInt(N)} valid neurons (skipped ${fmtInt(skipped)} missing/NaN coords)`);
    if (N === 0) throw new Error('No valid neurons parsed from TSV');

    // Normalize coordinates cleanly into [-1.3, +1.3]
    const cx = 0.5 * (minX + maxX);
    const cy = 0.5 * (minY + maxY);
    const cz = 0.5 * (minZ + maxZ);
    const span = Math.max(1e-6, maxX - minX, maxY - minY, maxZ - minZ);
    const scale = 2.6 / span;

    const ordArr = new Uint32Array(N);
    const xArr = new Float32Array(N);
    const yArr = new Float32Array(N);
    const zArr = new Float32Array(N);
    const flowArr = new Int32Array(N);
    const ntArr = new Int32Array(N);
    const outSyn = new Int32Array(N);
    const inSyn = new Int32Array(N);
    const rootArr = new BigInt64Array(N);

    for (let i = 0; i < N; i++) {
        ordArr[i] = i;
        xArr[i] = (rawX[i] - cx) * scale;
        yArr[i] = -(rawY[i] - cy) * scale; // flip FAFB dorsal-ventral so dorsal is +Y
        zArr[i] = (rawZ[i] - cz) * scale;
        flowArr[i] = rawFlow[i];
        ntArr[i] = rawNt[i];
        rootArr[i] = rawRoot[i];
    }

    // 2. Stream fafb_connections.csv.gz -> flywire-edges.brotable + accumulate in_syn/out_syn
    console.log('[ingest] streaming fafb_connections.csv.gz (directed edges)...');
    const edgesTbl = bro.table.create(EDGE_SCHEMA);
    const BATCH = 65536;
    const flusher = new TypedBatchFlusher(edgesTbl, BATCH, [
        { name: 'pre_idx', kind: 'u32' },
        { name: 'post_idx', kind: 'u32' },
        { name: 'syn_count', kind: 'i32' },
        { name: 'nt_id', kind: 'i32' },
        { name: 'polarity', kind: 'f32' },
    ]);

    let ePreCol = 0, ePostCol = 1, eSynCol = 3, eNtCol = 4;
    let totalLines = 0;
    let keptEdges = 0;

    await streamTextLines(connPath, (line, lineNo) => {
        totalLines++;
        if (lineNo === 0) {
            const hdr = line.split(',').map((h) => cleanToken(h).toLowerCase());
            const p0 = findCol(hdr, ['pre_root_id', 'pre']);
            const p1 = findCol(hdr, ['post_root_id', 'post']);
            const p2 = findCol(hdr, ['syn_count', 'synapses', 'weight']);
            const p3 = findCol(hdr, ['nt_type', 'top_nt', 'nt']);
            if (p0 >= 0) ePreCol = p0;
            if (p1 >= 0) ePostCol = p1;
            if (p2 >= 0) eSynCol = p2;
            if (p3 >= 0) eNtCol = p3;
            return;
        }

        // Fast indexOf split without array allocation overhead on 15M+ lines
        let col = 0;
        let start = 0;
        let preStr = '', postStr = '', synStr = '', ntStr = '';
        const len = line.length;
        while (start <= len) {
            let comma = line.indexOf(',', start);
            if (comma < 0) comma = len;
            if (col === ePreCol) preStr = cleanRootKey(line.slice(start, comma));
            else if (col === ePostCol) postStr = cleanRootKey(line.slice(start, comma));
            else if (col === eSynCol) synStr = cleanToken(line.slice(start, comma));
            else if (col === eNtCol) ntStr = cleanToken(line.slice(start, comma));
            if (comma === len) break;
            start = comma + 1;
            col++;
        }

        const preOrd = rootToOrd.get(preStr);
        if (preOrd === undefined) return;
        const postOrd = rootToOrd.get(postStr);
        if (postOrd === undefined) return;
        const syn = parseInt(synStr, 10) | 0;
        if (syn <= 0) return;

        const ntId = ntStr ? parseNtId(ntStr) : ntArr[preOrd];
        const pol = NT_POLARITY[ntId];
        outSyn[preOrd] += syn;
        inSyn[postOrd] += syn;

        const p = flusher.len;
        flusher.arrays.pre_idx[p] = preOrd;
        flusher.arrays.post_idx[p] = postOrd;
        flusher.arrays.syn_count[p] = syn;
        flusher.arrays.nt_id[p] = ntId;
        flusher.arrays.polarity[p] = pol;
        flusher.len = p + 1;
        if (flusher.len === BATCH) flusher.flush();
        keptEdges++;

        if ((keptEdges % 2000000) === 0) {
            console.log(`[ingest] edges streamed: ${fmtInt(keptEdges)} (lines: ${fmtInt(totalLines)})`);
        }
    });
    flusher.flush();

    console.log(`[ingest] indexing ${fmtInt(edgesTbl.rowCount)} edges (pre_idx HashIndex + syn_count RangeIndex)...`);
    edgesTbl.createIndex('pre_idx');
    edgesTbl.createRangeIndex('syn_count');
    const edgesOutPath = resolveDataFile('flywire-edges.brotable');
    edgesTbl.save(edgesOutPath);
    console.log(`[ingest] saved ${edgesOutPath}`);

    // 3. Build and save neurons table with accumulated in_syn / out_syn
    const neuronsTbl = bro.table.create(NEURON_SCHEMA);
    const NBATCH = 16384;
    for (let off = 0; off < N; off += NBATCH) {
        const end = Math.min(N, off + NBATCH);
        neuronsTbl.insertMany({
            ord: ordArr.subarray(off, end),
            x: xArr.subarray(off, end),
            y: yArr.subarray(off, end),
            z: zArr.subarray(off, end),
            flow_id: flowArr.subarray(off, end),
            nt_id: ntArr.subarray(off, end),
            out_syn: outSyn.subarray(off, end),
            in_syn: inSyn.subarray(off, end),
            root_id: rootArr.subarray(off, end),
            region: rawRegion.slice(off, end),
            cell_type: rawCellType.slice(off, end),
        });
    }
    console.log(`[ingest] indexing ${fmtInt(neuronsTbl.rowCount)} neurons (ord + out_syn + brain3d)...`);
    neuronsTbl.createIndex('ord');
    neuronsTbl.createRangeIndex('out_syn');
    neuronsTbl.createSpatialIndex('brain3d', ['x', 'y', 'z'], 0.08);
    const neuronsOutPath = resolveDataFile('flywire-neurons.brotable');
    neuronsTbl.save(neuronsOutPath);

    console.log(`[ingest] COMPLETE in ${fmtMs(Date.now() - tStart)}: ` +
        `${fmtInt(neuronsTbl.rowCount)} neurons -> ${neuronsOutPath}, ` +
        `${fmtInt(edgesTbl.rowCount)} edges -> ${edgesOutPath}`);
}

await runIngest();
