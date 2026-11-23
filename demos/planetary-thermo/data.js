// NOAA GHCN-Daily dataset loader + realistic 150k-row 125-year planetary thermodynamic synthesizer.
// Uses real zero-copy bro.table.mmap(noaa-ghcn.brotable) when ingested, else synthesizes
// 1900-2025 global land/ocean meteorological station observations with Arctic amplification,
// ENSO plumes, volcanic cooling dips, and diurnal temperature cycles.

import { hasRealDataFile, resolveDataFile } from "/lib/sci-atlas/data-paths.js";

export const THERMO_SCHEMA = {
    ord: 'u32',
    ex: 'f32',
    ey: 'f32',
    ez: 'f32',
    lat: 'f32',
    lon: 'f32',
    year: 'i32',
    doy: 'i32',
    decade: 'i32',
    tmin_c: 'f32',
    tmax_c: 'f32',
    anom_c: 'f32',
};

export const STATION_SCHEMA = {
    sid: 'u32',
    ex: 'f32',
    ey: 'f32',
    ez: 'f32',
    lat: 'f32',
    lon: 'f32',
    obs_count: 'i32',
    mean_anom: 'f32',
};

export const GPU_COLS = [
    'ex', 'ey', 'ez', 'anom_c', 'year', 'doy', 'tmin_c', 'tmax_c', 'lat',
];

export const EARTH_RADIUS_KM = 6371.0;

export const CLIMATE_HOTSPOTS = [
    { name: 'Svalbard Arctic Station (78°N, 16°E)', lat: 78.2, lon: 15.6 },
    { name: 'Central Europe / Paris-Berlin (49°N, 9°E)', lat: 49.0, lon: 9.0 },
    { name: 'Niño-3.4 Equatorial Pacific (0°N, 140°W)', lat: 0.0, lon: -140.0 },
    { name: 'North American Great Plains (42°N, 96°W)', lat: 42.0, lon: -96.0 },
    { name: 'Siberian Permafrost / Yakutsk (62°N, 129°E)', lat: 62.0, lon: 129.7 },
    { name: 'Amazon Basin (3°S, 60°W)', lat: -3.1, lon: -60.0 },
    { name: 'East Antarctica Dome (75°S, 106°E)', lat: -75.0, lon: 106.0 },
];

// Simplified continental coastlines [lat, lon] for clean 3D globe vector graticule overlay
export const CONTINENT_COASTLINES = [
    // North America
    [[71, -156], [69, -135], [68, -95], [62, -78], [52, -56], [44, -66], [35, -75], [25, -80],
     [29, -95], [20, -96], [15, -84], [8, -79], [16, -98], [24, -108], [33, -118], [48, -125],
     [59, -140], [60, -165], [66, -168], [71, -156]],
    // Greenland
    [[82, -32], [76, -18], [68, -32], [60, -44], [69, -54], [78, -68], [82, -32]],
    // South America
    [[11, -74], [10, -62], [5, -52], [-1, -48], [-6, -35], [-22, -40], [-35, -56], [-46, -66],
     [-55, -68], [-45, -75], [-33, -72], [-18, -71], [-5, -81], [4, -77], [11, -74]],
    // Africa
    [[36, -6], [37, 10], [31, 32], [13, 44], [11, 51], [-2, 41], [-16, 40], [-26, 33],
     [-35, 20], [-22, 14], [-6, 12], [5, 8], [5, -8], [15, -17], [28, -13], [36, -6]],
    // Europe + Eurasia + Asia
    [[36, -9], [43, -9], [44, -2], [49, 2], [54, 8], [58, 5], [70, 20], [69, 44], [73, 72],
     [76, 105], [72, 138], [66, 172], [60, 162], [52, 140], [41, 129], [35, 121], [22, 114],
     [10, 105], [2, 103], [16, 96], [22, 91], [8, 77], [23, 68], [26, 56], [14, 48],
     [31, 34], [38, 27], [40, 20], [44, 13], [40, 16], [42, 3], [36, -9]],
    // Australia
    [[-12, 130], [-12, 137], [-18, 146], [-28, 153], [-38, 148], [-35, 136], [-32, 125],
     [-34, 115], [-22, 114], [-15, 124], [-12, 130]],
    // Antarctica
    [[-66, -60], [-72, -30], [-70, 0], [-68, 40], [-67, 80], [-66, 120], [-72, 165],
     [-75, -140], [-73, -95], [-66, -60]],
];

