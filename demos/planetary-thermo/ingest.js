// Pure-JS NOAA GHCN-Daily downloader & columnar .brotable v2 ingester (NO Python).
// Run via bro-headless:
//   bro-headless --grant files,net,spawn demos/planetary-thermo demos/planetary-thermo/ingest.js
// Optional flags: --years 1900,1955,2020  --max-years N  --keep-raw

import {
    downloadIfNeeded,
    streamTextLines,
    parseFitsBinTableHeader,
    TypedBatchFlusher,
} from "/lib/sci-atlas/ingest-common.js";
import { resolveDataDir, resolveDataFile, ensureDir, fmtInt, fmtMs } from "/lib/sci-atlas/data-paths.js";
import {
    THERMO_SCHEMA,
    STATION_SCHEMA,
    latLonToEarth,
    ymdToDoy,
    doyToMonthIndex,
    estimateZonalClimatology,
} from "/app/data.js";

const fs = require('fs');
const path = require('path');

const STATIONS_URL = 'https://noaa-ghcn-pds.s3.amazonaws.com/ghcnd-stations.txt';
const BASE_YEAR_URL = 'https://noaa-ghcn-pds.s3.amazonaws.com/csv.gz/';

const DEFAULT_YEARS = [
    1900, 1905, 1910, 1915, 1920, 1925, 1930, 1935, 1940, 1945,
    1950, 1955, 1960, 1965, 1970, 1975, 1980, 1985, 1990, 1995,
    2000, 2005, 2010, 2015, 2020, 2022,
];

function parseCliOpts() {
    const argv = (globalThis.bro && bro.app && bro.app.argv) || (globalThis.process && process.argv) || [];
    let years = DEFAULT_YEARS.slice();
    let maxYears = 0;
    let keepRaw = false;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--years' && argv[i + 1]) {
            const parsed = argv[++i].split(',').map((s) => parseInt(s.trim(), 10)).filter((y) => y >= 1880 && y <= 2030);
            if (parsed.length > 0) years = parsed;
        } else if (argv[i] === '--max-years' && argv[i + 1]) {
            maxYears = Math.max(1, parseInt(argv[++i], 10) || 0);
        } else if (argv[i] === '--keep-raw') {
            keepRaw = true;
        }
    }
    if (maxYears > 0 && years.length > maxYears) years = years.slice(0, maxYears);
    return { years, keepRaw };
}

// Fast open-addressed typed hash table pairing TMIN & TMAX for (stationIdx, doy) within one year.
class DayPairTable {
    constructor(initPow2 = 20) {
        this.cap = 1 << initPow2;
        this.mask = this.cap - 1;
        this.keys = new Int32Array(this.cap).fill(-1);
        this.tmin = new Int16Array(this.cap);
        this.tmax = new Int16Array(this.cap);
        this.size = 0;
    }

    clear() {
        this.keys.fill(-1);
        this.size = 0;
    }

    _rehash() {
        const oldKeys = this.keys;
        const oldTmin = this.tmin;
        const oldTmax = this.tmax;
        const oldCap = this.cap;
        const newCap = oldCap * 2;
        this.cap = newCap;
        this.mask = newCap - 1;
        this.keys = new Int32Array(newCap).fill(-1);
        this.tmin = new Int16Array(newCap);
        this.tmax = new Int16Array(newCap);
        this.size = 0;
        for (let i = 0; i < oldCap; i++) {
            const k = oldKeys[i];
            if (k < 0) continue;
            let s = (Math.imul(k, 0x9E3779B1) >>> 0) & this.mask;
            while (this.keys[s] >= 0) s = (s + 1) & this.mask;
            this.keys[s] = k;
            this.tmin[s] = oldTmin[i];
            this.tmax[s] = oldTmax[i];
            this.size++;
        }
    }

    put(sid, doy, isMax, valTenths) {
        if (this.size * 10 >= this.cap * 6) this._rehash();
        const key = (sid << 9) | doy;
        let s = (Math.imul(key, 0x9E3779B1) >>> 0) & this.mask;
        while (true) {
            const k = this.keys[s];
            if (k === key) {
                if (isMax) this.tmax[s] = valTenths;
                else this.tmin[s] = valTenths;
                return;
            }
            if (k < 0) {
                this.keys[s] = key;
                if (isMax) { this.tmax[s] = valTenths; this.tmin[s] = -32768; }
                else { this.tmin[s] = valTenths; this.tmax[s] = -32768; }
                this.size++;
                return;
            }
            s = (s + 1) & this.mask;
        }
    }
}

