// Multi-table global seismic/oceanographic generator & native CSV / Parquet (LZ4 + Snappy) /
// 4096B-aligned .brobundle persistence pipeline for Parquet Earth Atlas.

const fs = require('fs');
const os = require('os');
const path = require('path');

const q = bro.table;

export const GLOBE_RADIUS = 10.0;
export const INITIAL_EVENTS = 48000; // 11 full chunks (4096) + chunk 11 with 2,944/4,096 rows (room for live appends)
export const STATION_COUNT = 256;

// Tectonic belts defined as curved subduction/rift segments (lat0->lat1, lon0->lon1, weight)
export const REGION_DEFS = [
  { id: 0,  name: 'Japan Trench',      lat:  37.5, lon:  142.8, lat2:  42.0, lon2:  145.5, weight: 0.17, hex: '#28e0ff' },
  { id: 1,  name: 'Cascadia Arc',      lat:  40.5, lon: -125.0, lat2:  50.0, lon2: -129.0, weight: 0.08, hex: '#4ea8ff' },
  { id: 2,  name: 'Chile Subduction',  lat: -18.0, lon:  -70.5, lat2: -41.0, lon2:  -74.5, weight: 0.14, hex: '#6c63ff' },
  { id: 3,  name: 'Sunda Trench',      lat:   3.0, lon:   95.0, lat2: -10.5, lon2:  118.0, weight: 0.13, hex: '#39e58c' },
  { id: 4,  name: 'Aleutian Ridge',    lat:  51.5, lon: -178.0, lat2:  56.0, lon2: -156.0, weight: 0.09, hex: '#00d2d3' },
  { id: 5,  name: 'Tonga-Kermadec',    lat: -15.0, lon: -173.5, lat2: -36.0, lon2: -178.5, weight: 0.07, hex: '#a29bfe' },
  { id: 6,  name: 'Mediterranean',     lat:  35.5, lon:   15.0, lat2:  39.0, lon2:   30.0, weight: 0.08, hex: '#ffbf3c' },
  { id: 7,  name: 'Himalayan Front',   lat:  34.0, lon:   73.0, lat2:  27.5, lon2:   96.0, weight: 0.06, hex: '#ff9f43' },
  { id: 8,  name: 'Mid-Atlantic',      lat:  26.0, lon:  -44.0, lat2:  -4.0, lon2:  -32.0, weight: 0.05, hex: '#ff6b81' },
  { id: 9,  name: 'East African Rift', lat:   9.0, lon:   40.0, lat2: -11.0, lon2:   34.5, weight: 0.03, hex: '#ff4fd8' },
  { id: 10, name: 'San Andreas',       lat:  32.5, lon: -115.5, lat2:  40.0, lon2: -124.0, weight: 0.04, hex: '#ffd166' },
  { id: 11, name: 'Philippine Sea',    lat:   6.0, lon:  126.5, lat2:  21.0, lon2:  122.0, weight: 0.06, hex: '#48dbfb' },
];

export function latLonToSphere(latDeg, lonDeg, r) {
  const lat = (latDeg * Math.PI) / 180.0;
  const lon = (lonDeg * Math.PI) / 180.0;
  const cl = Math.cos(lat);
  return [
    r * cl * Math.cos(lon),
    r * Math.sin(lat),
    r * cl * Math.sin(lon),
  ];
}

export function depthColor(depthKm) {
  const t = Math.max(0.0, Math.min(1.0, depthKm / 450.0));
  if (t < 0.45) {
    const u = t / 0.45;
    return [0.16 + 0.84 * u, 0.88 - 0.14 * u, 1.0 - 0.76 * u];
  }
  const u = (t - 0.45) / 0.55;
  return [1.0, 0.74 - 0.45 * u, 0.24 + 0.62 * u];
}

export function createSeedDataDir() {
  const dir = path.join(os.tmpdir(), 'broworkshop_parquet_earth_atlas');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  return dir;
}

