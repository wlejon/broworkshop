// Pure-JS Gaia DR3 6D phase-space downloader & columnar .brotable v2 ingester.
// Run via bro-headless (NO Python):
//   bro-headless --grant files,net,spawn demos/gaia-phase-space demos/gaia-phase-space/ingest.js
// Optional CLI flags after script: --max-slices N (default 16, 22.5 deg RA bands), --top N (default 350000), --keep-raw

import {
    streamTextLines,
    parseFitsBinTableHeader,
    TypedBatchFlusher,
} from "/lib/sci-atlas/ingest-common.js";
import { resolveDataDir, resolveDataFile, ensureDir } from "/lib/sci-atlas/data-paths.js";
import { GAIA_SCHEMA, icrsToGalactocentric, estimateTeff, classifyPopulation } from "/app/data.js";

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

function parseCliOpts() {
    const argv = (globalThis.bro && bro.app && bro.app.argv) || (globalThis.process && process.argv) || [];
    let maxSlices = 16;
    let topPerSlice = 350000;
    let keepRaw = false;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--max-slices' && argv[i + 1]) maxSlices = Math.max(1, Math.min(16, parseInt(argv[++i], 10) || 16));
        else if (argv[i] === '--top' && argv[i + 1]) topPerSlice = Math.max(100, parseInt(argv[++i], 10) || 350000);
        else if (argv[i] === '--keep-raw') keepRaw = true;
    }
    return { maxSlices, topPerSlice, keepRaw };
}

function waitRealMs(ms) {
    const secs = Math.max(1, Math.round(ms / 1000));
    cp.spawnSync('ping.exe', ['-n', String(secs + 1), '127.0.0.1'], { stdio: 'ignore' });
}

function buildTapAdql(raMin, raMax, topN) {
    return (
        `SELECT TOP ${topN} ` +
        `ra,dec,parallax,pmra,pmdec,radial_velocity,phot_g_mean_mag,bp_rp,teff_gspphot,mh_gspphot ` +
        `FROM gaiadr3.gaia_source ` +
        `WHERE radial_velocity IS NOT NULL AND parallax_over_error > 5 AND bp_rp IS NOT NULL ` +
        `AND ra >= ${raMin} AND ra < ${raMax}`
    );
}

function downloadGaiaAsyncSlice(adql, destPath, label) {
    if (fs.existsSync(destPath) && fs.statSync(destPath).size > 256) {
        console.log(`[download] cached ${label} (${(fs.statSync(destPath).size / 1e6).toFixed(1)} MB)`);
        return destPath;
    }
    const asyncEndpoint = 'https://gea.esac.esa.int/tap-server/tap/async';
    const tmpPath = destPath + '.part';
    let lastErr = null;

    for (let attempt = 1; attempt <= 4; attempt++) {
        if (fs.existsSync(tmpPath)) {
            try { fs.unlinkSync(tmpPath); } catch (_) {}
        }
        let jobUrl = '';
        try {
            console.log(`[download] submitting UWS async job (attempt ${attempt}/4): ${label}`);
            const submitRes = cp.spawnSync('curl.exe', [
                '--http1.1', '--max-time', '60',
                '-sS', '-i', '-X', 'POST', asyncEndpoint,
                '--data-urlencode', 'REQUEST=doQuery',
                '--data-urlencode', 'LANG=ADQL',
                '--data-urlencode', 'FORMAT=csv',
                '--data-urlencode', 'PHASE=RUN',
                '--data-urlencode', 'MAXREC=3000000',
                '--data-urlencode', 'QUERY=' + adql,
            ], { encoding: 'utf-8', maxBuffer: 4 * 1024 * 1024 });

            if (submitRes.status !== 0) {
                throw new Error(`Gaia TAP async submit failed (${submitRes.status}): ${(submitRes.stderr || '').slice(0, 300)}`);
            }
            const hdrText = (submitRes.stdout || '') + '\n' + (submitRes.stderr || '');
            const mLoc = /^location:\s*(\S+)/im.exec(hdrText);
            if (!mLoc) {
                throw new Error(`Gaia TAP async missing Location header for ${label}: ${hdrText.slice(0, 400)}`);
            }
            jobUrl = mLoc[1].trim();
            console.log(`[download] job=${jobUrl}`);

            const deadline = Date.now() + 300000;
            let phase = 'UNKNOWN';
            while (Date.now() < deadline) {
                const phRes = cp.spawnSync('curl.exe', ['--http1.1', '--max-time', '30', '-sS', jobUrl + '/phase'], { encoding: 'utf-8' });
                phase = (phRes.stdout || '').trim().toUpperCase();
                if (phase === 'COMPLETED') break;
                if (phase === 'ERROR' || phase === 'ABORTED') {
                    const errRes = cp.spawnSync('curl.exe', ['-sS', jobUrl + '/error'], { encoding: 'utf-8' });
                    throw new Error(`Gaia TAP job ${phase} (${jobUrl}): ${(errRes.stdout || errRes.stderr || '').slice(0, 500)}`);
                }
                waitRealMs(2000);
            }
            if (phase !== 'COMPLETED') {
                throw new Error(`Gaia TAP job timed out after 300s (last phase=${phase}): ${jobUrl}`);
            }

            console.log(`[download] fetching result CSV: ${label}`);
            const dlRes = cp.spawnSync('curl.exe', [
                '--http1.1', '--speed-limit', '2000', '--speed-time', '45', '--max-time', '300',
                '-L', '--fail', '--compressed', '--retry', '3', '--retry-delay', '3', '--retry-all-errors',
                '-o', tmpPath, jobUrl + '/results/result',
            ], { stdio: 'inherit' });
            if (dlRes.status !== 0) {
                throw new Error(`Gaia TAP result download failed (${dlRes.status}) for ${jobUrl}`);
            }
            if (!fs.existsSync(tmpPath) || fs.statSync(tmpPath).size <= 256) {
                throw new Error(`Gaia TAP downloaded empty file for ${jobUrl}`);
            }
            if (fs.existsSync(destPath)) {
                try { fs.unlinkSync(destPath); } catch (_) {}
            }
            fs.renameSync(tmpPath, destPath);
            try { cp.spawnSync('curl.exe', ['-s', '-X', 'DELETE', jobUrl], { stdio: 'ignore' }); } catch (_) {}
            console.log(`[download] saved ${path.basename(destPath)} (${(fs.statSync(destPath).size / 1e6).toFixed(1)} MB)`);
            return destPath;
        } catch (err) {
            lastErr = err;
            console.warn(`[download] attempt ${attempt}/4 failed for ${label}: ${err.message}`);
            if (jobUrl) {
                try { cp.spawnSync('curl.exe', ['-s', '-X', 'DELETE', jobUrl], { stdio: 'ignore' }); } catch (_) {}
            }
            if (attempt < 4) waitRealMs(4000);
        }
    }
    throw lastErr;
}

