// Multi-table relational biosphere generator & schema definitions for Evolutionary Biosphere.
// Creates 131,072 organisms (32 chunks x 4,096 rows) with ~12% NULL parent_id founders,
// bitwise traits_mask flags, 32 clades, 8 ecological niches, Hash/Range/Spatial indexes,
// and helpers for Speciation Bursts and .brotable v3 timeline branch paths.

const fs = require('fs');

export const CREATURE_COUNT = 131072; // 32 * 4096 = 32 chunks
export const CLADE_COUNT = 32;
export const NICHE_COUNT = 8;

export const CREATURE_SCHEMA = {
    id: 'u32',
    clade_id: 'i32',
    niche_id: 'i32',
    lineage: 'dict',
    taxon_name: 'string',
    parent_id: 'i64',
    generation: 'i32',
    traits_mask: 'u32',
    x: 'f32',
    y: 'f32',
    z: 'f32',
    gene_a: 'f32',
    gene_b: 'f32',
    fitness: 'f32',
    mutation_rate: 'f32',
    alive: 'bool',
};

export const CLADE_SCHEMA = {
    clade_id: 'i32',
    phylum: 'dict',
    opt_a: 'f32',
    opt_b: 'f32',
    extinct: 'bool',
};

export const NICHE_SCHEMA = {
    niche_id: 'i32',
    niche_name: 'dict',
    temp_c: 'f32',
    radiation: 'f32',
};

export const TRAIT_FLAGS = [
    { bit: 1,  shift: 0, name: 'Bioluminescent', short: 'Biolum', color: '#46e2ff' },
    { bit: 2,  shift: 1, name: 'Thermophile',    short: 'Thermo', color: '#ff703d' },
    { bit: 4,  shift: 2, name: 'Armored',        short: 'Armor',  color: '#9aa8c4' },
    { bit: 8,  shift: 3, name: 'Aerial',         short: 'Aerial', color: '#9dff7a' },
    { bit: 16, shift: 4, name: 'Venomous',       short: 'Venom',  color: '#d95eff' },
    { bit: 32, shift: 5, name: 'Symbiotic',      short: 'Symbio', color: '#ffd94a' },
];

export const PHYLA = [
    { name: 'Hydrozoa',   optA: -0.95, optB: -0.55, color: '#3bc4ff' },
    { name: 'Pyroflora',  optA:  1.05, optB: -0.65, color: '#ff7142' },
    { name: 'Lithoderm',  optA: -0.82, optB:  0.88, color: '#9eb4d6' },
    { name: 'Aeropteron', optA:  0.86, optB:  0.92, color: '#8ef576' },
    { name: 'Venomorp',   optA: -0.10, optB:  1.15, color: '#d46bff' },
    { name: 'Symbiote',   optA:  0.12, optB: -1.08, color: '#ffd652' },
];

export const NICHES = [
    { id: 0, name: 'Thermal Vent',   temp_c: 92.0,  radiation: 0.42, center: [-0.76, -0.54,  0.46], biasMask: 2 | 4 },
    { id: 1, name: 'Abyssal Trench', temp_c:  2.4,  radiation: 0.18, center: [ 0.76, -0.64, -0.44], biasMask: 1 | 16 },
    { id: 2, name: 'Sunlit Canopy',  temp_c: 26.5,  radiation: 0.34, center: [-0.52,  0.76, -0.34], biasMask: 8 | 32 },
    { id: 3, name: 'Coral Shelf',    temp_c: 24.0,  radiation: 0.22, center: [ 0.74,  0.24,  0.54], biasMask: 1 | 32 },
    { id: 4, name: 'Basalt Ridge',   temp_c: 41.0,  radiation: 0.31, center: [-0.84,  0.14, -0.56], biasMask: 4 | 2 },
    { id: 5, name: 'Methane Seep',   temp_c:  8.5,  radiation: 0.48, center: [ 0.04, -0.72,  0.70], biasMask: 1 | 16 | 4 },
    { id: 6, name: 'Tidal Basin',    temp_c: 19.2,  radiation: 0.20, center: [ 0.10,  0.46,  0.76], biasMask: 32 | 1 },
    { id: 7, name: 'Stratosphere',   temp_c: -18.0, radiation: 0.72, center: [ 0.60,  0.74, -0.54], biasMask: 8 | 1 },
];