export function loadOrBuildEarthTables() {
  const dataDir = createSeedDataDir();
  const regionsCsvPath = path.join(dataDir, 'regions.csv');
  const stationsCsvPath = path.join(dataDir, 'stations.csv');

  // 1. Write & ingest CSV files natively via bro.table.fromCSVFile
  const regLines = ['region_id,name,center_lat,center_lon'];
  for (const r of REGION_DEFS) {
    regLines.push(`${r.id},"${r.name}",${r.lat.toFixed(2)},${r.lon.toFixed(2)}`);
  }
  fs.writeFileSync(regionsCsvPath, regLines.join('\n') + '\n');
  const regions = q.fromCSVFile(regionsCsvPath, {
    schema: { region_id: 'i32', name: 'string', center_lat: 'f32', center_lon: 'f32' },
  });
  regions.createIndex('region_id');

  const stLines = ['station_id,code,region_id,lat,lon'];
  let rngState = 0x13579bdf;
  const rnd = () => {
    rngState = (rngState ^ (rngState << 13)) >>> 0;
    rngState = (rngState ^ (rngState >>> 17)) >>> 0;
    rngState = (rngState ^ (rngState << 5)) >>> 0;
    return rngState / 4294967296.0;
  };
  for (let i = 0; i < STATION_COUNT; i++) {
    const reg = REGION_DEFS[i % REGION_DEFS.length];
    const lat = reg.lat + (rnd() - 0.5) * 14.0;
    const lon = reg.lon + (rnd() - 0.5) * 18.0;
    stLines.push(`${i},"STN-${String(i).padStart(3, '0')}",${reg.id},${lat.toFixed(3)},${lon.toFixed(3)}`);
  }
  fs.writeFileSync(stationsCsvPath, stLines.join('\n') + '\n');
  const stations = q.fromCSVFile(stationsCsvPath, {
    schema: { station_id: 'i32', code: 'string', region_id: 'i32', lat: 'f32', lon: 'f32' },
  });
  stations.createIndex('station_id');

  // 2. Build 49,152 realistic tectonic seismic events (station_id nullable for deep offshore quakes)
  const events = q.create({
    event_id: 'i32',
    region_id: 'i32',
    station_id: 'i32',
    lat: 'f32',
    lon: 'f32',
    depth_km: 'f32',
    mag: 'f32',
    sx: 'f32',
    sy: 'f32',
    sz: 'f32',
    radius: 'f32',
    cr: 'f32',
    cg: 'f32',
    cb: 'f32',
    alpha: 'f32',
  });

  const cumWeights = [];
  let wSum = 0;
  for (const r of REGION_DEFS) { wSum += r.weight; cumWeights.push(wSum); }
  const pickRegion = (u) => {
    const target = u * wSum;
    for (let k = 0; k < cumWeights.length; k++) if (target <= cumWeights[k]) return k;
    return REGION_DEFS.length - 1;
  };
  const gauss = () => ((rnd() + rnd() + rnd() + rnd()) - 2.0) * 1.15;

  const rows = new Array(INITIAL_EVENTS);
  for (let i = 0; i < INITIAL_EVENTS; i++) {
    const rid = pickRegion(rnd());
    const reg = REGION_DEFS[rid];
    const along = rnd();
    const arcBend = Math.sin(along * Math.PI) * 2.4;
    const lat = Math.max(-85, Math.min(85, reg.lat + (reg.lat2 - reg.lat) * along + arcBend * 0.35 + gauss() * 1.35));
    const lon = reg.lon + (reg.lon2 - reg.lon) * along + arcBend + gauss() * 1.65;
    const depth = 6.0 + Math.pow(rnd(), 1.8) * 440.0;
    const mag = 1.9 + Math.pow(rnd(), 2.6) * 5.8;
    const elev = GLOBE_RADIUS + 0.05 + (mag - 1.8) * 0.08;
    const [sx, sy, sz] = latLonToSphere(lat, lon, elev);
    const [cr, cg, cb] = depthColor(depth);
    const unmonitored = (i % 9) === 0;
    const stId = unmonitored ? null : ((rid + ((i / 12) | 0) * 12) % STATION_COUNT);
    rows[i] = {
      event_id: i,
      region_id: rid,
      station_id: stId,
      lat,
      lon,
      depth_km: depth,
      mag,
      sx,
      sy,
      sz,
      radius: 0.022 + (mag - 1.8) * 0.011,
      cr,
      cg,
      cb,
      alpha: 0.35 + (mag - 1.8) * 0.10,
    };
  }
  events.insertMany(rows);
  events.createIndex('event_id');
  events.createRangeIndex('mag');
  events.createSpatialIndex('pos3d', ['sx', 'sy', 'sz'], 2.5);

  // 3. Produce initial LZ4 Parquet & .brobundle artifacts so formats are real from frame 1
  const pqLz4Path = path.join(dataDir, 'events_lz4.parquet');
  const bundlePath = path.join(dataDir, 'earth_atlas.brobundle');
  events.saveParquet(pqLz4Path, { compress: 'lz4' });
  q.saveBundle(bundlePath, { events, stations, regions }, { compress: false });

  return {
    dataDir,
    regionsCsvPath,
    stationsCsvPath,
    pqLz4Path,
    bundlePath,
    events,
    stations,
    regions,
    csvBytes: fs.statSync(regionsCsvPath).size + fs.statSync(stationsCsvPath).size,
    lz4ParquetBytes: fs.statSync(pqLz4Path).size,
    bundleBytes: fs.statSync(bundlePath).size,
  };
}
