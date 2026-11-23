// Multi-table relational schema & synthetic 3D biosphere generator for Living Ecology.
// Creates mutable bro.table instances: organisms (131,072 rows = 32 chunks), species (12),
// and zones (64) with Hash, Range, and 3D Spatial indexes + v3 .brotable checkpoint pathing.

const fs = require('fs');
const path = require('path');

export const ORGANISM_ROWS = 131072; // 32 * 4096 rows

export const ORGANISM_SCHEMA = {
    id: 'u32',
    species_id: 'i32',
    zone_id: 'i32',
    role: 'dict',
    tag: 'string',
    x: 'f32',
    y: 'f32',
    z: 'f32',
    energy: 'f32',
    stress: 'f32',
    nutrient: 'f32',
    age: 'f32',
    toxin_mask: 'u32',
    alive_flag: 'bool',
    mutant_note: 'string',
};

export const SPECIES_SCHEMA = {
    species_id: 'i32',
    name: 'dict',
    guild: 'dict',
    metabolism: 'f32',
    reproduction_rate: 'f32',
    thermal_opt: 'f32',
    hex_col: 'string',
};

export const ZONE_SCHEMA = {
    zone_id: 'i32',
    biome: 'dict',
    fertility: 'f32',
    toxicity: 'f32',
};

export const GPU_COLS = ['x', 'y', 'z', 'energy', 'stress', 'nutrient', 'age', 'species_id'];

export const ROLE_NAMES = ['Producer', 'Grazer', 'Predator', 'Decomposer'];
export const ROLE_COLORS = ['#2ef2c2', '#7cf05e', '#ff9f3c', '#d662ff'];

export const SPECIES_DEFS = [
    // Producers (0..2)
    { species_id: 0, code: 'PHY', name: 'Cyanophyte Swarm', guild: 'Producer', roleIdx: 0, metabolism: 0.42, reproduction_rate: 1.45, thermal_opt: 0.62, hex_col: '#2ef2c2', weight: 0.22 },
    { species_id: 1, code: 'CHL', name: 'Reef Zooxanthella', guild: 'Producer', roleIdx: 0, metabolism: 0.48, reproduction_rate: 1.32, thermal_opt: 0.70, hex_col: '#38e89e', weight: 0.18 },
    { species_id: 2, code: 'VEN', name: 'Vent Chemotroph', guild: 'Producer', roleIdx: 0, metabolism: 0.55, reproduction_rate: 1.18, thermal_opt: 0.92, hex_col: '#22c4ff', weight: 0.12 },
    // Grazers (3..5)
    { species_id: 3, code: 'COP', name: 'Pelagic Copepod', guild: 'Grazer', roleIdx: 1, metabolism: 0.68, reproduction_rate: 0.95, thermal_opt: 0.58, hex_col: '#7cf05e', weight: 0.11 },
    { species_id: 4, code: 'URC', name: 'Atoll Grazing Urchin', guild: 'Grazer', roleIdx: 1, metabolism: 0.64, reproduction_rate: 0.88, thermal_opt: 0.66, hex_col: '#a8f24d', weight: 0.08 },
    { species_id: 5, code: 'PAR', name: 'Lantern Krill', guild: 'Grazer', roleIdx: 1, metabolism: 0.74, reproduction_rate: 1.02, thermal_opt: 0.52, hex_col: '#64d87a', weight: 0.07 },
    // Predators (6..8)
    { species_id: 6, code: 'RAY', name: 'Bioluminescent Ray', guild: 'Predator', roleIdx: 2, metabolism: 0.92, reproduction_rate: 0.54, thermal_opt: 0.60, hex_col: '#ff9f3c', weight: 0.05 },
    { species_id: 7, code: 'CEP', name: 'Vortex Cephalopod', guild: 'Predator', roleIdx: 2, metabolism: 1.04, reproduction_rate: 0.48, thermal_opt: 0.50, hex_col: '#ff6f42', weight: 0.04 },
    { species_id: 8, code: 'JLY', name: 'Abyssal Siphonophore', guild: 'Predator', roleIdx: 2, metabolism: 0.88, reproduction_rate: 0.58, thermal_opt: 0.44, hex_col: '#ffbe48', weight: 0.03 },
    // Decomposers (9..11)
    { species_id: 9, code: 'DET', name: 'Benthic Detritivore', guild: 'Decomposer', roleIdx: 3, metabolism: 0.52, reproduction_rate: 0.84, thermal_opt: 0.42, hex_col: '#d662ff', weight: 0.04 },
    { species_id: 10, code: 'FUN', name: 'Marine Mycelia', guild: 'Decomposer', roleIdx: 3, metabolism: 0.46, reproduction_rate: 0.90, thermal_opt: 0.48, hex_col: '#b36eff', weight: 0.03 },
    { species_id: 11, code: 'BAC', name: 'Sulfate Reducer', guild: 'Decomposer', roleIdx: 3, metabolism: 0.58, reproduction_rate: 0.96, thermal_opt: 0.86, hex_col: '#f05cd6', weight: 0.03 },
];