const TAXON_PREFIX = ['Astra', 'Pyro', 'Cryo', 'Litho', 'Aero', 'Veno', 'Sym', 'Nautilus', 'Helix', 'Bio'];
const TAXON_SUFFIX = ['morph', 'zoa', 'phyta', 'derm', 'pter', 'spora', 'cyst', 'clade'];

export function makeRng(seed) {
    let s = seed >>> 0;
    const rand = () => {
        s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296.0;
    };
    let spare = null;
    const gauss = () => {
        if (spare !== null) { const v = spare; spare = null; return v; }
        let u = 0, v = 0, s2 = 0;
        do {
            u = rand() * 2.0 - 1.0;
            v = rand() * 2.0 - 1.0;
            s2 = u * u + v * v;
        } while (s2 >= 1.0 || s2 === 0.0);
        const f = Math.sqrt(-2.0 * Math.log(s2) / s2);
        spare = v * f;
        return u * f;
    };
    return { rand, gauss };
}

export function decodeTraits(mask) {
    const out = [];
    const m = mask >>> 0;
    for (const f of TRAIT_FLAGS) {
        if ((m & f.bit) !== 0) out.push(f.short);
    }
    return out.length > 0 ? out.join('|') : 'Basal';
}

export function resolveBranchDir() {
    let base = 'test-results';
    try {
        if (globalThis.bro && bro.app && bro.app.dataDir) {
            base = String(bro.app.dataDir).replace(/\\/g, '/');
        }
    } catch (_) {}
    const dir = base.replace(/\/$/, '') + '/evo-biosphere-branches';
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    return dir;
}

export function buildCladesMeta() {
    const rng = makeRng(0xC1ADE032);
    const list = [];
    for (let c = 0; c < CLADE_COUNT; c++) {
        const phy = PHYLA[c % PHYLA.length];
        const optA = Math.max(-1.45, Math.min(1.45, phy.optA + (rng.rand() - 0.5) * 0.48));
        const optB = Math.max(-1.45, Math.min(1.45, phy.optB + (rng.rand() - 0.5) * 0.48));
        list.push({
            clade_id: c,
            phylum: phy.name,
            opt_a: optA,
            opt_b: optB,
            extinct: false,
        });
    }
    return list;
}

