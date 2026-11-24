// Zero-copy GPU simulation pipeline:
//   bro.table.packToKernelBuffer -> bro.tensor (CUDA neural steering MLP)
//   -> bro.kernel.dispatchTensors (PTX on CUDA / SPIR-V on Vulkan)
//   -> InstancedMeshNode single canonical shaderBuffer + cullSpheres path
//   -> rotating chunk unpackFromKernelBuffer writeback -> ReactiveQuery

import { AGENT_COUNT, CHUNK_COUNT, SPECIES_DEFS } from "./data.js";

const CHUNK_ROWS = AGENT_COUNT / CHUNK_COUNT; // 4096

const SWARM_KERNELS_BK = `
@kernel @grid(1)
fn k_build_features(g: grid<1>, feat: rw_store<f32, 1>, pose: store<f32, 1>, vel: store<f32, 1>, n: i32, phase: f32) {
    let i = g.x();
    if (i < n) {
        let p4 = i * 4;
        let x = pose[p4 + 0];
        let y = pose[p4 + 1];
        let z = pose[p4 + 2];
        let vx = vel[p4 + 0];
        let vz = vel[p4 + 2];
        let rxy = sqrt(x * x + z * z + 0.01);
        feat[p4 + 0] = x * 0.04;
        feat[p4 + 1] = y * 0.08;
        feat[p4 + 2] = z * 0.04;
        feat[p4 + 3] = (vx * z - vz * x) / (rxy * 6.0) + 0.25 * sin(phase + rxy * 0.12);
    }
}

@kernel @grid(1)
fn k_integrate_swarm(
    g: grid<1>,
    pose: rw_store<f32, 1>,
    vel: rw_store<f32, 1>,
    tint: rw_store<f32, 1>,
    steer: store<f32, 1>,
    species: store<f32, 1>,
    n: i32,
    dt: f32,
    swirl: f32,
    cohesion: f32
) {
    let i = g.x();
    if (i < n) {
        let p4 = i * 4;
        let s3 = i * 3;
        var x = pose[p4 + 0];
        var y = pose[p4 + 1];
        var z = pose[p4 + 2];
        var vx = vel[p4 + 0];
        var vy = vel[p4 + 1];
        var vz = vel[p4 + 2];
        var energy = vel[p4 + 3];

        let targetR = species[p4 + 0];
        let spFreq = species[p4 + 1];
        let r = sqrt(x * x + z * z + 0.001);
        let invR = 1.0 / r;

        // Tangent orbital swirl + torus radial restoring + neural steering (steer[s3 + 0..2])
        let tx = -z * invR;
        let tz = x * invR;
        let radErr = (targetR - r) * cohesion * 0.45;
        let ax = tx * swirl * 3.8 * spFreq + x * invR * radErr + steer[s3 + 0] * 3.2;
        let ay = -y * 0.85 * cohesion + steer[s3 + 1] * 2.4;
        let az = tz * swirl * 3.8 * spFreq + z * invR * radErr + steer[s3 + 2] * 3.2;

        vx = (vx + ax * dt) * 0.965;
        vy = (vy + ay * dt) * 0.960;
        vz = (vz + az * dt) * 0.965;

        // Clamp max speed smoothly
        let spd2 = vx * vx + vy * vy + vz * vz;
        if (spd2 > 144.0) {
            let k = 12.0 / sqrt(spd2);
            vx = vx * k;
            vy = vy * k;
            vz = vz * k;
        }

        x = x + vx * dt;
        y = y + vy * dt;
        z = z + vz * dt;

        let spd = sqrt(vx * vx + vy * vy + vz * vz);
        energy = energy * 0.985 + min(1.0, spd * 0.09) * 0.015;
        if (energy > 1.0) { energy = 1.0; }
        if (energy < 0.06) { energy = 0.06; }

        pose[p4 + 0] = x;
        pose[p4 + 1] = y;
        pose[p4 + 2] = z;
        pose[p4 + 3] = 0.08 + energy * 0.07;

        vel[p4 + 0] = vx;
        vel[p4 + 1] = vy;
        vel[p4 + 2] = vz;
        vel[p4 + 3] = energy;

        // Vivid species base tint modulated by kinetic energy (for fragment shader emissive glow)
        tint[p4 + 0] = species[p4 + 2];
        tint[p4 + 1] = species[p4 + 3];
        tint[p4 + 3] = 0.28 + energy * 0.48;
    }
}
`;