export const BIOME_NAMES = ['Coral Reef', 'Thermal Vent', 'Pelagic Gyre', 'Abyssal Trench'];

const MUTANT_NOTES = [
    'symbiont-A',
    'biolum-v2',
    'thermo-adapt',
    'reef-morph',
    'pelagic-drift',
    'chemo-lin',
    'cilia-boost',
    'calcified',
];

function makeRng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function buildZoneMetadata() {
    const rng = makeRng(0xB105FE4E);
    const zoneList = [];
    for (let zi = 0; zi < 64; zi++) {
        let biome = BIOME_NAMES[0];
        let cx = 0, cy = 0, cz = 0;
        let fertility = 0.72;
        let toxicity = 0.08;

        if (zi < 24) {
            // 24 Coral Reef hubs in undulating figure-8 / atoll twin arcs
            biome = BIOME_NAMES[0];
            const t = (zi / 24) * Math.PI * 2;
            const r = 0.74 + 0.16 * Math.cos(t * 3.0);
            cx = Math.cos(t) * r;
            cz = Math.sin(t) * r;
            cy = 0.16 * Math.sin(t * 2.0) - 0.04;
            fertility = 0.75 + rng() * 0.22;
            toxicity = 0.03 + rng() * 0.10;
        } else if (zi < 40) {
            // 16 Thermal Vent plumes rising from deep chimneys
            biome = BIOME_NAMES[1];
            const chimney = zi % 4;
            const level = Math.floor((zi - 24) / 4);
            const ca = chimney * (Math.PI * 0.5) + 0.45;
            const cr = 0.36 + level * 0.06;
            cx = Math.cos(ca + level * 0.22) * cr;
            cz = Math.sin(ca + level * 0.22) * cr;
            cy = -0.68 + level * 0.32;
            fertility = 0.58 + rng() * 0.28;
            toxicity = 0.24 + rng() * 0.24;
        } else if (zi < 56) {
            // 16 Pelagic Gyre spiral currents in upper canopy
            biome = BIOME_NAMES[2];
            const k = zi - 40;
            const arm = k % 2;
            const u = Math.floor(k / 2) / 8;
            const ang = arm * Math.PI + u * 2.6;
            const rad = 0.30 + u * 0.78;
            cx = Math.cos(ang) * rad;
            cz = Math.sin(ang) * rad;
            cy = 0.36 + 0.28 * Math.sin(u * Math.PI);
            fertility = 0.62 + rng() * 0.25;
            toxicity = 0.04 + rng() * 0.12;
        } else {
            // 8 Abyssal Trench filaments near seafloor
            biome = BIOME_NAMES[3];
            const k = zi - 56;
            const ang = (k / 8) * Math.PI * 2 + 0.3;
            cx = Math.cos(ang) * 0.64;
            cz = Math.sin(ang) * 0.64;
            cy = -0.78 + (rng() - 0.5) * 0.18;
            fertility = 0.38 + rng() * 0.24;
            toxicity = 0.18 + rng() * 0.28;
        }

        zoneList.push({
            zone_id: zi,
            biome,
            fertility: +fertility.toFixed(3),
            toxicity: +toxicity.toFixed(3),
            cx,
            cy,
            cz,
        });
    }
    return zoneList;
}