const COL_SPEC = [
    { name: 'ord', kind: 'u32' },
    { name: 'gx', kind: 'f32' },
    { name: 'gy', kind: 'f32' },
    { name: 'gz', kind: 'f32' },
    { name: 'vx', kind: 'f32' },
    { name: 'vy', kind: 'f32' },
    { name: 'vz', kind: 'f32' },
    { name: 'v_phi', kind: 'f32' },
    { name: 'v_perp', kind: 'f32' },
    { name: 'bp_rp', kind: 'f32' },
    { name: 'mg', kind: 'f32' },
    { name: 'fe_h', kind: 'f32' },
    { name: 'teff', kind: 'f32' },
    { name: 'pop', kind: 'i32' },
];

async function runIngest() {
    const { maxSlices, topPerSlice, keepRaw } = parseCliOpts();
    void parseFitsBinTableHeader;
    const app = globalThis.__gaiaApp;
    if (app) {
        try { app.rpc?.terminate?.(); } catch (_) {}
        try { app.snap?.close?.(); } catch (_) {}
    }

    const dataDir = resolveDataDir();
    const rawDir = path.join(dataDir, 'raw-gaia-dr3');
    ensureDir(rawDir);

    const outFile = resolveDataFile('gaia-dr3.brotable');
    const tbl = bro.table.create(GAIA_SCHEMA);
    const flusher = new TypedBatchFlusher(tbl, 65536, COL_SPEC);
    const arr = flusher.arrays;

    let ordCounter = 0;
    let skipped = 0;
    const downloadedTemp = [];
    const tStart = Date.now();

    for (let s = 0; s < maxSlices; s++) {
        const raMin = s * 22.5;
        const raMax = (s + 1) * 22.5;
        const csvPath = path.join(rawDir, `gaia_dr3_ra_${String(s).padStart(2, '0')}.csv`);
        const existed = fs.existsSync(csvPath) && fs.statSync(csvPath).size > 256;
        downloadGaiaAsyncSlice(
            buildTapAdql(raMin, raMax, topPerSlice),
            csvPath,
            `Gaia DR3 slice ${s + 1}/${maxSlices} [RA ${raMin}..${raMax}]`
        );
        if (!existed) downloadedTemp.push(csvPath);

        let colMap = null;
        await streamTextLines(csvPath, (line, idx) => {
            const parts = line.split(',');
            if (idx === 0) {
                colMap = {};
                for (let c = 0; c < parts.length; c++) colMap[parts[c].trim()] = c;
                return;
            }
            if (!colMap || parts.length < 8) { skipped++; return; }

            const sRa = parts[colMap.ra];
            const sDec = parts[colMap.dec];
            const sPlx = parts[colMap.parallax];
            const sPmra = parts[colMap.pmra];
            const sPmdec = parts[colMap.pmdec];
            const sRv = parts[colMap.radial_velocity];
            const sG = parts[colMap.phot_g_mean_mag];
            const sBpRp = parts[colMap.bp_rp];
            if (!sRa || !sDec || !sPlx || !sPmra || !sPmdec || !sRv || !sG || !sBpRp) { skipped++; return; }

            const ra = +sRa, dec = +sDec, plx = +sPlx;
            const pmra = +sPmra, pmdec = +sPmdec, rv = +sRv;
            const gmag = +sG, bpRp = +sBpRp;
            if (!(plx > 0.02) || !Number.isFinite(ra) || !Number.isFinite(dec) ||
                !Number.isFinite(pmra) || !Number.isFinite(pmdec) || !Number.isFinite(rv) ||
                !Number.isFinite(gmag) || !Number.isFinite(bpRp)) {
                skipped++;
                return;
            }

            const gal = icrsToGalactocentric(ra, dec, plx, pmra, pmdec, rv);
            if (!Number.isFinite(gal.gx) || !Number.isFinite(gal.vx)) { skipped++; return; }

            const mg = gmag - 5.0 * Math.log10(100.0 / plx);
            const sTeff = colMap.teff_gspphot != null ? parts[colMap.teff_gspphot] : '';
            const sFeH = colMap.mh_gspphot != null ? parts[colMap.mh_gspphot] : '';
            const teff = (sTeff && Number.isFinite(+sTeff) && +sTeff > 1000) ? +sTeff : estimateTeff(bpRp);
            let feH = (sFeH && Number.isFinite(+sFeH)) ? +sFeH : NaN;
            if (!Number.isFinite(feH)) {
                // Smooth continuous kinematic+vertical metallicity prior with seeded triangular scatter (avoids discrete flat sheets)
                const vT = Math.hypot(gal.vPhi - 232.0, gal.vPerp);
                const h1 = Math.sin(ra * 12.9898 + dec * 78.233) * 43758.5453;
                const h2 = Math.sin(ra * 39.3468 - dec * 11.135) * 24634.6345;
                const noise = ((h1 - Math.floor(h1)) + (h2 - Math.floor(h2)) - 1.0) * 0.28;
                feH = -0.04 - 0.0046 * Math.min(260.0, vT) - 0.14 * Math.min(3.0, Math.abs(gal.gz)) + noise;
            }
            feH = Math.max(-2.5, Math.min(0.6, feH));

            const pop = classifyPopulation(gal.gx, gal.gy, gal.gz, gal.vPhi, gal.vPerp, feH, mg, bpRp);
            const k = flusher.len;
            arr.ord[k] = ordCounter++;
            arr.gx[k] = gal.gx;
            arr.gy[k] = gal.gy;
            arr.gz[k] = gal.gz;
            arr.vx[k] = gal.vx;
            arr.vy[k] = gal.vy;
            arr.vz[k] = gal.vz;
            arr.v_phi[k] = gal.vPhi;
            arr.v_perp[k] = gal.vPerp;
            arr.bp_rp[k] = bpRp;
            arr.mg[k] = mg;
            arr.fe_h[k] = feH;
            arr.teff[k] = teff;
            arr.pop[k] = pop;
            flusher.len++;
            if (flusher.len >= flusher.batchSize) flusher.flush();
        });
        flusher.flush();
        console.log(`[ingest] slice ${s + 1}/${maxSlices} totalRows=${ordCounter} skipped=${skipped}`);
    }

    console.log('[ingest] building RangeIndex(mg) and SpatialIndex(gal3d)...');
    tbl.createRangeIndex('mg');
    tbl.createSpatialIndex('gal3d', ['gx', 'gy', 'gz'], 0.3);

    console.log(`[ingest] saving ${tbl.rowCount} rows to ${outFile}...`);
    tbl.save(outFile);
    if (!keepRaw) {
        for (const p of downloadedTemp) {
            try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {}
        }
    }
    const st = tbl.stats();
    const sec = ((Date.now() - tStart) / 1000).toFixed(1);
    console.log(`[ingest] done in ${sec}s: ${st.rowCount} rows, ${(st.totalBytes / 1e6).toFixed(1)} MB off-heap, file=${outFile}`);
}

await runIngest();