async function loadStations(stationsPath) {
    const idToIdx = new Map();
    const lats = [];
    const lons = [];
    const exs = [];
    const eys = [];
    const ezs = [];

    await streamTextLines(stationsPath, (line) => {
        if (line.length < 30) return;
        const id = line.slice(0, 11).trim();
        const la = parseFloat(line.slice(12, 20));
        const lo = parseFloat(line.slice(21, 30));
        if (!id || !Number.isFinite(la) || !Number.isFinite(lo)) return;
        if (la < -90 || la > 90 || lo < -180 || lo > 180) return;
        if (idToIdx.has(id)) return;
        const idx = lats.length;
        idToIdx.set(id, idx);
        lats.push(la);
        lons.push(lo);
        const e = latLonToEarth(la, lo);
        exs.push(e[0]);
        eys.push(e[1]);
        ezs.push(e[2]);
    });

    return {
        count: lats.length,
        idToIdx,
        lat: Float32Array.from(lats),
        lon: Float32Array.from(lons),
        ex: Float32Array.from(exs),
        ey: Float32Array.from(eys),
        ez: Float32Array.from(ezs),
    };
}

async function streamYearIntoPairs(csvGzPath, stations, pairs) {
    pairs.clear();
    const idToIdx = stations.idToIdx;
    await streamTextLines(csvGzPath, (line, lineIdx) => {
        if (lineIdx === 0 && line.startsWith('ID,')) return;
        const c0 = line.indexOf(',');
        if (c0 < 0) return;
        const c1 = line.indexOf(',', c0 + 1);
        if (c1 < 0) return;
        const c2 = line.indexOf(',', c1 + 1);
        if (c2 < 0) return;

        // Fast check ELEMENT === 'TMAX' or 'TMIN' before allocating substrings
        if (c2 - c1 !== 5) return;
        const e0 = line.charCodeAt(c1 + 1);
        const e1 = line.charCodeAt(c1 + 2);
        const e2 = line.charCodeAt(c1 + 3);
        const e3 = line.charCodeAt(c1 + 4);
        if (e0 !== 84 || e1 !== 77) return; // 'TM'
        let isMax = false;
        if (e2 === 65 && e3 === 88) isMax = true;       // 'AX'
        else if (e2 === 73 && e3 === 78) isMax = false; // 'IN'
        else return;

        const c3 = line.indexOf(',', c2 + 1);
        if (c3 < 0) return;
        const c4 = line.indexOf(',', c3 + 1);
        if (c4 >= 0) {
            const c5 = line.indexOf(',', c4 + 1);
            const qEnd = c5 >= 0 ? c5 : line.length;
            // Skip rows with non-empty Q_FLAG
            for (let p = c4 + 1; p < qEnd; p++) {
                if (line.charCodeAt(p) > 32) return;
            }
        }

        const val = parseInt(line.slice(c2 + 1, c3), 10);
        if (!Number.isFinite(val) || val === -9999 || val < -900 || val > 650) return;

        const id = line.slice(0, c0).trim();
        const sid = idToIdx.get(id);
        if (sid === undefined) return;

        if (c1 - c0 !== 9) return; // YYYYMMDD
        const ymd = line.slice(c0 + 1, c1);
        const yr = parseInt(ymd.slice(0, 4), 10);
        const mo = parseInt(ymd.slice(4, 6), 10);
        const da = parseInt(ymd.slice(6, 8), 10);
        if (!(yr >= 1880 && yr <= 2030 && mo >= 1 && mo <= 12 && da >= 1 && da <= 31)) return;

        const doy = ymdToDoy(yr, mo, da);
        pairs.put(sid, doy, isMax, val);
    });
}