export const ZONE_METADATA = buildZoneMetadata();

function pickSpeciesWeighted(rng, zone) {
    // Bias Vent Chemotroph / Sulfate Reducer toward vents & abyssal zones
    const isVent = zone.biome === 'Thermal Vent';
    const isAbyss = zone.biome === 'Abyssal Trench';
    let r = rng();
    if (isVent && r < 0.36) return rng() < 0.72 ? 2 : 11;
    if (isAbyss && r < 0.42) return 9 + ((rng() * 3) | 0);
    for (let i = 0; i < SPECIES_DEFS.length; i++) {
        r -= SPECIES_DEFS[i].weight;
        if (r <= 0) return i;
    }
    return 0;
}

function sampleOrganismCoord(zone, spId, rng) {
    const g = () => (rng() + rng() + rng()) / 3.0 - 0.5;
    const roleIdx = SPECIES_DEFS[spId].roleIdx;
    const ang = rng() * Math.PI * 2;
    const rad = Math.pow(rng(), 0.6) * (zone.biome === 'Thermal Vent' ? 0.19 : 0.26);
    const swirl = rad * 1.4;
    let x = zone.cx + Math.cos(ang + swirl) * rad + g() * 0.08;
    let z = zone.cz + Math.sin(ang + swirl) * rad + g() * 0.08;
    let y = zone.cy + (rng() - 0.5) * (zone.biome === 'Thermal Vent' ? 0.34 : 0.20) + g() * 0.06;
    if (roleIdx === 2) {
        // Predators patrol slightly wider envelopes around reefs
        x += Math.cos(ang) * 0.07;
        z += Math.sin(ang) * 0.07;
    }
    return [
        Math.max(-1.22, Math.min(1.22, x)),
        Math.max(-1.05, Math.min(1.05, y)),
        Math.max(-1.22, Math.min(1.22, z)),
    ];
}

export function resolveCheckpointPath(filename = 'living-ecology-v3.brotable') {
    const baseDir = (globalThis.bro && bro.app && bro.app.dataDir)
        ? String(bro.app.dataDir).replace(/\\/g, '/')
        : 'test-results';
    try {
        fs.mkdirSync(baseDir, { recursive: true });
    } catch (_) {}
    return `${baseDir.replace(/\/+$/, '')}/${filename}`;
}

