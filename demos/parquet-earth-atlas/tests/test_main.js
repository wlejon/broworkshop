// Headless acceptance test for Parquet Earth Atlas showcase demo.

import { check, test, frames, waitFor, clickOn, shot, text, q, done } from "/lib/kit/test.js";

waitFor(() => {
  const app = globalThis.__earthAtlas;
  return app && /ready/.test(text('#status')) && app.events.rowCount === 48000;
}, 'parquet-earth-atlas booted with 48,000 events', 25000);

const app = globalThis.__earthAtlas;
frames(10);

test('boot: CSV ingest, Hash/Range/Spatial indexes & 3D canonical globe pixels', () => {
  check(app.regions.rowCount === 12, `regions CSV ingested 12 belts (got ${app.regions.rowCount})`);
  check(app.stations.rowCount === 256, `stations CSV ingested 256 stations (got ${app.stations.rowCount})`);
  check(app.events.hasSpatialIndex('pos3d'), 'events has 3D SpatialIndex');
  check(app.events.hasRangeIndex('mag'), 'events has RangeIndex(mag)');
  check(typeof app.markerNode.setInstanceBuffer === 'undefined', 'single canonical GPU instancing path');
  check(app.state.nullStationCount > 4000, `nullable unmonitored station_id preserved (${app.state.nullStationCount})`);

  const gRect = q('#gpu-canvas').getBoundingClientRect();
  const img = getPixels(
    Math.round(gRect.left + gRect.width * 0.15),
    Math.round(gRect.top + gRect.height * 0.15),
    Math.round(gRect.width * 0.70),
    Math.round(gRect.height * 0.70)
  );
  let lit = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i] + img.data[i + 1] + img.data[i + 2] > 32) lit++;
  }
  check(lit > 800, `3D globe + seismic arcs rendered lit pixels (lit=${lit})`);
  shot('parquet-earth-atlas');
});

test('incremental ReactiveQuery: chunk-2 outage & aftershock burst reuse untouched chunks', () => {
  clickOn('#btn-outage');
  frames(2);
  check(app.state.lastGroupStats.recomputedChunks === 1 && app.state.lastGroupStats.reusedChunks === 11,
    `groupBy after chunk-2 outage: recomputed=${app.state.lastGroupStats.recomputedChunks} reused=${app.state.lastGroupStats.reusedChunks}`);
  check(app.state.lastJoinStats.recomputedChunks === 1 && app.state.lastJoinStats.reusedChunks === 11,
    `leftJoin after chunk-2 outage: recomputed=${app.state.lastJoinStats.recomputedChunks} reused=${app.state.lastJoinStats.reusedChunks}`);

  clickOn('#btn-aftershock');
  frames(4);
  check(app.events.rowCount === 48128, `Aftershock burst appended +128 events (got ${app.events.rowCount})`);
  check(app.state.lastGroupStats.recomputedChunks === 1 && app.state.lastGroupStats.reusedChunks === 11,
    `Aftershock burst recomputed tail chunk and reused 11 chunks (recomp=${app.state.lastGroupStats.recomputedChunks}, reused=${app.state.lastGroupStats.reusedChunks})`);
});

test('formats: Parquet LZ4, Parquet Snappy & mmapBundle round-trip cleanly', () => {
  const lz4 = app.roundTripParquet('lz4');
  check(lz4.ok && lz4.rows === app.events.rowCount, `Parquet LZ4 round-trip verified (${lz4.bytes} B)`);

  const snp = app.roundTripParquet('snappy');
  check(snp.ok && snp.rows === app.events.rowCount, `Parquet Snappy round-trip verified (${snp.bytes} B)`);

  const bnd = app.saveAndMmapAtlasBundle();
  check(bnd.ok && bnd.bytes > 1000000, `.brobundle save + mmapBundle verified (${bnd.bytes} B)`);
  frames(4);
});

done('parquet-earth-atlas');