export function createSwarmGpuSim(agentsTable) {
  bro.tensor.init();
  const mod = bro.kernel.compile(SWARM_KERNELS_BK, { file: 'swarm_fabric.bk' });
  const kBuildFeatures = mod.kernel('k_build_features');
  const kIntegrateSwarm = mod.kernel('k_integrate_swarm');

  // 1. Pack initial Table state directly into GPU KernelBuffers (for scene & tensor init).
  const poseKb = agentsTable.packToKernelBuffer(['x', 'y', 'z', 'scale'], {
    layout: 'aos', dtype: 'f32', residency: 'gpu',
  });
  const velKb = agentsTable.packToKernelBuffer(['vx', 'vy', 'vz', 'energy'], {
    layout: 'aos', dtype: 'f32', residency: 'gpu',
  });
  const tintKb = agentsTable.packToKernelBuffer(['r', 'g', 'b', 'energy'], {
    layout: 'aos', dtype: 'f32', residency: 'gpu',
  });

  // Pack per-agent species constants [orbitR, freq, baseR, baseG] into GPU tensor.
  const spMeta = new Float32Array(AGENT_COUNT * 4);
  for (let i = 0; i < AGENT_COUNT; i++) {
    const def = SPECIES_DEFS[i & 3];
    const o = i * 4;
    spMeta[o + 0] = def.orbitR;
    spMeta[o + 1] = def.freq;
    spMeta[o + 2] = def.rgb[0];
    spMeta[o + 3] = def.rgb[1];
  }

  // 2. Allocate GpuTensors on bro.tensor's default GPU device (CUDA on RTX 4090).
  const poseT = bro.kernel.toTensor(poseKb, [AGENT_COUNT, 4], { dtype: 'f32' });
  const velT = bro.kernel.toTensor(velKb, [AGENT_COUNT, 4], { dtype: 'f32' });
  const tintT = bro.kernel.toTensor(tintKb, [AGENT_COUNT, 4], { dtype: 'f32' });
  const speciesT = bro.tensor.createTensor(AGENT_COUNT, 4);
  speciesT.upload(spMeta);

  const featT = bro.tensor.createTensor(AGENT_COUNT, 4);
  const hidT = bro.tensor.createTensor(AGENT_COUNT, 8);
  const actT = bro.tensor.createTensor(AGENT_COUNT, 8);
  const steerT = bro.tensor.createTensor(AGENT_COUNT, 3);

  // Compact 2-layer neural steering MLP (4 -> 8 -> 3) weights on GPU
  const W1 = bro.tensor.createTensor(8, 4);
  const b1 = bro.tensor.createTensor(8, 1);
  const W2 = bro.tensor.createTensor(3, 8);
  const b2 = bro.tensor.createTensor(3, 1);
  let rng = bro.tensor.xavierInit(W1, 1337);
  rng = bro.tensor.xavierInit(W2, rng);
  b1.zero();
  b2.zero();

  const wbBuf = new Float32Array(AGENT_COUNT * 4);
  let phase = 0;
  let stepCount = 0;
  let writebackCursor = 0;
  let writebackTicks = 0;
  let lastStepMs = 0;

  function stepGpu(dt, swirl, cohesion) {
    const t0 = performance.now();
    phase += dt * 1.4;

    // A. Custom @kernel PTX/SPIR-V feature extraction directly on GpuTensor storage
    bro.kernel.dispatchTensors(kBuildFeatures, AGENT_COUNT, featT, poseT, velT, AGENT_COUNT, phase);

    // B. Neural steering forward pass on bro.tensor (CUDA kernels on same stream)
    bro.tensor.linearForwardBatched(W1, b1, featT, hidT);
    bro.tensor.tanhForward(hidT, actT);
    bro.tensor.linearForwardBatched(W2, b2, actT, steerT);

    // C. Custom @kernel PTX/SPIR-V flocking physics integrator directly on GpuTensors
    bro.kernel.dispatchTensors(
      kIntegrateSwarm, AGENT_COUNT,
      poseT, velT, tintT, steerT, speciesT,
      AGENT_COUNT, Math.min(0.033, Math.max(0.004, dt)), swirl, cohesion
    );

    // D. Sync GPU tensor outputs into scene KernelBuffers (render consumes via single hook path)
    bro.kernel.copyFromTensor(poseT, poseKb);
    bro.kernel.copyFromTensor(tintT, tintKb);

    stepCount++;
    lastStepMs = performance.now() - t0;
  }

  function injectEnergyPulse() {
    bro.tensor.addScalarInplace(velT, 0.35);
    bro.kernel.copyFromTensor(velT, velKb);
    // Write back 2 rotating chunks so Table + SpatialIndex + ReactiveQuery reflect live pulse
    return writebackChunks(2);
  }

  function writebackChunks(numChunks = 2) {
    // Sync pose & vel into GPU buffers, then unpack ONLY `numChunks` slices into bro.table
    bro.kernel.copyFromTensor(poseT, poseKb);
    bro.kernel.copyFromTensor(velT, velKb);
    const startChunk = writebackCursor;
    const dirtyIndices = [];
    for (let k = 0; k < numChunks; k++) {
      const ci = (startChunk + k) % CHUNK_COUNT;
      dirtyIndices.push(ci);
      const rowOff = ci * CHUNK_ROWS;
      agentsTable.unpackFromKernelBuffer(['x', 'y', 'z'], poseKb, {
        layout: 'aos',
        strideFloats: 4,
        rowOffset: rowOff,
        bufferRowOffset: rowOff,
        rowCount: CHUNK_ROWS,
      });
      agentsTable.unpackFromKernelBuffer(['vx', 'vy', 'vz', 'energy'], velKb, {
        layout: 'aos',
        strideFloats: 4,
        rowOffset: rowOff,
        bufferRowOffset: rowOff,
        rowCount: CHUNK_ROWS,
      });
    }
    writebackCursor = (startChunk + numChunks) % CHUNK_COUNT;
    writebackTicks++;
    return dirtyIndices;
  }

  return {
    device: bro.tensor.backend || 'cpu',
    poseT,
    velT,
    tintT,
    poseKb,
    tintKb,
    get stepCount() { return stepCount; },
    get writebackTicks() { return writebackTicks; },
    get lastStepMs() { return lastStepMs; },
    stepGpu,
    injectEnergyPulse,
    writebackChunks,
  };
}