export function createEcologyTables() {
    const t0 = Date.now();
    const rng = makeRng(0xEC010672);

    // 1. Species relational table (12 rows)
    const species = bro.table.create(SPECIES_SCHEMA);
    species.insertMany(SPECIES_DEFS.map((s) => ({
        species_id: s.species_id,
        name: s.name,
        guild: s.guild,
        metabolism: s.metabolism,
        reproduction_rate: s.reproduction_rate,
        thermal_opt: s.thermal_opt,
        hex_col: s.hex_col,
    })));
    species.createIndex('species_id');

    // 2. Habitat zones relational table (64 rows)
    const zones = bro.table.create(ZONE_SCHEMA);
    zones.insertMany(ZONE_METADATA.map((z) => ({
        zone_id: z.zone_id,
        biome: z.biome,
        fertility: z.fertility,
        toxicity: z.toxicity,
    })));
    zones.createIndex('zone_id');

    // 3. Organisms mutable primary table (131,072 rows = 32 chunks of 4096 rows)
    const N = ORGANISM_ROWS;
    const organisms = bro.table.create(ORGANISM_SCHEMA);

    const idArr = new Uint32Array(N);
    const spArr = new Int32Array(N);
    const zoneArr = new Int32Array(N);
    const roleArr = new Array(N);
    const tagArr = new Array(N);
    const xArr = new Float32Array(N);
    const yArr = new Float32Array(N);
    const zArr = new Float32Array(N);
    const eArr = new Float32Array(N);
    const sArr = new Float32Array(N);
    const nArr = new Float32Array(N);
    const aArr = new Float32Array(N);
    const toxArr = new Uint32Array(N);
    const aliveArr = new Uint8Array(N);
    const mutArr = new Array(N);

    for (let i = 0; i < N; i++) {
        const zId = i % 64;
        const zone = ZONE_METADATA[zId];
        const spId = pickSpeciesWeighted(rng, zone);
        const sp = SPECIES_DEFS[spId];
        const [px, py, pz] = sampleOrganismCoord(zone, spId, rng);

        // ~2.5% starving (<0.08), ~5.5% critical (<0.22), rest thriving (0.28..1.35)
        const tierRoll = rng();
        let energy;
        if (tierRoll < 0.025) {
            energy = 0.025 + rng() * 0.05;
        } else if (tierRoll < 0.08) {
            energy = 0.09 + rng() * 0.12;
        } else {
            energy = 0.28 + zone.fertility * 0.55 + rng() * 0.48;
        }

        const stress = Math.min(
            0.96,
            Math.max(0.02, zone.toxicity * 1.35 + (energy < 0.22 ? 0.32 : 0.0) + rng() * 0.34)
        );
        const nutrient = Math.min(1.0, Math.max(0.05, zone.fertility * 0.8 + rng() * 0.32));
        const age = 0.2 + rng() * 6.5;

        idArr[i] = i + 1;
        spArr[i] = spId;
        zoneArr[i] = zId;
        roleArr[i] = sp.guild;
        tagArr[i] = `${sp.code}-Z${zId}-${(i % 997).toString(16)}`;
        xArr[i] = px;
        yArr[i] = py;
        zArr[i] = pz;
        eArr[i] = energy;
        sArr[i] = stress;
        nArr[i] = nutrient;
        aArr[i] = age;
        toxArr[i] = zone.toxicity > 0.30 ? 1 : 0;
        aliveArr[i] = 1;
        // ~5% null mutant_note to exercise nullable string columns & coalesce()
        mutArr[i] = (i % 20 === 7) ? null : MUTANT_NOTES[i % MUTANT_NOTES.length];
    }

    const BATCH = 16384;
    for (let off = 0; off < N; off += BATCH) {
        const end = Math.min(N, off + BATCH);
        organisms.insertMany({
            id: idArr.subarray(off, end),
            species_id: spArr.subarray(off, end),
            zone_id: zoneArr.subarray(off, end),
            role: roleArr.slice(off, end),
            tag: tagArr.slice(off, end),
            x: xArr.subarray(off, end),
            y: yArr.subarray(off, end),
            z: zArr.subarray(off, end),
            energy: eArr.subarray(off, end),
            stress: sArr.subarray(off, end),
            nutrient: nArr.subarray(off, end),
            age: aArr.subarray(off, end),
            toxin_mask: toxArr.subarray(off, end),
            alive_flag: aliveArr.subarray(off, end),
            mutant_note: mutArr.slice(off, end),
        });
    }

    organisms.createIndex('id');
    organisms.createRangeIndex('energy');
    organisms.createSpatialIndex('bio3d', ['x', 'y', 'z'], 0.25);

    return {
        organisms,
        species,
        zones,
        nextId: N + 1,
        buildMs: Date.now() - t0,
    };
}

