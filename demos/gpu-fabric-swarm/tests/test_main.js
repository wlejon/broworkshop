// Headless acceptance test for Neural GPU Swarm showcase demo.

import { check, test, frames, waitFor, clickOn, shot, text, q, done } from "/lib/kit/test.js";

waitFor(() => {
  const app = globalThis.__swarmDemo;
  return app && /ready/.test(text('#status')) && app.sim.stepCount >= 1;
}, 'gpu-fabric-swarm booted and ran initial GPU step', 25000);

const app = globalThis.__swarmDemo;

frames(10);

test('boot: 65,536 agents, single canonical GPU instancing path & rendered pixels', () => {
  check(app.agents.rowCount === 65536, `65536 agents loaded (got ${app.agents.rowCount})`);
  check(app.agents.chunkCount === 16, `16 chunks created (got ${app.agents.chunkCount})`);
  check(typeof app.swarmNode.setInstanceBuffer === 'undefined', 'setInstanceBuffer removed under single-path rule');
  check(app.sim.stepCount >= 5, `GPU simulation advancing (steps=${app.sim.stepCount})`);

  const gRect = q('#gpu-canvas').getBoundingClientRect();
  const img = getPixels(
    Math.round(gRect.left + gRect.width * 0.15),
    Math.round(gRect.top + gRect.height * 0.15),
    Math.round(gRect.width * 0.70),
    Math.round(gRect.height * 0.70)
  );
  let lit = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i] + img.data[i + 1] + img.data[i + 2] > 42) lit++;
  }
  check(lit > 800, `3D canonical GPU instanced scene rendered non-black swarm pixels (lit=${lit})`);
  shot('gpu-fabric-swarm');
});

test('gpu fabric: dispatchTensors CUDA/Vulkan advances GpuTensors & rotates chunk writebacks with reuse', () => {
  const before = app.sim.poseT.download().slice(0, 12);
  app.sim.stepGpu(0.025, 1.4, 1.0);
  const after = app.sim.poseT.download().slice(0, 12);
  let maxDelta = 0;
  for (let i = 0; i < 12; i++) {
    maxDelta = Math.max(maxDelta, Math.abs(after[i] - before[i]));
  }
  check(maxDelta > 1e-4, `dispatchTensors updated GpuTensor positions on ${app.sim.device} (maxDelta=${maxDelta.toFixed(4)})`);

  clickOn('#btn-pulse');
  frames(2);
  check(app.state.lastReactive.recomputedChunks === 2,
    `Energy pulse recomputed 2 dirty chunks (got ${app.state.lastReactive.recomputedChunks})`);
  check(app.state.lastReactive.reusedChunks === 14,
    `ReactiveQuery reused 14 untouched chunks (got ${app.state.lastReactive.reusedChunks})`);
});

test('persistence: .brobundle save + mmapBundle & Parquet LZ4 round-trip', () => {
  const bnd = app.saveAndMmapBundle();
  check(bnd.verified && bnd.bytes > 1000000, `bundle saved & mmap-verified (${bnd.bytes} B)`);

  const pq = app.exportParquetLz4();
  check(pq.ok && pq.rows === 65536 && pq.bytes > 100000, `Parquet LZ4 round-trip 65536 rows (${pq.bytes} B)`);
  frames(4);
});

done('gpu-fabric-swarm');