export function createBiosphereTables() {
    const t0 = performance.now();
    const q = bro.table;
    const rng = makeRng(0xE70B1026);

    const cladeMeta = buildCladesMeta();
    const clades = q.create(CLADE_SCHEMA);
    clades.insertMany(cladeMeta);
    clades.createIndex('clade_id');

    const niches = q.create(NICHE_SCHEMA);
    niches.insertMany(NICHES.map((n) => ({
        niche_id: n.id,
        niche_name: n.name,
        temp_c: n.temp_c,
        radiation: n.radiation,
    })));
    niches.createIndex('niche_id');

    const N = CREATURE_COUNT;
    const id = new Uint32Array(N);
    const clade_id = new Int32Array(N);
    const niche_id = new Int32Array(N);
    const lineage = new Array(N);
    const taxon_name = new Array(N);
    const parent_id = new Array(N);
    const generation = new Int32Array(N);
    const traits_mask = new Uint32Array(N);
    const x = new Float32Array(N);
    const y = new Float32Array(N);
    const z = new Float32Array(N);
    const gene_a = new Float32Array(N);
    const gene_b = new Float32Array(N);
    const fitness = new Float32Array(N);
    const mutation_rate = new Float32Array(N);
    const alive = new Uint8Array(N);

    // Group 4 chunks (16,384 rows) per niche so spatial operations touch local chunks cleanly
    const perNiche = N / NICHE_COUNT;
    for (let i = 0; i < N; i++) {
        const oid = i + 1;
        const nid = Math.min(NICHE_COUNT - 1, Math.floor(i / perNiche));
        const niche = NICHES[nid];
        const cid = ((nid * 4) + (i % 4) + ((rng.rand() < 0.25) ? (rng.rand() * 8) | 0 : 0)) % CLADE_COUNT;
        const cl = cladeMeta[cid];
        const phy = PHYLA[cid % PHYLA.length];

        id[i] = oid;
        clade_id[i] = cid;
        niche_id[i] = nid;
        lineage[i] = `${phy.name}-${String(cid).padStart(2, '0')}`;
        taxon_name[i] = `${TAXON_PREFIX[(cid + nid) % TAXON_PREFIX.length]}-${TAXON_SUFFIX[i % TAXON_SUFFIX.length]}-${oid}`;

        // ~12.5% NULL parent_id (primordial founders at generation 0)
        const isFounder = (i % 8 === 0);
        if (isFounder) {
            parent_id[i] = null;
            generation[i] = 0;
        } else {
            const localBase = nid * perNiche;
            const ancestorOffset = ((i - localBase) * 7919) % Math.max(1, i - localBase);
            parent_id[i] = BigInt(localBase + ancestorOffset + 1);
            generation[i] = 1 + ((i + cid) % 24);
        }

        // Bitwise traits_mask (1..63) combining niche bias and stochastic mutations
        let mask = niche.biasMask & ((rng.rand() < 0.78) ? 63 : 0);
        for (const f of TRAIT_FLAGS) {
            if (rng.rand() < (f.bit === 1 ? 0.34 : 0.22)) mask |= f.bit;
        }
        if (mask === 0) mask = 1 << (cid % 6);
        traits_mask[i] = mask >>> 0;

        // Clustered organic reef filaments around niche center
        const theta = rng.rand() * Math.PI * 2.0;
        const phi = Math.acos(2.0 * rng.rand() - 1.0);
        const rad = Math.pow(rng.rand(), 0.58) * 0.42;
        const arm = (cid % 4) * 0.08 * Math.sin(theta * 2.0);
        x[i] = Math.max(-1.42, Math.min(1.42, niche.center[0] + Math.sin(phi) * Math.cos(theta) * (rad + arm) + rng.gauss() * 0.04));
        y[i] = Math.max(-1.32, Math.min(1.32, niche.center[1] + Math.cos(phi) * (rad * 0.85) + rng.gauss() * 0.04));
        z[i] = Math.max(-1.42, Math.min(1.42, niche.center[2] + Math.sin(phi) * Math.sin(theta) * (rad + arm) + rng.gauss() * 0.04));

        // Genotype spread: ~82% clustered near adaptive clade peak, ~18% drifting outliers
        const spread = (rng.rand() < 0.18) ? 0.92 : 0.42;
        const ga = Math.max(-2.1, Math.min(2.1, cl.opt_a + rng.gauss() * spread));
        const gb = Math.max(-2.1, Math.min(2.1, cl.opt_b + rng.gauss() * spread));
        gene_a[i] = ga;
        gene_b[i] = gb;

        const d2 = (ga - cl.opt_a) * (ga - cl.opt_a) + (gb - cl.opt_b) * (gb - cl.opt_b);
        const traitBonus = ((mask & 1) ? 0.03 : 0.0) + ((mask & 32) ? 0.04 : 0.0) + ((mask & 4) ? 0.02 : 0.0);
        fitness[i] = Math.max(0.04, Math.min(1.0, Math.exp(-d2 * 0.65) * 0.88 + traitBonus + 0.04));

        const mutBase = 0.06 + niche.radiation * 0.55 + (rng.rand() < 0.14 ? 0.34 : 0.0);
        mutation_rate[i] = Math.max(0.03, Math.min(0.88, mutBase + (rng.rand() - 0.5) * 0.18));
        alive[i] = 1;
    }

    const creatures = q.create(CREATURE_SCHEMA);
    const BATCH = 16384;
    for (let off = 0; off < N; off += BATCH) {
        const end = Math.min(N, off + BATCH);
        creatures.insertMany({
            id: id.subarray(off, end),
            clade_id: clade_id.subarray(off, end),
            niche_id: niche_id.subarray(off, end),
            lineage: lineage.slice(off, end),
            taxon_name: taxon_name.slice(off, end),
            parent_id: parent_id.slice(off, end),
            generation: generation.subarray(off, end),
            traits_mask: traits_mask.subarray(off, end),
            x: x.subarray(off, end),
            y: y.subarray(off, end),
            z: z.subarray(off, end),
            gene_a: gene_a.subarray(off, end),
            gene_b: gene_b.subarray(off, end),
            fitness: fitness.subarray(off, end),
            mutation_rate: mutation_rate.subarray(off, end),
            alive: alive.subarray(off, end),
        });
    }

    creatures.createIndex('id');
    creatures.createRangeIndex('fitness');
    creatures.createSpatialIndex('hab3d', ['x', 'y', 'z'], 0.25);

    return {
        creatures,
        clades,
        niches,
        cladeMeta,
        buildMs: performance.now() - t0,
        nextId: N + 1,
        maxGen: 24,
    };
}