export function makeOffspringBatch(count, nextIdStart, seedOffset = 1) {
    const rng = makeRng(0xCAFE0000 ^ (nextIdStart + seedOffset * 977));
    const idArr = new Uint32Array(count);
    const spArr = new Int32Array(count);
    const zoneArr = new Int32Array(count);
    const roleArr = new Array(count);
    const tagArr = new Array(count);
    const xArr = new Float32Array(count);
    const yArr = new Float32Array(count);
    const zArr = new Float32Array(count);
    const eArr = new Float32Array(count);
    const sArr = new Float32Array(count);
    const nArr = new Float32Array(count);
    const aArr = new Float32Array(count);
    const toxArr = new Uint32Array(count);
    const aliveArr = new Uint8Array(count);
    const mutArr = new Array(count);

    for (let i = 0; i < count; i++) {
        const zId = (i * 7 + seedOffset) % 64;
        const zone = ZONE_METADATA[zId];
        const spId = pickSpeciesWeighted(rng, zone);
        const sp = SPECIES_DEFS[spId];
        const [px, py, pz] = sampleOrganismCoord(zone, spId, rng);

        idArr[i] = nextIdStart + i;
        spArr[i] = spId;
        zoneArr[i] = zId;
        roleArr[i] = sp.guild;
        tagArr[i] = `SPAWN-${sp.code}-${nextIdStart + i}`;
        xArr[i] = px;
        yArr[i] = py;
        zArr[i] = pz;
        eArr[i] = 0.68 + rng() * 0.55;
        sArr[i] = 0.04 + rng() * 0.16;
        nArr[i] = 0.72 + rng() * 0.24;
        aArr[i] = 0.15 + rng() * 0.45;
        toxArr[i] = 0;
        aliveArr[i] = 1;
        mutArr[i] = (i % 20 === 3) ? null : 'spawn-v3';
    }

    return {
        id: idArr,
        species_id: spArr,
        zone_id: zoneArr,
        role: roleArr,
        tag: tagArr,
        x: xArr,
        y: yArr,
        z: zArr,
        energy: eArr,
        stress: sArr,
        nutrient: nArr,
        age: aArr,
        toxin_mask: toxArr,
        alive_flag: aliveArr,
        mutant_note: mutArr,
    };
}

export function buildAnalyticsBatch() {
    return {
        type: 'runBatch',
        queries: {
            trophicJoin: {
                table: 'organisms',
                join: { table: 'species', leftKeys: 'species_id', rightKeys: 'species_id' },
                groupBy: 'species_id',
                agg: {
                    cnt: { fn: 'count' },
                    avgEnergy: { fn: 'avg', expr: { col: 'left.energy' } },
                    avgStress: { fn: 'avg', expr: { col: 'left.stress' } },
                    avgFitness: {
                        fn: 'avg',
                        expr: {
                            op: 'sub',
                            a: { op: 'div', a: { col: 'left.energy' }, b: { col: 'right.metabolism' } },
                            b: { op: 'mul', a: { col: 'left.stress' }, b: { lit: 1.5 } },
                        },
                    },
                    totalBiomass: { fn: 'sum', expr: { col: 'left.energy' } },
                },
                orderBy: { expr: 'species_id', desc: false },
            },
            topThriving: {
                table: 'organisms',
                where: { op: 'gt', a: { col: 'energy' }, b: { lit: 0.1 } },
                select: {
                    id: 'id',
                    species_id: 'species_id',
                    zone_id: 'zone_id',
                    energy: 'energy',
                    stress: 'stress',
                },
                orderBy: { expr: 'energy', desc: true },
                limit: 8,
            },
            stressZones: {
                table: 'organisms',
                join: { table: 'zones', leftKeys: 'zone_id', rightKeys: 'zone_id' },
                where: {
                    op: 'or',
                    args: [
                        { op: 'gt', a: { col: 'left.stress' }, b: { lit: 0.72 } },
                        { op: 'gt', a: { col: 'right.toxicity' }, b: { lit: 0.35 } },
                    ],
                },
                select: {
                    id: 'left.id',
                    zone_id: 'left.zone_id',
                    biome: 'right.biome',
                    energy: 'left.energy',
                    stress: 'left.stress',
                    alert: {
                        op: 'cond',
                        c: { op: 'gt', a: { col: 'left.stress' }, b: { lit: 0.72 } },
                        t: { lit: 'CRITICAL' },
                        e: { lit: 'TOXIC_ZONE' },
                    },
                    strain: {
                        op: 'coalesce',
                        a: { col: 'left.mutant_note' },
                        b: { lit: 'wildtype' },
                    },
                },
                orderBy: { expr: { col: 'left.stress' }, desc: true },
                limit: 6,
            },
        },
        tensor: {
            table: 'organisms',
            cols: ['energy', 'stress', 'nutrient', 'age'],
            weights: [-0.45, 0.85, -0.18, 0.06],
            bias: 0.25,
            maxRows: 32768,
        },
    };
}

