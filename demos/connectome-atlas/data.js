// Connectome dataset loader (zero-copy .brotable mmap when ingested, else realistic
// 120,000-neuron / 800,000-edge Drosophila brain generator with biological tracts).

import { hasRealDataFile, resolveDataFile } from "/lib/sci-atlas/data-paths.js";
import { TypedBatchFlusher } from "/lib/sci-atlas/ingest-common.js";

export const NEURON_SCHEMA = {
    ord: 'u32',
    x: 'f32',
    y: 'f32',
    z: 'f32',
    flow_id: 'i32',
    nt_id: 'i32',
    out_syn: 'i32',
    in_syn: 'i32',
    root_id: 'i64',
    region: 'dict',
    cell_type: 'string',
};

export const EDGE_SCHEMA = {
    pre_idx: 'u32',
    post_idx: 'u32',
    syn_count: 'i32',
    nt_id: 'i32',
    polarity: 'f32',
};

export const NT_NAMES = ['ACH', 'GABA', 'GLUT', 'DA', 'SER', 'OCT'];
export const NT_FULL = [
    'ACh (Excitatory)',
    'GABA (Inhibitory)',
    'Glutamate (Inhib.)',
    'Dopamine (Mod.)',
    'Serotonin (Mod.)',
    'Octopamine (Mod.)',
];
export const NT_HEX = ['#29d8ff', '#ff2f8a', '#ffb426', '#ffe13a', '#bc58ff', '#2fe69b'];
export const NT_POLARITY = [1.0, -1.0, -1.0, 1.0, 1.0, 1.0];
export const FLOW_NAMES = ['sensory', 'intrinsic', 'motor', 'ascending'];
export const REGIONS = ['OL_L', 'OL_R', 'CX', 'MB_L', 'MB_R', 'AL_L', 'AL_R', 'SEZ', 'MOTOR'];

export const STIM_SITES = {
    ol: { label: 'Optic Lobe (OL_L)', pt: [-0.90, 0.04, 0.04] },
    or: { label: 'Optic Lobe (OL_R)', pt: [0.90, 0.04, 0.04] },
    al: { label: 'Antennal Lobe (AL_L)', pt: [-0.21, -0.09, 0.28] },
    cx: { label: 'Central Complex (CX)', pt: [0.00, 0.18, -0.02] },
};

export function parseFlowId(val) {
    if (!val) return 1;
    const s = String(val).trim().toLowerCase();
    if (s.includes('sensory') || s.includes('afferent')) return 0;
    if (s.includes('motor') || s.includes('descending') || s.includes('efferent')) return 2;
    if (s.includes('ascending')) return 3;
    return 1;
}

export function parseNtId(val) {
    if (!val) return 0;
    const s = String(val).trim().toUpperCase();
    if (s === 'ACH' || s.startsWith('ACETYL')) return 0;
    if (s === 'GABA') return 1;
    if (s === 'GLUT' || s.startsWith('GLUTAM')) return 2;
    if (s === 'DA' || s.startsWith('DOPAM')) return 3;
    if (s === 'SER' || s === '5-HT' || s.startsWith('SEROT')) return 4;
    if (s === 'OCT' || s.startsWith('OCTOP')) return 5;
    return 0;
}

export function deriveRegionTag(superClass, side, rawRegion) {
    if (rawRegion && rawRegion !== 'NA' && rawRegion !== 'nan') return rawRegion;
    const sc = (superClass || '').trim().toLowerCase();
    const sd = (side || '').trim().toLowerCase();
    const suf = sd.startsWith('l') ? '_L' : (sd.startsWith('r') ? '_R' : '');
    if (sc.includes('optic') || sc.includes('visual')) return 'OL' + (suf || '_L');
    if (sc.includes('central')) return 'CX';
    if (sc.includes('motor') || sc.includes('descending')) return 'MOTOR';
    if (sc.includes('sensory')) return 'AL' + (suf || '_L');
    if (sc.includes('ascending')) return 'SEZ';
    return suf ? ('MB' + suf) : null;
}

// Fast deterministic PRNG (Mulberry32)
function makeRng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function pickWeighted(rng, weights) {
    let r = rng();
    for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r <= 0) return i;
    }
    return weights.length - 1;
}