export function buildSpeciationBatch(startId, count, nextGen, seed, cladeMeta) {
    const rng = makeRng(seed);
    const rows = new Array(count);
    for (let i = 0; i < count; i++) {
        const oid = startId + i;
        const nid = i % NICHE_COUNT;
        const niche = NICHES[nid];
        const cid = (nid * 4 + (i % 4)) % CLADE_COUNT;
        const cl = cladeMeta[cid];
        const phy = PHYLA[cid % PHYLA.length];

        const ga = Math.max(-2.0, Math.min(2.0, cl.opt_a + rng.gauss() * 0.26));
        const gb = Math.max(-2.0, Math.min(2.0, cl.opt_b + rng.gauss() * 0.26));
        const d2 = (ga - cl.opt_a) * (ga - cl.opt_a) + (gb - cl.opt_b) * (gb - cl.opt_b);

        let mask = niche.biasMask | (1 << (i % 6));
        if (i % 3 === 0) mask |= 32; // Symbiotic burst bias

        const theta = rng.rand() * Math.PI * 2.0;
        const phi = Math.acos(2.0 * rng.rand() - 1.0);
        const rad = 0.14 + rng.rand() * 0.22;

        rows[i] = {
            id: oid,
            clade_id: cid,
            niche_id: nid,
            lineage: `${phy.name}-${String(cid).padStart(2, '0')}`,
            taxon_name: `Neo-${TAXON_PREFIX[cid % TAXON_PREFIX.length]}-${oid}`,
            parent_id: BigInt(1 + ((oid * 3571) % Math.max(1, startId - 1))),
            generation: nextGen,
            traits_mask: mask >>> 0,
            x: Math.max(-1.42, Math.min(1.42, niche.center[0] + Math.sin(phi) * Math.cos(theta) * rad)),
            y: Math.max(-1.32, Math.min(1.32, niche.center[1] + Math.cos(phi) * rad)),
            z: Math.max(-1.42, Math.min(1.42, niche.center[2] + Math.sin(phi) * Math.sin(theta) * rad)),
            gene_a: ga,
            gene_b: gb,
            fitness: Math.max(0.35, Math.min(1.0, Math.exp(-d2 * 0.65) * 0.90 + 0.08)),
            mutation_rate: Math.max(0.04, Math.min(0.45, 0.09 + rng.rand() * 0.18)),
            alive: true,
        };
    }
    return rows;
}