export function latLonToEarth(latDeg, lonDeg) {
    const rad = Math.PI / 180.0;
    const lat = latDeg * rad;
    const lon = lonDeg * rad;
    const cl = Math.cos(lat);
    return [cl * Math.cos(lon), Math.sin(lat), cl * Math.sin(lon)];
}

const MDAYS_NORM = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
const MDAYS_LEAP = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function isLeapYear(y) {
    return (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
}

export function ymdToDoy(year, month, day) {
    const tbl = isLeapYear(year) ? MDAYS_LEAP : MDAYS_NORM;
    const m = Math.max(1, Math.min(12, month | 0));
    return tbl[m - 1] + Math.max(1, Math.min(31, day | 0));
}

export function doyToMonthIndex(year, doy) {
    const tbl = isLeapYear(year) ? MDAYS_LEAP : MDAYS_NORM;
    for (let m = 11; m >= 0; m--) {
        if (doy > tbl[m]) return m;
    }
    return 0;
}

export function doyToLabel(year, doy) {
    const tbl = isLeapYear(year) ? MDAYS_LEAP : MDAYS_NORM;
    const m = doyToMonthIndex(year, doy);
    const day = Math.max(1, doy - tbl[m]);
    return `${MONTH_NAMES[m]} ${day}`;
}

export function estimateZonalClimatology(latDeg, doy) {
    const absLat = Math.abs(latDeg);
    const latRad = absLat * (Math.PI / 180.0);
    // Annual mean surface air temp from ~27C equator to ~-24C poles
    const tAnnual = 27.2 * Math.pow(Math.cos(latRad), 1.35) - 24.0 * Math.pow(Math.sin(latRad), 3.6);
    // Seasonal amplitude peaks at mid-to-high latitudes; opposite phase in SH
    const phaseShift = latDeg >= 0 ? 198.0 : 16.0;
    const amp = 2.0 + 18.5 * Math.sin(latRad);
    const tSeason = amp * Math.cos(((doy - phaseShift) / 365.25) * Math.PI * 2.0);
    const dtr = 6.5 + 4.5 * Math.sin(latRad * 1.4);
    return { tMean: tAnnual + tSeason, dtr };
}

// Historical 1900-2025 global land/ocean mean anomaly trajectory (deg C vs 1951-1980)
export function historicalGlobalSignal(year) {
    if (year < 1915) return -0.28 + (year - 1900) * 0.003;
    if (year < 1945) return -0.24 + ((year - 1915) / 30.0) * 0.27;
    if (year < 1976) return 0.03 - ((year - 1945) / 31.0) * 0.05;
    const dt = (year - 1976) / 49.0;
    return -0.02 + 1.08 * Math.pow(dt, 1.30);
}

function makeRng(seed) {
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

// Realistic global weather station distribution lobes [latCenter, lonCenter, latSpread, lonSpread, weight, aridity]
const STATION_REGIONS = [
    [39.0, -89.0, 5.5, 9.5, 0.14, 1.20],    // Eastern & Central US
    [41.0, -113.0, 5.5, 6.5, 0.07, 1.38],   // Western US & Plains
    [53.0, -104.0, 4.5, 13.0, 0.04, 1.18],  // Southern Canada
    [64.0, -148.0, 3.2, 11.0, 0.025, 1.12], // Alaska / Yukon
    [22.0, -101.0, 4.0, 4.5, 0.02, 1.25],   // Mexico / Central America
    [49.0, 10.0, 4.5, 9.0, 0.14, 0.95],     // Western & Central Europe
    [54.0, -2.0, 2.5, 3.0, 0.03, 0.78],     // British Isles
    [62.0, 17.0, 3.8, 6.5, 0.04, 0.86],     // Scandinavia
    [56.0, 45.0, 4.5, 11.0, 0.05, 1.18],    // European Russia
    [57.0, 86.0, 5.5, 18.0, 0.05, 1.32],    // Siberia
    [63.0, 128.0, 4.5, 16.0, 0.03, 1.35],   // Far East Russia / Yakutia
    [35.0, 113.0, 5.5, 9.0, 0.07, 1.05],    // East China
    [36.0, 138.0, 3.0, 2.5, 0.025, 0.85],   // Japan
    [21.0, 78.0, 5.5, 5.0, 0.04, 1.15],     // India
    [14.0, 103.0, 5.5, 6.5, 0.025, 0.80],   // SE Asia
    [26.0, 12.0, 6.0, 14.0, 0.025, 1.55],   // North Africa / Sahara
    [-2.0, 25.0, 7.5, 9.0, 0.02, 1.02],     // Equatorial Africa
    [-25.0, 24.0, 4.5, 5.0, 0.02, 1.30],    // Southern Africa
    [-6.0, -56.0, 7.5, 8.5, 0.035, 0.82],   // Amazon / Brazil
    [-32.0, -64.0, 6.5, 4.5, 0.025, 1.15],  // Southern Cone / Pampas
    [-26.0, 136.0, 5.5, 11.0, 0.045, 1.45], // Australia
    [76.0, 20.0, 3.2, 22.0, 0.035, 0.92],   // Svalbard / Barents Arctic
    [71.0, -42.0, 4.0, 9.0, 0.015, 1.00],   // Greenland
    [-51.0, -59.0, 3.5, 8.0, 0.010, 0.75],  // Falklands / South Atlantic islands
    [-46.0, 168.0, 3.5, 5.0, 0.015, 0.85],  // New Zealand / Southern Ocean
    [-72.0, 35.0, 4.5, 48.0, 0.015, 1.05],  // Antarctica coast
    [0.0, -140.0, 3.2, 24.0, 0.025, 0.55],  // Equatorial Pacific (Niño-3.4 buoys)
];

function buildStationCatalog(rng, count) {
    const cumW = [];
    let totalW = 0;
    for (const r of STATION_REGIONS) {
        totalW += r[4];
        cumW.push(totalW);
    }

    const lat = new Float32Array(count);
    const lon = new Float32Array(count);
    const ex = new Float32Array(count);
    const ey = new Float32Array(count);
    const ez = new Float32Array(count);
    const dtrScale = new Float32Array(count);
    const bias = new Float32Array(count);

    for (let i = 0; i < count; i++) {
        const u = rng.rand() * totalW;
        let ri = 0;
        while (ri < cumW.length - 1 && u > cumW[ri]) ri++;
        const reg = STATION_REGIONS[ri];
        let la = reg[0] + rng.gauss() * reg[2];
        let lo = reg[1] + rng.gauss() * reg[3];
        la = Math.max(-86.0, Math.min(85.0, la));
        while (lo > 180.0) lo -= 360.0;
        while (lo < -180.0) lo += 360.0;

        lat[i] = la;
        lon[i] = lo;
        const p = latLonToEarth(la, lo);
        ex[i] = p[0];
        ey[i] = p[1];
        ez[i] = p[2];
        dtrScale[i] = Math.max(0.45, Math.min(1.75, reg[5] + rng.gauss() * 0.16));
        bias[i] = rng.gauss() * 1.4;
    }
    return { count, lat, lon, ex, ey, ez, dtrScale, bias };
}

function generateSample() {
    const N = 150000;
    const t0 = performance.now();
    const rng = makeRng(20250915);

    const stations = buildStationCatalog(rng, 12000);

    const ord = new Uint32Array(N);
    const ex = new Float32Array(N);
    const ey = new Float32Array(N);
    const ez = new Float32Array(N);
    const lat = new Float32Array(N);
    const lon = new Float32Array(N);
    const year = new Int32Array(N);
    const doy = new Int32Array(N);
    const decade = new Int32Array(N);
    const tmin_c = new Float32Array(N);
    const tmax_c = new Float32Array(N);
    const anom_c = new Float32Array(N);

    const elNinoYears = new Set([1941, 1958, 1966, 1973, 1983, 1998, 2016, 2023, 2024]);
    const laNinaYears = new Set([1917, 1955, 1974, 1989, 1999, 2011, 2021, 2022]);
    const volcanicYears = new Set([1903, 1912, 1963, 1982, 1991, 1992]);

    const stObsCount = new Int32Array(stations.count);
    const stAnomSum = new Float64Array(stations.count);

    for (let i = 0; i < N; i++) {
        ord[i] = i;
        const sid = (rng.rand() * stations.count) | 0;
        const la = stations.lat[sid];
        const lo = stations.lon[sid];
        ex[i] = stations.ex[sid];
        ey[i] = stations.ey[sid];
        ez[i] = stations.ez[sid];
        lat[i] = la;
        lon[i] = lo;

        // Weighted slightly toward post-1950 while ensuring every decade 1900..2020 has thousands of obs
        let yr;
        if (rng.rand() < 0.30) {
            yr = 1900 + ((rng.rand() * 50) | 0);
        } else {
            yr = 1950 + ((rng.rand() * 76) | 0);
        }
        if (yr > 2025) yr = 2025;
        const dy = 1 + ((rng.rand() * (isLeapYear(yr) ? 366 : 365)) | 0);

        year[i] = yr;
        doy[i] = dy;
        decade[i] = Math.floor(yr / 10) * 10;

        // Global climate signal + asymmetric Arctic Amplification + ENSO + synoptic variability
        const gSig = historicalGlobalSignal(yr);
        let latAmp = 1.0;
        if (la > 60.0) {
            latAmp = 2.4 + ((la - 60.0) / 30.0) * 1.4;
        } else if (la > 35.0) {
            latAmp = 1.15 + ((la - 35.0) / 25.0) * 1.25;
        } else if (la < -55.0) {
            latAmp = 0.85;
        } else {
            latAmp = 0.78 + 0.35 * Math.abs(la) / 45.0;
        }

        let enso = 0.0;
        const isEqPac = Math.abs(la) < 12.0 && lo < -85.0 && lo > -175.0;
        if (elNinoYears.has(yr)) {
            enso = isEqPac ? (2.2 + rng.rand() * 1.6) : 0.45;
        } else if (laNinaYears.has(yr)) {
            enso = isEqPac ? (-1.9 - rng.rand() * 1.2) : -0.30;
        }
        if (volcanicYears.has(yr)) enso -= 0.55;

        // Synoptic weather noise + synoptic tail extremes (heatwaves & polar blasts)
        const latNoise = 1.05 + 1.45 * Math.sin(Math.abs(la) * Math.PI / 180.0);
        let synoptic = rng.gauss() * latNoise;
        const tailPick = rng.rand();
        if (tailPick < 0.025 && yr >= 1980 && la > 25.0) {
            synoptic += 4.2 + rng.rand() * 4.5; // Heatwave dome
        } else if (tailPick > 0.978 && la > 35.0) {
            synoptic -= 4.3 + rng.rand() * 4.2; // Polar vortex blast
        }

        const anom = Math.max(-13.5, Math.min(13.5, gSig * latAmp + enso + synoptic));
        const clim = estimateZonalClimatology(la, dy);
        const tMean = clim.tMean + stations.bias[sid] + anom;
        const dtr = Math.max(2.0, clim.dtr * stations.dtrScale[sid] + rng.gauss() * 1.3);

        tmin_c[i] = tMean - 0.5 * dtr;
        tmax_c[i] = tMean + 0.5 * dtr;
        anom_c[i] = anom;
        stObsCount[sid]++;
        stAnomSum[sid] += anom;
    }

    const tbl = bro.table.create(THERMO_SCHEMA);
    tbl.insertMany({
        ord, ex, ey, ez, lat, lon, year, doy, decade, tmin_c, tmax_c, anom_c,
    });

    const stCount = stations.count;
    const stSid = new Uint32Array(stCount);
    const stMean = new Float32Array(stCount);
    for (let s = 0; s < stCount; s++) {
        stSid[s] = s;
        stMean[s] = stObsCount[s] > 0 ? (stAnomSum[s] / stObsCount[s]) : 0.0;
    }
    const stTbl = bro.table.create(STATION_SCHEMA);
    stTbl.insertMany({
        sid: stSid,
        ex: stations.ex,
        ey: stations.ey,
        ez: stations.ez,
        lat: stations.lat,
        lon: stations.lon,
        obs_count: stObsCount,
        mean_anom: stMean,
    });
    stTbl.createSpatialIndex('earth3d', ['ex', 'ey', 'ez'], 0.08);

    return {
        isReal: false,
        table: tbl,
        snap: tbl.snapshot(),
        stationsTable: stTbl,
        stationsSnap: stTbl.snapshot(),
        buildMs: performance.now() - t0,
    };
}

function buildFallbackStationCatalogFromObs(obsSnap) {
    const seen = new Map();
    const nChunks = obsSnap.chunkCount;
    const step = Math.max(1, Math.floor(obsSnap.rowCount / 120000));
    const list = [];
    for (let ci = 0; ci < nChunks; ci++) {
        const rc = obsSnap.chunkRowCount(ci);
        const cLat = obsSnap.chunkColumnView(ci, 'lat');
        const cLon = obsSnap.chunkColumnView(ci, 'lon');
        const cEx = obsSnap.chunkColumnView(ci, 'ex');
        const cEy = obsSnap.chunkColumnView(ci, 'ey');
        const cEz = obsSnap.chunkColumnView(ci, 'ez');
        const cAnom = obsSnap.chunkColumnView(ci, 'anom_c');
        for (let r = 0; r < rc; r += step) {
            const k = `${cLat[r].toFixed(2)},${cLon[r].toFixed(2)}`;
            let rec = seen.get(k);
            if (!rec) {
                rec = { ex: cEx[r], ey: cEy[r], ez: cEz[r], lat: cLat[r], lon: cLon[r], cnt: 0, sum: 0 };
                seen.set(k, rec);
                list.push(rec);
            }
            rec.cnt++;
            rec.sum += cAnom[r];
        }
    }
    const M = list.length;
    const sid = new Uint32Array(M);
    const ex = new Float32Array(M), ey = new Float32Array(M), ez = new Float32Array(M);
    const lat = new Float32Array(M), lon = new Float32Array(M);
    const obs_count = new Int32Array(M), mean_anom = new Float32Array(M);
    for (let i = 0; i < M; i++) {
        const rec = list[i];
        sid[i] = i;
        ex[i] = rec.ex; ey[i] = rec.ey; ez[i] = rec.ez;
        lat[i] = rec.lat; lon[i] = rec.lon;
        obs_count[i] = rec.cnt;
        mean_anom[i] = rec.cnt > 0 ? (rec.sum / rec.cnt) : 0.0;
    }
    const stTbl = bro.table.create(STATION_SCHEMA);
    stTbl.insertMany({ sid, ex, ey, ez, lat, lon, obs_count, mean_anom });
    stTbl.createSpatialIndex('earth3d', ['ex', 'ey', 'ez'], 0.08);
    return stTbl.snapshot();
}

export function loadThermoDataset() {
    if (hasRealDataFile('noaa-ghcn.brotable')) {
        const path = resolveDataFile('noaa-ghcn.brotable');
        const t0 = performance.now();
        const snap = bro.table.mmap(path);
        const stationsSnap = hasRealDataFile('noaa-stations.brotable')
            ? bro.table.mmap(resolveDataFile('noaa-stations.brotable'))
            : buildFallbackStationCatalogFromObs(snap);
        return {
            isReal: true,
            path,
            table: null,
            snap,
            stationsTable: null,
            stationsSnap,
            buildMs: performance.now() - t0,
        };
    }
    return generateSample();
}