const REGION_SPECS = [
    {
        name: 'OL_L', count: 28000, side: -1,
        ntW: [0.58, 0.21, 0.14, 0.03, 0.02, 0.02],
        flowW: [0.36, 0.60, 0.02, 0.02],
        types: ['Mi1', 'T4a', 'L1', 'Tm3', 'Lawf1', 'LC10', 'Dm8', 'C2'],
        targets: ['OL_L', 'CX', 'MB_L', 'MOTOR'],
        targetW: [0.55, 0.16, 0.14, 0.15],
    },
    {
        name: 'OL_R', count: 28000, side: 1,
        ntW: [0.58, 0.21, 0.14, 0.03, 0.02, 0.02],
        flowW: [0.36, 0.60, 0.02, 0.02],
        types: ['Mi1', 'T4a', 'L1', 'Tm3', 'Lawf1', 'LC10', 'Dm8', 'C2'],
        targets: ['OL_R', 'CX', 'MB_R', 'MOTOR'],
        targetW: [0.55, 0.16, 0.14, 0.15],
    },
    {
        name: 'MB_L', count: 8500, side: -1,
        ntW: [0.64, 0.12, 0.08, 0.12, 0.02, 0.02],
        flowW: [0.05, 0.85, 0.06, 0.04],
        types: ['KCg', 'KCab', 'KCabp', 'PAM01', 'PPL101', 'MBON01', 'APL'],
        targets: ['MB_L', 'CX', 'MOTOR', 'AL_L'],
        targetW: [0.46, 0.30, 0.16, 0.08],
    },
    {
        name: 'MB_R', count: 8500, side: 1,
        ntW: [0.64, 0.12, 0.08, 0.12, 0.02, 0.02],
        flowW: [0.05, 0.85, 0.06, 0.04],
        types: ['KCg', 'KCab', 'KCabp', 'PAM01', 'PPL101', 'MBON01', 'APL'],
        targets: ['MB_R', 'CX', 'MOTOR', 'AL_R'],
        targetW: [0.46, 0.30, 0.16, 0.08],
    },
    {
        name: 'CX', count: 6000, side: 0,
        ntW: [0.44, 0.24, 0.14, 0.08, 0.06, 0.04],
        flowW: [0.04, 0.72, 0.18, 0.06],
        types: ['EPG_compass', 'PFN_d', 'hDeltaB', 'Delta7', 'ExR1', 'PFL3', 'FB4K'],
        targets: ['CX', 'MOTOR', 'SEZ', 'MB_L', 'MB_R'],
        targetW: [0.40, 0.32, 0.12, 0.08, 0.08],
    },
    {
        name: 'AL_L', count: 4500, side: -1,
        ntW: [0.56, 0.24, 0.10, 0.04, 0.03, 0.03],
        flowW: [0.48, 0.48, 0.02, 0.02],
        types: ['ORN_DM1', 'ORN_VA2', 'PN_lAL', 'LN_GABA', 'LN_GLUT'],
        targets: ['AL_L', 'MB_L', 'CX', 'SEZ'],
        targetW: [0.36, 0.38, 0.18, 0.08],
    },
    {
        name: 'AL_R', count: 4500, side: 1,
        ntW: [0.56, 0.24, 0.10, 0.04, 0.03, 0.03],
        flowW: [0.48, 0.48, 0.02, 0.02],
        types: ['ORN_DM1', 'ORN_VA2', 'PN_lAL', 'LN_GABA', 'LN_GLUT'],
        targets: ['AL_R', 'MB_R', 'CX', 'SEZ'],
        targetW: [0.36, 0.38, 0.18, 0.08],
    },
    {
        name: 'SEZ', count: 14000, side: 0,
        ntW: [0.46, 0.22, 0.20, 0.04, 0.04, 0.04],
        flowW: [0.32, 0.42, 0.20, 0.06],
        types: ['GRN_sugar', 'GRN_bitter', 'SEZ_IN', 'MN_proboscis', 'Fdg_neuron'],
        targets: ['SEZ', 'AL_L', 'AL_R', 'MOTOR', 'CX'],
        targetW: [0.42, 0.14, 0.14, 0.20, 0.10],
    },
    {
        name: 'MOTOR', count: 18000, side: 0,
        ntW: [0.48, 0.18, 0.22, 0.05, 0.03, 0.04],
        flowW: [0.05, 0.25, 0.50, 0.20],
        types: ['DNa02_motor', 'DNp01_giant', 'AN_VNC', 'LAL_out', 'DNa01'],
        targets: ['MOTOR', 'CX', 'SEZ', 'OL_L', 'OL_R'],
        targetW: [0.44, 0.24, 0.14, 0.09, 0.09],
    },
];

