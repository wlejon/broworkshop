// Initial 65,536-agent bio-swarm table generation, SpatialIndex + RangeIndex setup,
// and incremental ReactiveQuery species census for Neural GPU Swarm.

const q = bro.table;

export const AGENT_COUNT = 65536; // 16 x 4096 chunks
export const CHUNK_COUNT = 16;

export const SPECIES_DEFS = [
  { id: 0, name: 'Apex Seekers',  hex: '#28e0ff', rgb: [0.16, 0.88, 1.00], orbitR: 12.0, freq: 1.0 },
  { id: 1, name: 'Solar Gliders', hex: '#ffbf3c', rgb: [1.00, 0.75, 0.24], orbitR: 16.5, freq: 1.4 },
  { id: 2, name: 'Reef Weavers',  hex: '#ff4fd8', rgb: [1.00, 0.31, 0.85], orbitR: 21.0, freq: 0.7 },
  { id: 3, name: 'Deep Drifters', hex: '#39e58c', rgb: [0.22, 0.90, 0.55], orbitR:  8.5, freq: 1.9 },
];

export function createSwarmTables() {
  const species = q.create({
    species_id: 'i32',
    name: 'string',
    orbit_r: 'f32',
    freq: 'f32',
  });
  species.insertMany(SPECIES_DEFS.map((s) => ({
    species_id: s.id,
    name: s.name,
    orbit_r: s.orbitR,
    freq: s.freq,
  })));
  species.createIndex('species_id');

  const agents = q.create({
    id: 'i32',
    species_id: 'i32',
    x: 'f32',
    y: 'f32',
    z: 'f32',
    scale: 'f32',
    vx: 'f32',
    vy: 'f32',
    vz: 'f32',
    energy: 'f32',
    r: 'f32',
    g: 'f32',
    b: 'f32',
  });

  // Columnar TypedArray insert (zero GC pressure for 65,536 rows).
  const id = new Int32Array(AGENT_COUNT);
  const species_id = new Int32Array(AGENT_COUNT);
  const x = new Float32Array(AGENT_COUNT);
  const y = new Float32Array(AGENT_COUNT);
  const z = new Float32Array(AGENT_COUNT);
  const scale = new Float32Array(AGENT_COUNT);
  const vx = new Float32Array(AGENT_COUNT);
  const vy = new Float32Array(AGENT_COUNT);
  const vz = new Float32Array(AGENT_COUNT);
  const energy = new Float32Array(AGENT_COUNT);
  const r = new Float32Array(AGENT_COUNT);
  const g = new Float32Array(AGENT_COUNT);
  const b = new Float32Array(AGENT_COUNT);

  let seed = 0x9e3779b9;
  const rnd = () => {
    seed = (seed ^ (seed << 13)) >>> 0;
    seed = (seed ^ (seed >>> 17)) >>> 0;
    seed = (seed ^ (seed << 5)) >>> 0;
    return seed / 4294967296.0;
  };

  for (let i = 0; i < AGENT_COUNT; i++) {
    const sp = i & 3;
    const def = SPECIES_DEFS[sp];
    const u = rnd() * Math.PI * 2.0;
    const v = rnd() * Math.PI * 2.0;
    const tube = (rnd() - 0.5) * 4.5;
    const major = def.orbitR + Math.cos(v) * (3.2 + tube * 0.4);
    const px = Math.cos(u) * major;
    const py = Math.sin(v) * (3.2 + tube * 0.5) + (sp - 1.5) * 1.4;
    const pz = Math.sin(u) * major;

    const tangentX = -Math.sin(u);
    const tangentZ = Math.cos(u);
    const spd = 2.5 + rnd() * 2.5;

    id[i] = i;
    species_id[i] = sp;
    x[i] = px;
    y[i] = py;
    z[i] = pz;
    scale[i] = 0.08 + rnd() * 0.06;
    vx[i] = tangentX * spd;
    vy[i] = (rnd() - 0.5) * 1.2;
    vz[i] = tangentZ * spd;
    energy[i] = 0.25 + rnd() * 0.55;
    r[i] = def.rgb[0];
    g[i] = def.rgb[1];
    b[i] = def.rgb[2];
  }

  agents.insertMany({ id, species_id, x, y, z, scale, vx, vy, vz, energy, r, g, b });
  agents.createSpatialIndex('pos3d', ['x', 'y', 'z'], 4.0);
  agents.createRangeIndex('energy');

  return { agents, species };
}

export function buildCensusQuery(agents, minEnergy) {
  return agents.query()
    .where(q.ge('energy', minEnergy))
    .groupBy(['species_id'])
    .agg({
      count: q.count(),
      avgEnergy: q.avg('energy'),
      maxEnergy: q.max('energy'),
    })
    .orderBy('species_id')
    .reactive();
}