const COL_SPEC = [
    { name: 'ord', kind: 'u32' },
    { name: 'ex', kind: 'f32' },
    { name: 'ey', kind: 'f32' },
    { name: 'ez', kind: 'f32' },
    { name: 'lat', kind: 'f32' },
    { name: 'lon', kind: 'f32' },
    { name: 'year', kind: 'i32' },
    { name: 'doy', kind: 'i32' },
    { name: 'decade', kind: 'i32' },
    { name: 'tmin_c', kind: 'f32' },
    { name: 'tmax_c', kind: 'f32' },
    { name: 'anom_c', kind: 'f32' },
];

async function runIngest() {
    void parseFitsBinTableHeader;
    const app = globalThis.__thermoApp;
    if (app) {
        try { app.rpc?.terminate?.(); } catch (_) {}
        try { app.snap?.close?.(); } catch (_) {}
    }
    const { years, keepRaw } = parseCliOpts();
    const tStart = Date.now();

    const dataDir = resolveDataDir();
    const rawDir = path.join(dataDir, 'raw-noaa-ghcn');
    ensureDir(rawDir);

    const stationsPath = downloadIfNeeded(
        STATIONS_URL,
        path.join(rawDir, 'ghcnd-stations.txt'),
        'NOAA GHCN-Daily stations catalog'
    );
    const stations = await loadStations(stationsPath);
    console.log(`[ingest] loaded ${fmtInt(stations.count)} stations`);

    const yearFiles = new Map();
    const downloadedTemp = [];
    for (const yr of years) {
        const dest = path.join(rawDir, `${yr}.csv.gz`);
        const existed = fs.existsSync(dest) && fs.statSync(dest).size > 256;
        downloadIfNeeded(`${BASE_YEAR_URL}${yr}.csv.gz`, dest, `GHCN-Daily ${yr}.csv.gz`);
        yearFiles.set(yr, dest);
        if (!existed) downloadedTemp.push(dest);
    }

    const pairs = new DayPairTable(21);
    const stSum = new Float64Array(stations.count * 12);
    const stCnt = new Int32Array(stations.count * 12);
    const zonalSum = new Float64Array(36 * 12);
    const zonalCnt = new Int32Array(36 * 12);

    const refYears = years.filter((y) => y >= 1951 && y <= 1980);
    if (refYears.length > 0) {
        console.log(`[ingest] computing 1951-1980 station & zonal baselines from [${refYears.join(', ')}]...`);
        for (const yr of refYears) {
            await streamYearIntoPairs(yearFiles.get(yr), stations, pairs);
            for (let s = 0; s < pairs.cap; s++) {
                const k = pairs.keys[s];
                if (k < 0) continue;
                const tmin10 = pairs.tmin[s];
                const tmax10 = pairs.tmax[s];
                if (tmin10 === -32768 || tmax10 === -32768 || tmin10 > tmax10) continue;
                const sid = k >>> 9;
                const doy = k & 511;
                const mo = doyToMonthIndex(yr, doy);
                const tmean = (tmin10 + tmax10) * 0.05;
                stSum[sid * 12 + mo] += tmean;
                stCnt[sid * 12 + mo]++;
                const zb = Math.max(0, Math.min(35, Math.floor((stations.lat[sid] + 90.0) / 5.0)));
                zonalSum[zb * 12 + mo] += tmean;
                zonalCnt[zb * 12 + mo]++;
            }
        }
    }

    const tbl = bro.table.create(THERMO_SCHEMA);
    const flusher = new TypedBatchFlusher(tbl, 65536, COL_SPEC);
    const arr = flusher.arrays;
    const stObsCount = new Int32Array(stations.count);
    const stAnomSum = new Float64Array(stations.count);
    let ordCounter = 0;

    for (const yr of years) {
        await streamYearIntoPairs(yearFiles.get(yr), stations, pairs);
        const dec = Math.floor(yr / 10) * 10;
        let yrRows = 0;
        for (let s = 0; s < pairs.cap; s++) {
            const k = pairs.keys[s];
            if (k < 0) continue;
            const tmin10 = pairs.tmin[s];
            const tmax10 = pairs.tmax[s];
            if (tmin10 === -32768 || tmax10 === -32768 || tmin10 > tmax10) continue;

            const sid = k >>> 9;
            const doy = k & 511;
            const mo = doyToMonthIndex(yr, doy);
            const tminC = tmin10 * 0.1;
            const tmaxC = tmax10 * 0.1;
            const tmeanC = 0.5 * (tminC + tmaxC);
            const la = stations.lat[sid];

            const stIdx = sid * 12 + mo;
            let baseC;
            if (stCnt[stIdx] >= 5) {
                baseC = stSum[stIdx] / stCnt[stIdx];
            } else {
                const zb = Math.max(0, Math.min(35, Math.floor((la + 90.0) / 5.0))) * 12 + mo;
                baseC = zonalCnt[zb] >= 5
                    ? zonalSum[zb] / zonalCnt[zb]
                    : estimateZonalClimatology(la, doy).tMean;
            }

            const anomC = tmeanC - baseC;
            if (Math.abs(anomC) > 25.0) continue;

            const p = flusher.len;
            arr.ord[p] = ordCounter++;
            arr.ex[p] = stations.ex[sid];
            arr.ey[p] = stations.ey[sid];
            arr.ez[p] = stations.ez[sid];
            arr.lat[p] = la;
            arr.lon[p] = stations.lon[sid];
            arr.year[p] = yr;
            arr.doy[p] = doy;
            arr.decade[p] = dec;
            arr.tmin_c[p] = tminC;
            arr.tmax_c[p] = tmaxC;
            arr.anom_c[p] = anomC;
            stObsCount[sid]++;
            stAnomSum[sid] += anomC;
            flusher.len = p + 1;
            if (flusher.len >= flusher.batchSize) flusher.flush();
            yrRows++;
        }
        flusher.flush();
        console.log(`[ingest] year ${yr}: +${fmtInt(yrRows)} paired station-days (total ${fmtInt(ordCounter)})`);
    }

    // Release companion mmap if open before atomic replace
    if (app) {
        try { app.dataset?.stationsSnap?.close?.(); } catch (_) {}
    }

    // Release large intermediate hash buffers before tbl.save() serializes snapshot
    pairs.keys = null;
    pairs.tmin = null;
    pairs.tmax = null;

    // Zero heap indexes on the massive 50M-60M row observation archive (pure OS mmap + AVX2 SIMD);
    // spatial queries use the companion noaa-stations.brotable SpatialIndex('earth3d').
    const outFile = resolveDataFile('noaa-ghcn.brotable');
    console.log(`[ingest] saving ${fmtInt(tbl.rowCount)} obs (zero-heap-index mmap + AVX2) to ${outFile}...`);
    tbl.save(outFile);

    let activeSt = 0;
    for (let s = 0; s < stations.count; s++) if (stObsCount[s] > 0) activeSt++;
    const sSid = new Uint32Array(activeSt);
    const sEx = new Float32Array(activeSt), sEy = new Float32Array(activeSt), sEz = new Float32Array(activeSt);
    const sLat = new Float32Array(activeSt), sLon = new Float32Array(activeSt);
    const sCnt = new Int32Array(activeSt), sMean = new Float32Array(activeSt);
    let si = 0;
    for (let s = 0; s < stations.count; s++) {
        if (stObsCount[s] <= 0) continue;
        sSid[si] = s;
        sEx[si] = stations.ex[s]; sEy[si] = stations.ey[s]; sEz[si] = stations.ez[s];
        sLat[si] = stations.lat[s]; sLon[si] = stations.lon[s];
        sCnt[si] = stObsCount[s];
        sMean[si] = stAnomSum[s] / stObsCount[s];
        si++;
    }
    const stTbl = bro.table.create(STATION_SCHEMA);
    stTbl.insertMany({ sid: sSid, ex: sEx, ey: sEy, ez: sEz, lat: sLat, lon: sLon, obs_count: sCnt, mean_anom: sMean });
    stTbl.createSpatialIndex('earth3d', ['ex', 'ey', 'ez'], 0.08);
    const stOutFile = resolveDataFile('noaa-stations.brotable');
    stTbl.save(stOutFile);
    console.log(`[ingest] saved ${fmtInt(stTbl.rowCount)} stations (SpatialIndex earth3d) -> ${stOutFile}`);

    if (!keepRaw) {
        for (const p of downloadedTemp) {
            try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {}
        }
    }
    const st = tbl.stats();
    console.log(`[ingest] COMPLETE in ${fmtMs(Date.now() - tStart)}: ${fmtInt(st.rowCount)} rows, ${(st.totalBytes / 1e6).toFixed(1)} MB`);
}

await runIngest();