function sampleRegionCoord(spec, rng) {
    const g = () => (rng() + rng() + rng()) / 3.0 - 0.5;
    const nm = spec.name;
    if (nm === 'OL_L' || nm === 'OL_R') {
        const s = spec.side;
        const theta = (rng() - 0.5) * 2.25;
        const layer = rng(); // 0=lamina(outer), 1=lobula/optic stalk(inner)
        const x = s * (0.96 - layer * 0.34 + (Math.cos(theta) - 0.5) * 0.18 + g() * 0.10);
        const y = Math.sin(theta) * 0.58 * (1.0 - layer * 0.18) + g() * 0.14;
        const z = (Math.cos(theta) - 0.55) * 0.30 + (rng() - 0.5) * 0.28;
        return [x, y, z];
    }
    if (nm === 'MB_L' || nm === 'MB_R') {
        const s = spec.side;
        const t = rng();
        if (t < 0.42) {
            return [s * (0.38 + g() * 0.20), 0.34 + g() * 0.18, -0.20 + g() * 0.18];
        }
        const u = rng();
        const branch = rng() < 0.5 ? 1 : 0;
        const x = s * (0.36 - u * 0.18 + (branch ? 0.03 : -0.09) + g() * 0.10);
        const y = 0.30 - u * 0.10 + branch * u * 0.16 + g() * 0.10;
        const z = -0.18 + u * 0.40 + g() * 0.10;
        return [x, y, z];
    }
    if (nm === 'CX') {
        const sub = rng();
        if (sub < 0.42) {
            const a = rng() * Math.PI * 2;
            const rr = 0.14 + g() * 0.05;
            return [Math.cos(a) * rr, 0.14 + Math.sin(a) * rr * 0.85, 0.02 + g() * 0.06];
        }
        if (sub < 0.80) {
            const a = (rng() - 0.5) * 2.1;
            return [Math.sin(a) * 0.24 + g() * 0.06, 0.22 + Math.cos(a) * 0.09 + g() * 0.06, -0.10 + g() * 0.08];
        }
        return [(rng() - 0.5) * 0.48, 0.36 + g() * 0.06, -0.20 + g() * 0.06];
    }
    if (nm === 'AL_L' || nm === 'AL_R') {
        const s = spec.side;
        const a = rng() * Math.PI * 2;
        const b = Math.acos(2 * rng() - 1);
        const rr = 0.16 * Math.cbrt(rng());
        return [
            s * 0.22 + rr * Math.sin(b) * Math.cos(a),
            -0.10 + rr * Math.cos(b),
            0.26 + rr * Math.sin(b) * Math.sin(a),
        ];
    }
    if (nm === 'SEZ') {
        const x = (rng() - 0.5) * 0.72 + g() * 0.16;
        const y = -0.44 + g() * 0.26;
        const z = 0.08 + g() * 0.26;
        return [x, y, z];
    }
    // MOTOR / Central Protocerebral Mass + Lateral Horn + Descending Tracts
    const subM = rng();
    if (subM < 0.45) {
        // Superior/lateral protocerebrum bridging Optic Lobes to Central Brain
        const sidePick = rng() < 0.5 ? -1 : 1;
        return [sidePick * (0.22 + rng() * 0.44) + g() * 0.14, 0.10 + g() * 0.44, -0.06 + g() * 0.34];
    }
    const sidePick = rng() < 0.5 ? -1 : 1;
    const x = sidePick * (0.12 + rng() * 0.36) + g() * 0.14;
    const y = -0.16 + g() * 0.44;
    const z = -0.28 + g() * 0.28;
    return [x, y, z];
}

export function generateSample() {
    const t0 = Date.now();
    const N = 120000;
    const rng = makeRng(0xF17E2026);

    const ord = new Uint32Array(N);
    const x = new Float32Array(N);
    const y = new Float32Array(N);
    const z = new Float32Array(N);
    const flowId = new Int32Array(N);
    const ntId = new Int32Array(N);
    const outSyn = new Int32Array(N);
    const inSyn = new Int32Array(N);
    const rootId = new BigInt64Array(N);
    const region = new Array(N);
    const cellType = new Array(N);

    const regionRanges = new Map();
    let cursor = 0;
    for (const spec of REGION_SPECS) {
        const start = cursor;
        for (let k = 0; k < spec.count; k++) {
            const idx = cursor++;
            ord[idx] = idx;
            const [px, py, pz] = sampleRegionCoord(spec, rng);
            x[idx] = Math.max(-1.38, Math.min(1.38, px));
            y[idx] = Math.max(-1.38, Math.min(1.38, py));
            z[idx] = Math.max(-1.38, Math.min(1.38, pz));
            flowId[idx] = pickWeighted(rng, spec.flowW);
            ntId[idx] = pickWeighted(rng, spec.ntW);
            rootId[idx] = 720575940600000000n + BigInt(idx);
            // ~1.5% nullable Dict & String proof rows
            const isNullCell = (idx % 67 === 11);
            region[idx] = isNullCell ? null : spec.name;
            cellType[idx] = (idx % 79 === 13) ? null : spec.types[idx % spec.types.length];
        }
        regionRanges.set(spec.name, { start, len: spec.count, spec });
    }

    // Wire 800,000 directed biological edges using pure numeric TypedBatchFlusher (46 M/s fast path)
    const edges = bro.table.create(EDGE_SCHEMA);
    const BATCH = 65536;
    const flusher = new TypedBatchFlusher(edges, BATCH, [
        { name: 'pre_idx', kind: 'u32' },
        { name: 'post_idx', kind: 'u32' },
        { name: 'syn_count', kind: 'i32' },
        { name: 'nt_id', kind: 'i32' },
        { name: 'polarity', kind: 'f32' },
    ]);

    const pushEdge = (pre, post, syn) => {
        const nt = ntId[pre];
        const pol = NT_POLARITY[nt];
        outSyn[pre] += syn;
        inSyn[post] += syn;
        const p = flusher.len;
        flusher.arrays.pre_idx[p] = pre;
        flusher.arrays.post_idx[p] = post;
        flusher.arrays.syn_count[p] = syn;
        flusher.arrays.nt_id[p] = nt;
        flusher.arrays.polarity[p] = pol;
        flusher.len = p + 1;
        if (flusher.len === BATCH) flusher.flush();
    };

    const pickTargetIn = (rName) => {
        const info = regionRanges.get(rName);
        return info.start + ((rng() * info.len) | 0);
    };

    // Pass 1: 4 baseline outgoing edges per neuron = 480,000 edges
    // Pass 2: 20 extra hub edges for every 7th/hub neuron (~16,000 * 20 = 320,000 edges) => 800,000 edges
    let specCursor = 0;
    let specEnd = REGION_SPECS[0].count;
    for (let i = 0; i < N; i++) {
        while (i >= specEnd && specCursor + 1 < REGION_SPECS.length) {
            specCursor++;
            specEnd += REGION_SPECS[specCursor].count;
        }
        const spec = REGION_SPECS[specCursor];
        const isHub = (i % 15 < 2); // ~13.3% hub neurons -> 16,000 hubs
        const deg = isHub ? 24 : 4;
        for (let e = 0; e < deg; e++) {
            const tgtRegion = spec.targets[pickWeighted(rng, spec.targetW)];
            let post = pickTargetIn(tgtRegion);
            if (post === i) post = (i + 1) % N;
            const baseSyn = isHub ? (6 + ((rng() * 38) | 0)) : (2 + ((rng() * 14) | 0));
            pushEdge(i, post, baseSyn);
        }
    }
    flusher.flush();

    edges.createIndex('pre_idx');
    edges.createRangeIndex('syn_count');

    const neurons = bro.table.create(NEURON_SCHEMA);
    const NBATCH = 16384;
    for (let off = 0; off < N; off += NBATCH) {
        const end = Math.min(N, off + NBATCH);
        neurons.insertMany({
            ord: ord.subarray(off, end),
            x: x.subarray(off, end),
            y: y.subarray(off, end),
            z: z.subarray(off, end),
            flow_id: flowId.subarray(off, end),
            nt_id: ntId.subarray(off, end),
            out_syn: outSyn.subarray(off, end),
            in_syn: inSyn.subarray(off, end),
            root_id: rootId.subarray(off, end),
            region: region.slice(off, end),
            cell_type: cellType.slice(off, end),
        });
    }
    neurons.createIndex('ord');
    neurons.createRangeIndex('out_syn');
    neurons.createSpatialIndex('brain3d', ['x', 'y', 'z'], 0.08);

    const loadMs = Date.now() - t0;
    return {
        isReal: false,
        neuronsTable: neurons,
        edgesTable: edges,
        neuronsSnap: neurons.snapshot(),
        edgesSnap: edges.snapshot(),
        loadMs,
    };
}

export function loadConnectomeData() {
    const t0 = Date.now();
    if (hasRealDataFile('flywire-neurons.brotable') && hasRealDataFile('flywire-edges.brotable')) {
        const neuronsSnap = bro.table.mmap(resolveDataFile('flywire-neurons.brotable'));
        const edgesSnap = bro.table.mmap(resolveDataFile('flywire-edges.brotable'));
        return {
            isReal: true,
            neuronsTable: null,
            edgesTable: null,
            neuronsSnap,
            edgesSnap,
            loadMs: Date.now() - t0,
        };
    }
    return generateSample();
}
