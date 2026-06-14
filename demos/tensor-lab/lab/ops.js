// Tensor Lab — operation registry.
//
// Every op carries four things:
//   shape(ins,p)        pure-JS shape inference -> [Shape] or an error string
//   stats(ins,p)        parameter + FLOP estimate
//   exec(T,ins,p,node)  the real bro.tensor GPU call -> [GpuTensor]
//   params[]            config fields surfaced in the inspector
//
// `ins` passed to shape()/stats() is an array of Lab.Shape — the logical ND
// shapes flowing in. `ins` passed to exec() is an array of GpuTensor — the 2D
// device buffers. exec() reads storage dims (rows/cols) straight off the
// GpuTensor, and the logical N/C/H/W off `node.inShapes` when it needs them.
//
// Source ops (input, image, embedding) take zero inputs. Learnable weights
// are created lazily and cached on the node, rebuilt only when their
// signature (the dims they depend on) changes — so re-running keeps a stable
// network and only the activations move.
import { Shape } from "/app/lab/shape.js";

  // ---- number formatting (shared across modules) -----------------------
  export const fmtNum = function (n) {
    if (n == null || !isFinite(n)) return '—';
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(2) + 'G';
    if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(n | 0);
  };
  export const fmtMs = function (ms) {
    if (ms == null || !isFinite(ms)) return '—';
    if (ms < 1) return ms.toFixed(3) + ' ms';
    if (ms < 100) return ms.toFixed(2) + ' ms';
    return ms.toFixed(1) + ' ms';
  };

  // ---- tensor construction helpers -------------------------------------
  function fill(t, fn) {
    const n = t.rows * t.cols, a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = fn(i);
    t.upload(a);
    return t;
  }
  function gauss() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.28318530718 * v);
  }
  // Xavier-ish uniform weight init, fan-in scaled.
  function weight(T, rows, cols, fanIn) {
    const s = 1.732 / Math.sqrt(Math.max(1, fanIn));
    return fill(T.createTensor(rows, cols), () => (Math.random() * 2 - 1) * s);
  }
  function constant(T, rows, cols, v) {
    return fill(T.createTensor(rows, cols), () => v);
  }
  function dataFill(T, rows, cols, kind) {
    const n = rows * cols;
    let fn;
    if (kind === 'zeros') fn = () => 0;
    else if (kind === 'ramp') fn = (i) => (i / Math.max(1, n - 1)) * 2 - 1;
    else if (kind === 'gauss') fn = () => gauss() * 0.7;
    else fn = () => Math.random() * 2 - 1;
    return fill(T.createTensor(rows, cols), fn);
  }
  // weight cache keyed by a signature string
  function cached(node, sig, build) {
    if (node._wsig !== sig) { node._w = build(); node._wsig = sig; }
    return node._w;
  }

  // Load a bound weight through the node's safetensors file when the node
  // carries node.bind (set by the T5 importer), otherwise synthesise one via
  // `fallback`. Checkpoint tensors are FP16; cast to FP32 so the whole
  // imported graph runs at a single dtype, exactly like the freeform editor.
  function boundW(node, T, slot, rows, cols, fallback) {
    const b = node.bind;
    if (b && b.keys && b.keys[slot]) {
      const raw = b.file.get(b.keys[slot], rows, cols, 'native');
      if (raw.dtype() === 'fp32') return raw;
      const f32 = T.createTensor(rows, cols);
      T.cast(raw, f32, 'fp32');
      return f32;
    }
    return fallback();
  }

  // shared layout-guard message
  function needMatrix(label, s) {
    return label + ' needs a matrix input, got ' + s.layout + ' ' + Shape.label(s);
  }

  // ---- the registry ----------------------------------------------------
  const DEFS = {};
  function def(spec) { DEFS[spec.type] = spec; }

  // === Sources ==========================================================
  def({
    type: 'input', label: 'Input', cat: 'Source', color: '#f59e0b',
    desc: 'A source activation tensor — the batch/sequence that flows into the network.',
    ins: [], outs: ['out'],
    params: [
      { key: 'rows', label: 'Rows (batch / seq)', type: 'int', def: 32, min: 1, max: 512 },
      { key: 'cols', label: 'Cols (features)', type: 'int', def: 128, min: 1, max: 4096 },
      { key: 'fill', label: 'Fill', type: 'select', def: 'gauss',
        options: ['gauss', 'uniform', 'ramp', 'zeros'] },
    ],
    shape: (ins, p) => [Shape.matrix(p.rows, p.cols)],
    stats: () => ({ params: 0, flops: 0 }),
    exec: (T, ins, p) => [dataFill(T, p.rows, p.cols, p.fill)],
  });

  def({
    type: 'image', label: 'Image', cat: 'Source', color: '#f59e0b',
    desc: 'A source image tensor in N×C×H×W layout — the input to a convolution stack.',
    ins: [], outs: ['out'],
    params: [
      { key: 'n', label: 'Batch (N)', type: 'int', def: 1, min: 1, max: 64 },
      { key: 'c', label: 'Channels (C)', type: 'int', def: 3, min: 1, max: 1024 },
      { key: 'h', label: 'Height (H)', type: 'int', def: 32, min: 1, max: 512 },
      { key: 'w', label: 'Width (W)', type: 'int', def: 32, min: 1, max: 512 },
      { key: 'fill', label: 'Fill', type: 'select', def: 'gauss',
        options: ['gauss', 'uniform', 'ramp', 'zeros'] },
    ],
    shape: (ins, p) => [Shape.image(p.n, p.c, p.h, p.w)],
    stats: () => ({ params: 0, flops: 0 }),
    exec: (T, ins, p) => [dataFill(T, p.n, p.c * p.h * p.w, p.fill)],
  });

  def({
    type: 'embedding', label: 'Embedding', cat: 'Source', color: '#f59e0b',
    desc: 'Token-embedding lookup: B random token ids index a (vocab × dim) table.',
    ins: [], outs: ['out'],
    params: [
      { key: 'vocab', label: 'Vocab size', type: 'int', def: 256, min: 2, max: 50000 },
      { key: 'dim', label: 'Embed dim', type: 'int', def: 128, min: 1, max: 4096 },
      { key: 'batch', label: 'Tokens (B)', type: 'int', def: 32, min: 1, max: 512 },
    ],
    shape: (ins, p) => [Shape.matrix(p.batch, p.dim)],
    stats: (ins, p) => ({ params: p.vocab * p.dim, flops: 0 }),
    exec: (T, ins, p, node) => {
      const table = cached(node, 'e' + p.vocab + 'x' + p.dim,
        () => boundW(node, T, 'table', p.vocab, p.dim,
          () => weight(T, p.vocab, p.dim, p.dim)));
      const idxI = new Int32Array(p.batch);
      for (let i = 0; i < p.batch; i++) idxI[i] = (Math.random() * p.vocab) | 0;
      const idx = T.createTensor(p.batch, 1);
      idx.upload(new Float32Array(idxI.buffer));
      const out = T.createTensor(p.batch, p.dim);
      T.embeddingLookupForward(table, idx, p.batch, out);
      return [out];
    },
  });

  def({
    type: 'timestep', label: 'Timestep Embed', cat: 'Source', color: '#f59e0b',
    desc: 'Sinusoidal timestep embedding (SD/SDXL) — maps B diffusion timesteps onto a ' +
          'dim-wide frequency basis. The conditioning input to a U-Net.',
    ins: [], outs: ['out'],
    params: [
      { key: 'batch', label: 'Timesteps (B)', type: 'int', def: 8, min: 1, max: 256 },
      { key: 'dim', label: 'Embed dim', type: 'int', def: 128, min: 2, max: 4096 },
      { key: 'maxT', label: 'Max timestep', type: 'int', def: 1000, min: 1, max: 100000 },
    ],
    shape: (ins, p) => [Shape.matrix(p.batch, p.dim)],
    stats: () => ({ params: 0, flops: 0 }),
    exec: (T, ins, p) => {
      const ts = T.createTensor(p.batch, 1);
      const a = new Float32Array(p.batch);
      for (let i = 0; i < p.batch; i++) a[i] = (i / Math.max(1, p.batch - 1)) * p.maxT;
      ts.upload(a);
      const out = T.createTensor(p.batch, p.dim);
      T.timestepEmbedding(ts, p.dim, 10000.0, out);
      return [out];
    },
  });

  // === Dense ============================================================
  def({
    type: 'linear', label: 'Linear', cat: 'Dense', color: '#38bdf8',
    desc: 'Fully-connected layer  y = x·Wᵀ + b.  Weights are owned by the node.',
    ins: ['x'], outs: ['y'],
    params: [
      { key: 'out', label: 'Out features', type: 'int', def: 256, min: 1, max: 8192 },
      { key: 'bias', label: 'Bias', type: 'bool', def: true },
    ],
    shape: (ins, p) => Shape.isMatrix(ins[0])
      ? [Shape.matrix(ins[0].dims[0], p.out)]
      : needMatrix('Linear', ins[0]),
    stats: (ins, p) => {
      const inF = ins[0].dims[1];
      return { params: inF * p.out + (p.bias ? p.out : 0),
        flops: 2 * ins[0].dims[0] * inF * p.out };
    },
    exec: (T, ins, p, node) => {
      const x = ins[0], inF = x.cols;
      const w = cached(node, 'l' + inF + 'x' + p.out + (p.bias ? 'b' : ''), () => ({
        W: weight(T, p.out, inF, inF),
        b: p.bias ? weight(T, p.out, 1, inF) : constant(T, p.out, 1, 0),
      }));
      const y = T.createTensor(x.rows, p.out);
      T.linearForwardBatched(w.W, w.b, x, y);
      return [y];
    },
  });

  def({
    type: 'matmul', label: 'MatMul', cat: 'Dense', color: '#38bdf8',
    desc: 'Raw matrix product  C = A·B.  A is (M×K), B is (K×N).',
    ins: ['A', 'B'], outs: ['C'],
    params: [],
    shape: (ins) => {
      if (!Shape.isMatrix(ins[0]) || !Shape.isMatrix(ins[1]))
        return 'MatMul needs two matrix inputs';
      if (ins[0].dims[1] !== ins[1].dims[0])
        return 'inner dims differ: A is ' + Shape.label(ins[0]) +
          ', B is ' + Shape.label(ins[1]);
      return [Shape.matrix(ins[0].dims[0], ins[1].dims[1])];
    },
    stats: (ins) => ({ params: 0,
      flops: 2 * ins[0].dims[0] * ins[0].dims[1] * ins[1].dims[1] }),
    exec: (T, ins) => {
      const c = T.createTensor(ins[0].rows, ins[1].cols);
      T.matmul(ins[0], ins[1], c);
      return [c];
    },
  });

  // === Activations ======================================================
  // Pure elementwise — valid on either layout; the Shape passes straight
  // through.
  function activation(type, label, desc, opName, flopK) {
    def({
      type: type, label: label, cat: 'Activation', color: '#a78bfa', desc: desc,
      ins: ['x'], outs: ['y'], params: [],
      shape: (ins) => [ins[0]],
      stats: (ins) => ({ params: 0, flops: flopK * Shape.elems(ins[0]) }),
      exec: (T, ins) => {
        const y = T.createTensor(ins[0].rows, ins[0].cols);
        T[opName](ins[0], y);
        return [y];
      },
    });
  }
  activation('relu', 'ReLU', 'max(0, x) — the classic rectifier.', 'reluForward', 1);
  activation('gelu', 'GELU', 'Gaussian Error Linear Unit (tanh approx) — transformer FFNs.', 'geluForward', 8);
  activation('silu', 'SiLU', 'x·σ(x), aka Swish — used across modern nets.', 'siluForward', 5);
  activation('quickgelu', 'QuickGELU', 'x·σ(1.702·x) — the CLIP/ViT activation.', 'quickGeluForward', 5);
  activation('sigmoid', 'Sigmoid', 'Logistic squash σ(x) into (0, 1).', 'sigmoidForward', 4);
  activation('tanh', 'Tanh', 'Hyperbolic tangent squash into (−1, 1).', 'tanhForward', 4);
  activation('gelu-exact', 'GELU (exact)', 'Exact erf-based GELU — the BERT/GPT-2 reference activation.', 'geluExactForward', 10);

  // Parameterised elementwise activations — one scalar config each.
  def({
    type: 'elu', label: 'ELU', cat: 'Activation', color: '#a78bfa',
    desc: 'Exponential Linear Unit: x if x>0 else α·(eˣ−1). The EnCodec activation.',
    ins: ['x'], outs: ['y'],
    params: [{ key: 'alpha', label: 'Alpha', type: 'float', def: 1, min: 0.01, max: 4, step: 0.01 }],
    shape: (ins) => [ins[0]],
    stats: (ins) => ({ params: 0, flops: 6 * Shape.elems(ins[0]) }),
    exec: (T, ins, p) => {
      const y = T.createTensor(ins[0].rows, ins[0].cols);
      T.eluForward(ins[0], p.alpha, y);
      return [y];
    },
  });

  def({
    type: 'leakyrelu', label: 'Leaky ReLU', cat: 'Activation', color: '#a78bfa',
    desc: 'max(x, slope·x) — keeps a small gradient for negatives. The HiFi-GAN activation.',
    ins: ['x'], outs: ['y'],
    params: [{ key: 'slope', label: 'Negative slope', type: 'float', def: 0.1, min: 0, max: 1, step: 0.01 }],
    shape: (ins) => [ins[0]],
    stats: (ins) => ({ params: 0, flops: 2 * Shape.elems(ins[0]) }),
    exec: (T, ins, p) => {
      const y = T.createTensor(ins[0].rows, ins[0].cols);
      T.leakyReluForward(ins[0], p.slope, y);
      return [y];
    },
  });

  def({
    type: 'geglu', label: 'GEGLU', cat: 'Activation', color: '#a78bfa',
    desc: 'Gated-GELU FFN activation: input (B×2D) splits to A,B; output gelu(A)·B  (B×D).',
    ins: ['x'], outs: ['y'], params: [],
    shape: (ins) => {
      if (!Shape.isMatrix(ins[0])) return needMatrix('GEGLU', ins[0]);
      if (ins[0].dims[1] % 2 !== 0)
        return 'GEGLU needs an even feature count, got ' + ins[0].dims[1];
      return [Shape.matrix(ins[0].dims[0], ins[0].dims[1] / 2)];
    },
    stats: (ins) => ({ params: 0, flops: 9 * Shape.elems(ins[0]) }),
    exec: (T, ins) => {
      const y = T.createTensor(ins[0].rows, ins[0].cols / 2);
      T.gegluForward(ins[0], y);
      return [y];
    },
  });

  def({
    type: 'geglu-exact', label: 'GEGLU (exact)', cat: 'Activation', color: '#a78bfa',
    desc: 'Gated FFN with the exact erf GELU gate: input (B×2D) → gelu(A)·B  (B×D).',
    ins: ['x'], outs: ['y'], params: [],
    shape: (ins) => {
      if (!Shape.isMatrix(ins[0])) return needMatrix('GEGLU (exact)', ins[0]);
      if (ins[0].dims[1] % 2 !== 0)
        return 'GEGLU needs an even feature count, got ' + ins[0].dims[1];
      return [Shape.matrix(ins[0].dims[0], ins[0].dims[1] / 2)];
    },
    stats: (ins) => ({ params: 0, flops: 11 * Shape.elems(ins[0]) }),
    exec: (T, ins) => {
      const y = T.createTensor(ins[0].rows, ins[0].cols / 2);
      T.gegluExactForward(ins[0], y);
      return [y];
    },
  });

  def({
    type: 'swiglu', label: 'SwiGLU', cat: 'Activation', color: '#a78bfa',
    desc: 'Gated FFN activation: input (B×2D) splits to A,B; output silu(A)·B  (B×D).',
    ins: ['x'], outs: ['y'], params: [],
    shape: (ins) => {
      if (!Shape.isMatrix(ins[0])) return needMatrix('SwiGLU', ins[0]);
      if (ins[0].dims[1] % 2 !== 0)
        return 'SwiGLU needs an even feature count, got ' + ins[0].dims[1];
      return [Shape.matrix(ins[0].dims[0], ins[0].dims[1] / 2)];
    },
    stats: (ins) => ({ params: 0, flops: 6 * Shape.elems(ins[0]) }),
    exec: (T, ins) => {
      const y = T.createTensor(ins[0].rows, ins[0].cols / 2);
      T.swigluForward(ins[0], y);
      return [y];
    },
  });

  def({
    type: 'softmax', label: 'Softmax', cat: 'Activation', color: '#a78bfa',
    desc: 'Row-wise softmax — each row becomes a probability distribution.',
    ins: ['x'], outs: ['p'], params: [],
    shape: (ins) => Shape.isMatrix(ins[0]) ? [ins[0]] : needMatrix('Softmax', ins[0]),
    stats: (ins) => ({ params: 0, flops: 5 * Shape.elems(ins[0]) }),
    exec: (T, ins) => {
      const y = T.createTensor(ins[0].rows, ins[0].cols);
      T.softmaxForward(ins[0], y, null);
      return [y];
    },
  });

  // === Normalisation ====================================================
  def({
    type: 'layernorm', label: 'LayerNorm', cat: 'Norm', color: '#34d399',
    desc: 'Per-row normalise to zero mean / unit variance, then scale+shift.',
    ins: ['x'], outs: ['y'],
    params: [{ key: 'eps', label: 'Epsilon', type: 'float', def: 1e-5, min: 1e-8, max: 1e-2, step: 1e-6 }],
    shape: (ins) => Shape.isMatrix(ins[0]) ? [ins[0]] : needMatrix('LayerNorm', ins[0]),
    stats: (ins) => ({ params: 2 * ins[0].dims[1], flops: 8 * Shape.elems(ins[0]) }),
    exec: (T, ins, p, node) => {
      const x = ins[0], D = x.cols;
      const w = cached(node, 'ln' + D, () => ({
        g: constant(T, D, 1, 1), b: constant(T, D, 1, 0),
      }));
      const y = T.createTensor(x.rows, D);
      T.layernormForwardInferenceBatched(x, w.g, w.b, y, p.eps);
      return [y];
    },
  });

  def({
    type: 'rmsnorm', label: 'RMSNorm', cat: 'Norm', color: '#34d399',
    desc: 'Root-mean-square norm (no mean subtraction) — the Llama-style norm.',
    ins: ['x'], outs: ['y'],
    params: [{ key: 'eps', label: 'Epsilon', type: 'float', def: 1e-5, min: 1e-8, max: 1e-2, step: 1e-6 }],
    shape: (ins) => Shape.isMatrix(ins[0]) ? [ins[0]] : needMatrix('RMSNorm', ins[0]),
    stats: (ins) => ({ params: ins[0].dims[1], flops: 6 * Shape.elems(ins[0]) }),
    exec: (T, ins, p, node) => {
      const x = ins[0], D = x.cols;
      const g = cached(node, 'rms' + D,
        () => boundW(node, T, 'g', D, 1, () => constant(T, D, 1, 1)));
      const y = T.createTensor(x.rows, D);
      T.rmsNormForward(x, g, p.eps, y);
      return [y];
    },
  });

  def({
    type: 'groupnorm', label: 'GroupNorm', cat: 'Norm', color: '#34d399',
    desc: 'NCHW group normalisation — splits channels into groups and normalises each ' +
          'per (n, group) tile. The diffusion-U-Net / ConvNeXt norm.',
    ins: ['x'], outs: ['y'],
    params: [
      { key: 'groups', label: 'Groups', type: 'int', def: 8, min: 1, max: 128 },
      { key: 'eps', label: 'Epsilon', type: 'float', def: 1e-5, min: 1e-8, max: 1e-2, step: 1e-6 },
    ],
    shape: (ins, p) => {
      if (!Shape.isImage(ins[0]))
        return 'GroupNorm needs an image (N×C×H×W) input, got ' + ins[0].layout;
      if (ins[0].dims[1] % p.groups !== 0)
        return 'channels ' + ins[0].dims[1] + ' not divisible by ' + p.groups + ' groups';
      return [ins[0]];
    },
    stats: (ins) => ({ params: 2 * ins[0].dims[1], flops: 8 * Shape.elems(ins[0]) }),
    exec: (T, ins, p, node) => {
      const sh = node.inShapes[0];
      const N = sh.dims[0], C = sh.dims[1], H = sh.dims[2], W = sh.dims[3];
      const w = cached(node, 'gn' + C,
        () => ({ g: constant(T, C, 1, 1), b: constant(T, C, 1, 0) }));
      const y = T.createTensor(ins[0].rows, ins[0].cols);
      T.groupNormForward(ins[0], w.g, w.b, N, C, H, W, p.groups, p.eps, y);
      return [y];
    },
  });

  def({
    type: 'l2norm-pixel', label: 'L2 Normalize', cat: 'Norm', color: '#34d399',
    desc: 'Per-pixel L2 normalise over the channel axis — turns each pixel into a ' +
          'unit-length direction. The DSINE surface-normal / RAFT flow-field norm.',
    ins: ['x'], outs: ['y'],
    params: [{ key: 'eps', label: 'Epsilon', type: 'float', def: 1e-12, min: 1e-12, max: 1e-3, step: 1e-9 }],
    shape: (ins) => Shape.isImage(ins[0]) ? [ins[0]]
      : 'L2 Normalize needs an image (N×C×H×W) input, got ' + ins[0].layout,
    stats: (ins) => ({ params: 0, flops: 3 * Shape.elems(ins[0]) }),
    exec: (T, ins, p, node) => {
      const sh = node.inShapes[0];
      const y = T.createTensor(ins[0].rows, ins[0].cols);
      T.l2NormalizeNchwForward(ins[0], sh.dims[0], sh.dims[1], sh.dims[2], sh.dims[3], p.eps, y);
      return [y];
    },
  });

  def({
    type: 'batchnorm', label: 'BatchNorm', cat: 'Norm', color: '#34d399',
    desc: 'NCHW batch normalisation (inference) — normalises each channel by its frozen ' +
          'running mean/variance, then scale+shift. The classic CNN norm.',
    ins: ['x'], outs: ['y'],
    params: [{ key: 'eps', label: 'Epsilon', type: 'float', def: 1e-5, min: 1e-8, max: 1e-2, step: 1e-6 }],
    shape: (ins) => Shape.isImage(ins[0]) ? [ins[0]]
      : 'BatchNorm needs an image (N×C×H×W) input, got ' + ins[0].layout,
    stats: (ins) => ({ params: 2 * ins[0].dims[1], flops: 4 * Shape.elems(ins[0]) }),
    exec: (T, ins, p, node) => {
      const sh = node.inShapes[0];
      const N = sh.dims[0], C = sh.dims[1], H = sh.dims[2], W = sh.dims[3];
      // Frozen running stats (mean 0 / var 1) + identity affine, like a freshly-init layer.
      const w = cached(node, 'bn' + C, () => ({
        g: constant(T, C, 1, 1), b: constant(T, C, 1, 0),
        mean: constant(T, C, 1, 0), var: constant(T, C, 1, 1),
      }));
      const y = T.createTensor(ins[0].rows, ins[0].cols);
      T.batchNormInference(ins[0], w.g, w.b, w.mean, w.var, N, C, H, W, p.eps, y);
      return [y];
    },
  });

  // === Attention ========================================================
  def({
    type: 'mha', label: 'Multi-Head Attn', cat: 'Attention', color: '#fb7185',
    desc: 'Multi-head self-attention. Exposes the per-head attention matrix — ' +
          'inspect it to watch every query attend to every key.',
    ins: ['x'], outs: ['out'],
    params: [{ key: 'heads', label: 'Heads', type: 'int', def: 4, min: 1, max: 32 }],
    shape: (ins, p) => {
      if (!Shape.isMatrix(ins[0])) return needMatrix('Multi-Head Attn', ins[0]);
      const D = ins[0].dims[1];
      if (D % p.heads !== 0)
        return 'feature dim ' + D + ' is not divisible by ' + p.heads + ' heads';
      return [ins[0]];
    },
    stats: (ins, p) => {
      const Sq = ins[0].dims[0], D = ins[0].dims[1];
      return { params: 4 * D * D, flops: 4 * 2 * Sq * D * D + 2 * 2 * Sq * Sq * D };
    },
    exec: (T, ins, p, node) => {
      const x = ins[0], Sq = x.rows, D = x.cols, H = p.heads, hd = D / H;
      const w = cached(node, 'mha' + D, () => ({
        Wq: weight(T, D, D, D), Wk: weight(T, D, D, D),
        Wv: weight(T, D, D, D), Wo: weight(T, D, D, D),
      }));
      const Qh = T.createTensor(H * Sq, hd), Kh = T.createTensor(H * Sq, hd);
      const Vh = T.createTensor(H * Sq, hd), Attnh = T.createTensor(H * Sq, Sq);
      const Yc = T.createTensor(Sq, D), O = T.createTensor(Sq, D);
      T.mhaForward(x, w.Wq, w.Wk, w.Wv, w.Wo, null, H, Qh, Kh, Vh, Attnh, Yc, O);
      node._attn = { tensor: Attnh, heads: H, seq: Sq };
      return [O];
    },
  });

  def({
    type: 'rope', label: 'RoPE', cat: 'Attention', color: '#fb7185',
    desc: 'Rotary position embedding — rotates feature pairs by position angle.',
    ins: ['x'], outs: ['y'],
    params: [
      { key: 'heads', label: 'Heads', type: 'int', def: 4, min: 1, max: 32 },
      { key: 'theta', label: 'Theta base', type: 'float', def: 10000, min: 100, max: 1e6, step: 100 },
    ],
    shape: (ins, p) => {
      if (!Shape.isMatrix(ins[0])) return needMatrix('RoPE', ins[0]);
      const D = ins[0].dims[1];
      if (D % p.heads !== 0)
        return 'feature dim ' + D + ' is not divisible by ' + p.heads + ' heads';
      if ((D / p.heads) % 2 !== 0) return 'head dim ' + (D / p.heads) + ' must be even';
      return [ins[0]];
    },
    stats: (ins) => ({ params: 0, flops: 6 * Shape.elems(ins[0]) }),
    exec: (T, ins, p) => {
      const x = ins[0], hd = x.cols / p.heads;
      const y = T.createTensor(x.rows, x.cols);
      T.ropeForward(x, hd, p.heads, 0, p.theta, y);
      return [y];
    },
  });

  def({
    type: 'flash-attn', label: 'Flash Attention', cat: 'Attention', color: '#fb7185',
    desc: 'Memory-efficient tiled self-attention (online softmax). Projects Q/K/V, then runs ' +
          'the flash kernel. Causal runs the sliding-window kernel — a positive window ' +
          'restricts each query to the last N keys (streaming-codec attention); 0 = full ' +
          'causal. Non-causal is bidirectional full attention.',
    ins: ['x'], outs: ['out'],
    params: [
      { key: 'heads', label: 'Heads', type: 'int', def: 4, min: 1, max: 32 },
      { key: 'causal', label: 'Causal', type: 'bool', def: true },
      { key: 'window', label: 'Window (0=full)', type: 'int', def: 0, min: 0, max: 4096 },
    ],
    shape: (ins, p) => {
      if (!Shape.isMatrix(ins[0])) return needMatrix('Flash Attention', ins[0]);
      if (ins[0].dims[1] % p.heads !== 0)
        return 'feature dim ' + ins[0].dims[1] + ' is not divisible by ' + p.heads + ' heads';
      return [ins[0]];
    },
    stats: (ins, p) => {
      const L = ins[0].dims[0], D = ins[0].dims[1];
      return { params: 3 * D * D, flops: 3 * 2 * L * D * D + 2 * 2 * L * L * D };
    },
    exec: (T, ins, p, node) => {
      const x = ins[0], L = x.rows, D = x.cols, H = p.heads;
      const w = cached(node, 'fa' + D, () => ({
        Wq: weight(T, D, D, D), Wk: weight(T, D, D, D), Wv: weight(T, D, D, D),
        z: constant(T, D, 1, 0),
      }));
      const Q = T.createTensor(L, D), K = T.createTensor(L, D), V = T.createTensor(L, D);
      T.linearForwardBatched(w.Wq, w.z, x, Q);
      T.linearForwardBatched(w.Wk, w.z, x, K);
      T.linearForwardBatched(w.Wv, w.z, x, V);
      const O = T.createTensor(L, D);
      if (p.causal) {
        // The windowed kernel is always causal and runs FP32; window<=0 is full causal.
        T.flashAttentionWindowedForward(Q, K, V, null, H, p.window > 0 ? p.window : 0, O);
      } else {
        // Bidirectional full attention — the bare flash kernel is FP16-only on GPU,
        // so cast Q/K/V to FP16, run, and cast the result back to FP32.
        const Qh = T.createTensor(L, D, 'fp16'), Kh = T.createTensor(L, D, 'fp16');
        const Vh = T.createTensor(L, D, 'fp16'), Oh = T.createTensor(L, D, 'fp16');
        T.cast(Q, Qh, 'fp16'); T.cast(K, Kh, 'fp16'); T.cast(V, Vh, 'fp16');
        T.flashAttentionForward(Qh, Kh, Vh, null, H, false, Oh);
        T.cast(Oh, O, 'fp32');
      }
      return [O];
    },
  });

  def({
    type: 'sam-attn', label: 'SAM Window Attn', cat: 'Attention', color: '#fb7185',
    desc: 'SAM / ViTDet decomposed 2D relative-position self-attention. Tokens map to a ' +
          'gridH×gridW patch grid; the position bias factors into height + width tables ' +
          '(never an L×L matrix). A positive window runs it per window×window tile.',
    ins: ['x'], outs: ['out'],
    params: [
      { key: 'heads', label: 'Heads', type: 'int', def: 4, min: 1, max: 32 },
      { key: 'gridH', label: 'Grid H', type: 'int', def: 8, min: 1, max: 64 },
      { key: 'gridW', label: 'Grid W', type: 'int', def: 8, min: 1, max: 64 },
      { key: 'window', label: 'Window (0=full)', type: 'int', def: 0, min: 0, max: 64 },
    ],
    shape: (ins, p) => {
      if (!Shape.isMatrix(ins[0])) return needMatrix('SAM Window Attn', ins[0]);
      const L = ins[0].dims[0], D = ins[0].dims[1];
      if (L !== p.gridH * p.gridW)
        return 'rows ' + L + ' must equal gridH×gridW = ' + (p.gridH * p.gridW);
      if (D % p.heads !== 0)
        return 'feature dim ' + D + ' is not divisible by ' + p.heads + ' heads';
      if (p.window > 0 && (p.gridH % p.window !== 0 || p.gridW % p.window !== 0))
        return 'window ' + p.window + ' must divide both grid dims';
      return [ins[0]];
    },
    stats: (ins, p) => {
      const L = ins[0].dims[0], D = ins[0].dims[1];
      return { params: 4 * D * D, flops: 4 * 2 * L * D * D + 2 * 2 * L * L * D };
    },
    exec: (T, ins, p, node) => {
      const x = ins[0], L = x.rows, D = x.cols, H = p.heads, hd = D / H;
      // The rel-pos tables span the attended extent: the full grid for global
      // attention, but just one window×window tile in the windowed variant.
      const spanH = p.window > 0 ? p.window : p.gridH;
      const spanW = p.window > 0 ? p.window : p.gridW;
      const w = cached(node, 'sam' + D + '_' + p.gridH + 'x' + p.gridW + '_w' + p.window + '_' + H, () => ({
        Wq: weight(T, D, D, D), Wk: weight(T, D, D, D),
        Wv: weight(T, D, D, D), Wo: weight(T, D, D, D),
        rH: weight(T, 2 * spanH - 1, hd, hd),
        rW: weight(T, 2 * spanW - 1, hd, hd),
      }));
      const O = T.createTensor(L, D);
      const scale = 1 / Math.sqrt(hd);
      if (p.window > 0)
        T.selfAttentionDecomposedRelPosWindowedForward(
          x, w.Wq, null, w.Wk, null, w.Wv, null, w.Wo, null, w.rH, w.rW,
          H, p.gridH, p.gridW, p.window, scale, O);
      else
        T.selfAttentionDecomposedRelPosForward(
          x, w.Wq, null, w.Wk, null, w.Wv, null, w.Wo, null, w.rH, w.rW,
          H, p.gridH, p.gridW, scale, O);
      return [O];
    },
  });

  def({
    type: 'cross-attn', label: 'Cross Attention', cat: 'Attention', color: '#fb7185',
    desc: 'Cross-attention: queries from x attend to keys/values from a separate context ' +
          'tensor. The decoder↔encoder / diffusion text-conditioning bridge.',
    ins: ['x', 'ctx'], outs: ['out'],
    params: [{ key: 'heads', label: 'Heads', type: 'int', def: 4, min: 1, max: 32 }],
    shape: (ins, p) => {
      if (!Shape.isMatrix(ins[0])) return needMatrix('Cross Attention', ins[0]);
      if (!Shape.isMatrix(ins[1])) return 'Cross Attention: context must be a matrix';
      const D = ins[0].dims[1];
      if (ins[1].dims[1] !== D)
        return 'context feature dim ' + ins[1].dims[1] + ' must match query dim ' + D;
      if (D % p.heads !== 0)
        return 'feature dim ' + D + ' is not divisible by ' + p.heads + ' heads';
      return [ins[0]];
    },
    stats: (ins, p) => {
      const Lq = ins[0].dims[0], Lk = ins[1].dims[0], D = ins[0].dims[1];
      return { params: 4 * D * D, flops: 4 * 2 * Lq * D * D + 2 * 2 * Lq * Lk * D };
    },
    exec: (T, ins, p, node) => {
      const x = ins[0], ctx = ins[1], Lq = x.rows, D = x.cols, H = p.heads;
      const w = cached(node, 'xa' + D, () => ({
        Wq: weight(T, D, D, D), Wk: weight(T, D, D, D),
        Wv: weight(T, D, D, D), Wo: weight(T, D, D, D),
      }));
      const O = T.createTensor(Lq, D);
      T.crossAttentionForward(x, ctx, w.Wq, w.Wk, w.Wv, w.Wo, null, H, O);
      return [O];
    },
  });

  // === T5 encoder =======================================================
  // T5 LayerNorm is exactly RMSNorm — reuse the `rmsnorm` op. These three
  // ops plus rmsnorm + add express a full T5 v1.1 encoder layer.

  // T5 relative-position bucketing — maps a (key - query) offset onto one of
  // `numBuckets` learned-bias slots. Mirrors HF transformers'
  // _relative_position_bucket: exact for small offsets, log-spaced for large.
  function t5Bucket(relPos, bidirectional, numBuckets, maxDistance) {
    let ret = 0, n = relPos;
    if (bidirectional) {
      numBuckets = numBuckets >> 1;
      if (n > 0) ret += numBuckets;
      n = Math.abs(n);
    } else {
      n = Math.max(0, -n);
    }
    const maxExact = numBuckets >> 1;
    if (n < maxExact) {
      ret += n;
    } else {
      const v = maxExact + Math.floor(
        Math.log(n / maxExact) / Math.log(maxDistance / maxExact) * (numBuckets - maxExact));
      ret += Math.min(v, numBuckets - 1);
    }
    return ret;
  }

  def({
    type: 't5-relbias', label: 'T5 Rel-Bias', cat: 'T5', color: '#818cf8',
    desc: 'T5 relative-position bias: a learned (buckets × heads) table ' +
          'gathered per query/key offset into the additive attention bias.',
    ins: ['x'], outs: ['bias'],
    params: [
      { key: 'heads', label: 'Heads', type: 'int', def: 8, min: 1, max: 64 },
      { key: 'buckets', label: 'Buckets', type: 'int', def: 32, min: 2, max: 256 },
      { key: 'maxDist', label: 'Max distance', type: 'int', def: 128, min: 8, max: 4096 },
      { key: 'bidir', label: 'Bidirectional', type: 'bool', def: true },
    ],
    shape: (ins, p) => {
      if (!Shape.isMatrix(ins[0])) return needMatrix('T5 Rel-Bias', ins[0]);
      const L = ins[0].dims[0];
      return [Shape.matrix(p.heads * L, L)];
    },
    stats: (ins, p) => ({ params: p.buckets * p.heads, flops: 0 }),
    exec: (T, ins, p, node) => {
      const L = ins[0].rows, H = p.heads, NB = p.buckets;
      const table = cached(node, 'rb' + NB + 'x' + H,
        () => boundW(node, T, 'table', NB, H, () => weight(T, NB, H, NB)));
      const tbl = table.download();                  // (NB, H) row-major
      const bias = new Float32Array(H * L * L);
      for (let q = 0; q < L; q++) {
        for (let k = 0; k < L; k++) {
          const b = t5Bucket(k - q, p.bidir, NB, p.maxDist);
          for (let h = 0; h < H; h++) bias[h * L * L + q * L + k] = tbl[b * H + h];
        }
      }
      const out = T.createTensor(H * L, L);
      out.upload(bias);
      return [out];
    },
  });

  def({
    type: 't5-attention', label: 'T5 Attention', cat: 'T5', color: '#818cf8',
    desc: 'T5 self-attention — scaled dot-product with an additive ' +
          'relative-position bias on the scores. Wire a T5 Rel-Bias into ' +
          'the bias port.',
    ins: ['x', 'bias'], outs: ['out'],
    params: [
      { key: 'heads', label: 'Heads', type: 'int', def: 8, min: 1, max: 64 },
      { key: 'scale', label: 'QK scale', type: 'float', def: 1, min: 0.001, max: 8, step: 0.001 },
    ],
    shape: (ins, p) => {
      if (!Shape.isMatrix(ins[0])) return needMatrix('T5 Attention', ins[0]);
      if (!Shape.isMatrix(ins[1])) return 'T5 Attention: bias must be a matrix';
      const L = ins[0].dims[0], D = ins[0].dims[1];
      if (D % p.heads !== 0)
        return 'feature dim ' + D + ' is not divisible by ' + p.heads + ' heads';
      if (ins[1].dims[0] !== p.heads * L || ins[1].dims[1] !== L)
        return 'bias must be (heads*L, L) = ' + (p.heads * L) + '×' + L +
          ', got ' + Shape.label(ins[1]);
      return [ins[0]];
    },
    stats: (ins, p) => {
      const L = ins[0].dims[0], D = ins[0].dims[1];
      return { params: 4 * D * D, flops: 4 * 2 * L * D * D + 2 * 2 * L * L * D };
    },
    exec: (T, ins, p, node) => {
      const x = ins[0], bias = ins[1], L = x.rows, D = x.cols;
      const w = cached(node, 't5a' + D, () => ({
        Wq: boundW(node, T, 'Wq', D, D, () => weight(T, D, D, D)),
        Wk: boundW(node, T, 'Wk', D, D, () => weight(T, D, D, D)),
        Wv: boundW(node, T, 'Wv', D, D, () => weight(T, D, D, D)),
        Wo: boundW(node, T, 'Wo', D, D, () => weight(T, D, D, D)),
      }));
      const O = T.createTensor(L, D);
      T.selfAttentionBiasForward(x, w.Wq, w.Wk, w.Wv, w.Wo, null, bias, p.heads, p.scale, O);
      return [O];
    },
  });

  def({
    type: 't5-ffn', label: 'T5 FFN', cat: 'T5', color: '#818cf8',
    desc: 'T5 v1.1 gated-GELU feed-forward: gelu(x·Wi0ᵀ) ⊙ (x·Wi1ᵀ), then ·Woᵀ.',
    ins: ['x'], outs: ['y'],
    params: [
      { key: 'dff', label: 'FFN dim', type: 'int', def: 512, min: 1, max: 32768 },
    ],
    shape: (ins) => Shape.isMatrix(ins[0]) ? [ins[0]] : needMatrix('T5 FFN', ins[0]),
    stats: (ins, p) => {
      const L = ins[0].dims[0], D = ins[0].dims[1];
      return { params: 3 * D * p.dff, flops: 6 * L * D * p.dff };
    },
    exec: (T, ins, p, node) => {
      const x = ins[0], L = x.rows, D = x.cols, F = p.dff;
      const w = cached(node, 't5f' + D + 'x' + F, () => ({
        wi0: boundW(node, T, 'wi0', F, D, () => weight(T, F, D, D)),
        wi1: boundW(node, T, 'wi1', F, D, () => weight(T, F, D, D)),
        wo:  boundW(node, T, 'wo',  D, F, () => weight(T, D, F, F)),
        zF: constant(T, F, 1, 0), zD: constant(T, D, 1, 0),
      }));
      const h0 = T.createTensor(L, F), h1 = T.createTensor(L, F);
      T.linearForwardBatched(w.wi0, w.zF, x, h0);
      T.linearForwardBatched(w.wi1, w.zF, x, h1);
      const g = T.createTensor(L, F);
      T.geluForward(h0, g);
      T.mulInplace(g, h1);
      const y = T.createTensor(L, D);
      T.linearForwardBatched(w.wo, w.zD, g, y);
      return [y];
    },
  });

  // === Convolution ======================================================
  def({
    type: 'conv2d', label: 'Conv2D', cat: 'Conv', color: '#f472b6',
    desc: 'NCHW 2-D convolution. Channels and spatial size are read from the ' +
          'input image tensor; only the output shape is configured here.',
    ins: ['x'], outs: ['y'],
    params: [
      { key: 'cout', label: 'Out channels', type: 'int', def: 16, min: 1, max: 1024 },
      { key: 'k', label: 'Kernel', type: 'int', def: 3, min: 1, max: 11 },
      { key: 'stride', label: 'Stride', type: 'int', def: 1, min: 1, max: 8 },
      { key: 'pad', label: 'Padding', type: 'int', def: 1, min: 0, max: 16 },
    ],
    shape: (ins, p) => {
      if (!Shape.isImage(ins[0]))
        return 'Conv2D needs an image (N×C×H×W) input, got ' + ins[0].layout;
      const H = ins[0].dims[2], W = ins[0].dims[3];
      const ho = ((H + 2 * p.pad - p.k) / p.stride | 0) + 1;
      const wo = ((W + 2 * p.pad - p.k) / p.stride | 0) + 1;
      if (ho < 1 || wo < 1) return 'kernel/stride/pad yield a non-positive output size';
      return [Shape.image(ins[0].dims[0], p.cout, ho, wo)];
    },
    stats: (ins, p) => {
      const C = ins[0].dims[1], H = ins[0].dims[2], W = ins[0].dims[3];
      const ho = ((H + 2 * p.pad - p.k) / p.stride | 0) + 1;
      const wo = ((W + 2 * p.pad - p.k) / p.stride | 0) + 1;
      return {
        params: p.cout * C * p.k * p.k + p.cout,
        flops: 2 * ins[0].dims[0] * p.cout * ho * wo * C * p.k * p.k,
      };
    },
    exec: (T, ins, p, node) => {
      const x = ins[0], sh = node.inShapes[0];
      const N = sh.dims[0], C = sh.dims[1], H = sh.dims[2], W = sh.dims[3];
      const ho = ((H + 2 * p.pad - p.k) / p.stride | 0) + 1;
      const wo = ((W + 2 * p.pad - p.k) / p.stride | 0) + 1;
      const w = cached(node, 'cv' + C + '_' + p.cout + '_' + p.k, () => ({
        W: weight(T, p.cout, C * p.k * p.k, C * p.k * p.k),
        b: constant(T, p.cout, 1, 0),
      }));
      const y = T.createTensor(N, p.cout * ho * wo);
      T.conv2dForward(x, w.W, w.b, N, C, H, W, p.cout, p.k, p.k,
        p.stride, p.stride, p.pad, p.pad, 1, 1, 1, y);
      return [y];
    },
  });

  def({
    type: 'conv-transpose2d', label: 'ConvTranspose2D', cat: 'Conv', color: '#f472b6',
    desc: 'Fractionally-strided (transposed) convolution — the learnable upsampler in ' +
          'GAN / VAE decoders and segmentation heads.',
    ins: ['x'], outs: ['y'],
    params: [
      { key: 'cout', label: 'Out channels', type: 'int', def: 8, min: 1, max: 1024 },
      { key: 'k', label: 'Kernel', type: 'int', def: 4, min: 1, max: 11 },
      { key: 'stride', label: 'Stride', type: 'int', def: 2, min: 1, max: 8 },
      { key: 'pad', label: 'Padding', type: 'int', def: 1, min: 0, max: 16 },
      { key: 'outpad', label: 'Output padding', type: 'int', def: 0, min: 0, max: 7 },
    ],
    shape: (ins, p) => {
      if (!Shape.isImage(ins[0]))
        return 'ConvTranspose2D needs an image (N×C×H×W) input, got ' + ins[0].layout;
      if (p.outpad >= p.stride) return 'output padding must be < stride';
      const H = ins[0].dims[2], W = ins[0].dims[3];
      const ho = (H - 1) * p.stride - 2 * p.pad + (p.k - 1) + p.outpad + 1;
      const wo = (W - 1) * p.stride - 2 * p.pad + (p.k - 1) + p.outpad + 1;
      if (ho < 1 || wo < 1) return 'kernel/stride/pad yield a non-positive output size';
      return [Shape.image(ins[0].dims[0], p.cout, ho, wo)];
    },
    stats: (ins, p) => {
      const C = ins[0].dims[1], H = ins[0].dims[2], W = ins[0].dims[3];
      return {
        params: C * p.cout * p.k * p.k + p.cout,
        flops: 2 * ins[0].dims[0] * C * H * W * p.cout * p.k * p.k,
      };
    },
    exec: (T, ins, p, node) => {
      const x = ins[0], sh = node.inShapes[0];
      const N = sh.dims[0], C = sh.dims[1], H = sh.dims[2], W = sh.dims[3];
      const ho = (H - 1) * p.stride - 2 * p.pad + (p.k - 1) + p.outpad + 1;
      const wo = (W - 1) * p.stride - 2 * p.pad + (p.k - 1) + p.outpad + 1;
      // Transposed-conv weight is (C_in, C_out·kH·kW).
      const w = cached(node, 'ct' + C + '_' + p.cout + '_' + p.k, () => ({
        W: weight(T, C, p.cout * p.k * p.k, C * p.k * p.k),
        b: constant(T, p.cout, 1, 0),
      }));
      const y = T.createTensor(N, p.cout * ho * wo);
      T.convTranspose2dForward(x, w.W, w.b, N, C, H, W, p.cout, p.k, p.k,
        p.stride, p.stride, p.pad, p.pad, p.outpad, p.outpad, 1, 1, 1, y);
      return [y];
    },
  });

  // === Spatial (NCHW pooling / resample / unfold) =======================
  def({
    type: 'maxpool2d', label: 'MaxPool2D', cat: 'Spatial', color: '#22d3ee',
    desc: 'NCHW max pooling — downsamples each channel by taking the window maximum.',
    ins: ['x'], outs: ['y'],
    params: [
      { key: 'k', label: 'Kernel', type: 'int', def: 2, min: 1, max: 8 },
      { key: 'stride', label: 'Stride', type: 'int', def: 2, min: 1, max: 8 },
      { key: 'pad', label: 'Padding', type: 'int', def: 0, min: 0, max: 4 },
    ],
    shape: (ins, p) => {
      if (!Shape.isImage(ins[0]))
        return 'MaxPool2D needs an image (N×C×H×W) input, got ' + ins[0].layout;
      const H = ins[0].dims[2], W = ins[0].dims[3];
      const ho = ((H + 2 * p.pad - p.k) / p.stride | 0) + 1;
      const wo = ((W + 2 * p.pad - p.k) / p.stride | 0) + 1;
      if (ho < 1 || wo < 1) return 'kernel/stride/pad yield a non-positive output size';
      return [Shape.image(ins[0].dims[0], ins[0].dims[1], ho, wo)];
    },
    stats: (ins, p) => {
      const C = ins[0].dims[1], H = ins[0].dims[2], W = ins[0].dims[3];
      const ho = ((H + 2 * p.pad - p.k) / p.stride | 0) + 1;
      const wo = ((W + 2 * p.pad - p.k) / p.stride | 0) + 1;
      return { params: 0, flops: ins[0].dims[0] * C * ho * wo * p.k * p.k };
    },
    exec: (T, ins, p, node) => {
      const sh = node.inShapes[0];
      const N = sh.dims[0], C = sh.dims[1], H = sh.dims[2], W = sh.dims[3];
      const ho = ((H + 2 * p.pad - p.k) / p.stride | 0) + 1;
      const wo = ((W + 2 * p.pad - p.k) / p.stride | 0) + 1;
      const y = T.createTensor(N, C * ho * wo);
      const idx = T.createTensor(N, C * ho * wo);     // argmax positions (kernel sets dtype)
      T.maxPool2dForward(ins[0], N, C, H, W, p.k, p.k, p.stride, p.stride, p.pad, p.pad, y, idx);
      return [y];
    },
  });

  def({
    type: 'avgpool', label: 'Adaptive AvgPool', cat: 'Spatial', color: '#22d3ee',
    desc: 'Adaptive average pool to a fixed output grid — the global-context pool before a ' +
          'classifier head (1×1 output = global average pool).',
    ins: ['x'], outs: ['y'],
    params: [
      { key: 'hout', label: 'Out H', type: 'int', def: 1, min: 1, max: 64 },
      { key: 'wout', label: 'Out W', type: 'int', def: 1, min: 1, max: 64 },
    ],
    shape: (ins, p) => Shape.isImage(ins[0])
      ? [Shape.image(ins[0].dims[0], ins[0].dims[1], p.hout, p.wout)]
      : 'Adaptive AvgPool needs an image (N×C×H×W) input, got ' + ins[0].layout,
    stats: (ins) => ({ params: 0, flops: Shape.elems(ins[0]) }),
    exec: (T, ins, p, node) => {
      const sh = node.inShapes[0];
      const N = sh.dims[0], C = sh.dims[1], H = sh.dims[2], W = sh.dims[3];
      const y = T.createTensor(N, C * p.hout * p.wout);
      T.adaptiveAvgPool2dForward(ins[0], N, C, H, W, p.hout, p.wout, y);
      return [y];
    },
  });

  def({
    type: 'upsample2x', label: 'Upsample 2×', cat: 'Spatial', color: '#22d3ee',
    desc: 'Doubles spatial size (NCHW) — nearest-neighbour or bilinear. The decoder upsample step.',
    ins: ['x'], outs: ['y'],
    params: [{ key: 'mode', label: 'Mode', type: 'select', def: 'bilinear', options: ['nearest', 'bilinear'] }],
    shape: (ins) => Shape.isImage(ins[0])
      ? [Shape.image(ins[0].dims[0], ins[0].dims[1], ins[0].dims[2] * 2, ins[0].dims[3] * 2)]
      : 'Upsample 2× needs an image (N×C×H×W) input, got ' + ins[0].layout,
    stats: (ins) => ({ params: 0, flops: 4 * Shape.elems(ins[0]) }),
    exec: (T, ins, p, node) => {
      const sh = node.inShapes[0];
      const N = sh.dims[0], C = sh.dims[1], H = sh.dims[2], W = sh.dims[3];
      const y = T.createTensor(N, C * (2 * H) * (2 * W));
      if (p.mode === 'nearest') T.upsampleNearest2xForward(ins[0], N, C, H, W, y);
      else T.upsampleBilinear2xForward(ins[0], N, C, H, W, y);
      return [y];
    },
  });

  def({
    type: 'downsample2x', label: 'Downsample 2×', cat: 'Spatial', color: '#22d3ee',
    desc: 'Halves spatial size with a 2×2 average pool (NCHW).',
    ins: ['x'], outs: ['y'], params: [],
    shape: (ins) => {
      if (!Shape.isImage(ins[0]))
        return 'Downsample 2× needs an image (N×C×H×W) input, got ' + ins[0].layout;
      const H = ins[0].dims[2], W = ins[0].dims[3];
      if (H % 2 || W % 2) return 'H and W must be even, got ' + H + '×' + W;
      return [Shape.image(ins[0].dims[0], ins[0].dims[1], H / 2, W / 2)];
    },
    stats: (ins) => ({ params: 0, flops: Shape.elems(ins[0]) }),
    exec: (T, ins, p, node) => {
      const sh = node.inShapes[0];
      const N = sh.dims[0], C = sh.dims[1], H = sh.dims[2], W = sh.dims[3];
      const y = T.createTensor(N, C * (H / 2) * (W / 2));
      T.downsampleAvg2xForward(ins[0], N, C, H, W, y);
      return [y];
    },
  });

  def({
    type: 'interp2d', label: 'Resize (Interp2D)', cat: 'Spatial', color: '#22d3ee',
    desc: 'Resample NCHW to an arbitrary H×W — nearest / bilinear / bicubic, half-pixel or ' +
          'corner-aligned. The DPT / Depth-Anything resize head.',
    ins: ['x'], outs: ['y'],
    params: [
      { key: 'hout', label: 'Out H', type: 'int', def: 32, min: 1, max: 1024 },
      { key: 'wout', label: 'Out W', type: 'int', def: 32, min: 1, max: 1024 },
      { key: 'mode', label: 'Mode', type: 'select', def: 'bilinear',
        options: ['nearest', 'bilinear', 'bicubic-pil', 'bicubic-torch'] },
      { key: 'align', label: 'Align corners', type: 'bool', def: false },
    ],
    shape: (ins, p) => Shape.isImage(ins[0])
      ? [Shape.image(ins[0].dims[0], ins[0].dims[1], p.hout, p.wout)]
      : 'Resize needs an image (N×C×H×W) input, got ' + ins[0].layout,
    stats: (ins, p) => ({ params: 0,
      flops: 4 * ins[0].dims[0] * ins[0].dims[1] * p.hout * p.wout }),
    exec: (T, ins, p, node) => {
      const sh = node.inShapes[0];
      const N = sh.dims[0], C = sh.dims[1], H = sh.dims[2], W = sh.dims[3];
      const MODES = { nearest: 0, bilinear: 1, 'bicubic-pil': 2, 'bicubic-torch': 3 };
      let mode = MODES[p.mode] != null ? MODES[p.mode] : 1;
      const y = T.createTensor(N, C * p.hout * p.wout);
      if (p.align) {
        if (mode === 3) mode = 2;   // corner-aligned variant supports modes 0/1/2 only
        T.interp2dAlignCornersForward(ins[0], N, C, H, W, p.hout, p.wout, mode, y);
      } else {
        T.interp2dForward(ins[0], N, C, H, W, p.hout, p.wout, mode, y);
      }
      return [y];
    },
  });

  def({
    type: 'unfold2d', label: 'Unfold 2D', cat: 'Spatial', color: '#22d3ee',
    desc: 'Spatial-preserving neighborhood im2col — each pixel gathers its k×k window into a ' +
          'channel block (C → C·k²) on a stride-1 grid. The cost-volume / local-attention prep.',
    ins: ['x'], outs: ['y'],
    params: [
      { key: 'k', label: 'Kernel', type: 'int', def: 3, min: 1, max: 9 },
      { key: 'mode', label: 'Pad mode', type: 'select', def: 'zero', options: ['zero', 'reflect', 'replicate'] },
    ],
    shape: (ins, p) => {
      if (!Shape.isImage(ins[0]))
        return 'Unfold 2D needs an image (N×C×H×W) input, got ' + ins[0].layout;
      const pad = (p.k - 1) >> 1;
      const ho = ins[0].dims[2] + 2 * pad - p.k + 1;
      const wo = ins[0].dims[3] + 2 * pad - p.k + 1;
      if (ho < 1 || wo < 1) return 'kernel too large for this input';
      return [Shape.image(ins[0].dims[0], ins[0].dims[1] * p.k * p.k, ho, wo)];
    },
    stats: (ins, p) => ({ params: 0, flops: Shape.elems(ins[0]) * p.k * p.k }),
    exec: (T, ins, p, node) => {
      const sh = node.inShapes[0];
      const N = sh.dims[0], C = sh.dims[1], H = sh.dims[2], W = sh.dims[3];
      const pad = (p.k - 1) >> 1;
      const ho = H + 2 * pad - p.k + 1, wo = W + 2 * pad - p.k + 1;
      const MODES = { zero: 0, reflect: 1, replicate: 2 };
      const mode = MODES[p.mode] || 0;
      const y = T.createTensor(N, C * p.k * p.k * ho * wo);
      T.unfold2dForward(ins[0], N, C, H, W, p.k, p.k, 1, 1, pad, pad, pad, pad, mode, y);
      return [y];
    },
  });

  def({
    type: 'pad2d', label: 'Pad 2D', cat: 'Spatial', color: '#22d3ee',
    desc: 'Spatial padding (NCHW) — zero, reflect, or replicate border.',
    ins: ['x'], outs: ['y'],
    params: [
      { key: 'pad', label: 'Padding', type: 'int', def: 1, min: 0, max: 32 },
      { key: 'mode', label: 'Mode', type: 'select', def: 'zero', options: ['zero', 'reflect', 'replicate'] },
    ],
    shape: (ins, p) => Shape.isImage(ins[0])
      ? [Shape.image(ins[0].dims[0], ins[0].dims[1], ins[0].dims[2] + 2 * p.pad, ins[0].dims[3] + 2 * p.pad)]
      : 'Pad 2D needs an image (N×C×H×W) input, got ' + ins[0].layout,
    stats: () => ({ params: 0, flops: 0 }),
    exec: (T, ins, p, node) => {
      const sh = node.inShapes[0];
      const N = sh.dims[0], C = sh.dims[1], H = sh.dims[2], W = sh.dims[3];
      const MODES = { zero: 0, reflect: 1, replicate: 2 };
      const mode = MODES[p.mode] || 0;
      const y = T.createTensor(N, C * (H + 2 * p.pad) * (W + 2 * p.pad));
      T.pad2dForward(ins[0], N, C, H, W, p.pad, p.pad, p.pad, p.pad, mode, y);
      return [y];
    },
  });

  def({
    type: 'spatial-merge', label: 'Spatial Merge 2×2', cat: 'Spatial', color: '#22d3ee',
    desc: 'Qwen-VL 2×2 token merge — folds each 2×2 spatial block into the channel axis: ' +
          '(N,C,H,W) → (N,4C,H/2,W/2).',
    ins: ['x'], outs: ['y'], params: [],
    shape: (ins) => {
      if (!Shape.isImage(ins[0]))
        return 'Spatial Merge needs an image (N×C×H×W) input, got ' + ins[0].layout;
      const H = ins[0].dims[2], W = ins[0].dims[3];
      if (H % 2 || W % 2) return 'H and W must be even, got ' + H + '×' + W;
      return [Shape.image(ins[0].dims[0], ins[0].dims[1] * 4, H / 2, W / 2)];
    },
    stats: () => ({ params: 0, flops: 0 }),
    exec: (T, ins, p, node) => {
      const sh = node.inShapes[0];
      const N = sh.dims[0], C = sh.dims[1], H = sh.dims[2], W = sh.dims[3];
      const y = T.createTensor(N, 4 * C * (H / 2) * (W / 2));
      T.spatialMerge2x2Forward(ins[0], N, C, H, W, y);
      return [y];
    },
  });

  def({
    type: 'convex-upsample', label: 'Convex Upsample', cat: 'Spatial', color: '#22d3ee',
    desc: 'RAFT-style learned-mask upsample: each fine pixel is a softmax-weighted blend of ' +
          'its 3×3 low-res neighborhood. The mask is synthesised here; (N,C,H,W) → (N,C,sH,sW).',
    ins: ['x'], outs: ['y'],
    params: [{ key: 'scale', label: 'Scale', type: 'int', def: 4, min: 2, max: 8 }],
    shape: (ins, p) => Shape.isImage(ins[0])
      ? [Shape.image(ins[0].dims[0], ins[0].dims[1], ins[0].dims[2] * p.scale, ins[0].dims[3] * p.scale)]
      : 'Convex Upsample needs an image (N×C×H×W) input, got ' + ins[0].layout,
    stats: (ins, p) => ({ params: 0,
      flops: 9 * Shape.elems(ins[0]) * p.scale * p.scale }),
    exec: (T, ins, p, node) => {
      const sh = node.inShapes[0];
      const N = sh.dims[0], C = sh.dims[1], H = sh.dims[2], W = sh.dims[3], s = p.scale;
      // Mask: (N, 9·s²·H·W) raw logits — the kernel softmaxes over the 9 neighbours.
      const mask = dataFill(T, N, 9 * s * s * H * W, 'gauss');
      const y = T.createTensor(N, C * (s * H) * (s * W));
      T.convexUpsampleForward(ins[0], mask, N, C, H, W, s, y);
      return [y];
    },
  });

  // === Layout (NCHW ↔ sequence bridge) ==================================
  def({
    type: 'nchw-to-seq', label: 'NCHW → Sequence', cat: 'Layout', color: '#cbd5e1',
    desc: 'Flatten a conv feature map into a token sequence — (N,C,H,W) → (N·H·W, C) — so ' +
          'transformer ops can consume it.',
    ins: ['x'], outs: ['y'], params: [],
    shape: (ins) => {
      if (!Shape.isImage(ins[0]))
        return 'NCHW → Sequence needs an image (N×C×H×W) input, got ' + ins[0].layout;
      const N = ins[0].dims[0], C = ins[0].dims[1], H = ins[0].dims[2], W = ins[0].dims[3];
      return [Shape.matrix(N * H * W, C)];
    },
    stats: () => ({ params: 0, flops: 0 }),
    exec: (T, ins, p, node) => {
      const sh = node.inShapes[0];
      const N = sh.dims[0], C = sh.dims[1], H = sh.dims[2], W = sh.dims[3];
      const y = T.createTensor(N * H * W, C);
      T.nchwToSequence(ins[0], N, C, H, W, y);
      return [y];
    },
  });

  // === Tensor ops =======================================================
  def({
    type: 'add', label: 'Add', cat: 'Tensor', color: '#94a3b8',
    desc: 'Element-wise sum — the residual / skip connection.',
    ins: ['a', 'b'], outs: ['sum'],
    params: [],
    shape: (ins) => Shape.eq(ins[0], ins[1])
      ? [ins[0]]
      : 'shapes differ: ' + Shape.label(ins[0]) + ' vs ' + Shape.label(ins[1]),
    stats: (ins) => ({ params: 0, flops: Shape.elems(ins[0]) }),
    exec: (T, ins) => {
      const y = ins[0].clone();
      T.addInplace(y, ins[1]);
      return [y];
    },
  });

  def({
    type: 'concat', label: 'Concat', cat: 'Tensor', color: '#94a3b8',
    desc: 'Concatenate two tensors along the feature axis — column-wise for ' +
          'matrices, channel-wise (N,H,W matched) for images.',
    ins: ['a', 'b'], outs: ['out'],
    params: [],
    shape: (ins) => {
      const a = ins[0], b = ins[1];
      if (a.layout !== b.layout)
        return 'cannot concat a ' + a.layout + ' with an ' + b.layout;
      if (Shape.isImage(a)) {
        if (a.dims[0] !== b.dims[0] || a.dims[2] !== b.dims[2] || a.dims[3] !== b.dims[3])
          return 'image concat needs matching N,H,W: ' +
            Shape.label(a) + ' vs ' + Shape.label(b);
        return [Shape.image(a.dims[0], a.dims[1] + b.dims[1], a.dims[2], a.dims[3])];
      }
      if (a.dims[0] !== b.dims[0])
        return 'row counts differ: ' + a.dims[0] + ' vs ' + b.dims[0];
      return [Shape.matrix(a.dims[0], a.dims[1] + b.dims[1])];
    },
    stats: () => ({ params: 0, flops: 0 }),
    exec: (T, ins, p, node) => {
      const a = node.inShapes[0];
      if (Shape.isImage(a)) {
        const N = a.dims[0], H = a.dims[2], W = a.dims[3];
        const C0 = a.dims[1], C1 = node.inShapes[1].dims[1];
        const out = T.createTensor(N, (C0 + C1) * H * W);
        T.concatNchwChannels([ins[0], ins[1]], N, H, W, [C0, C1], out);
        return [out];
      }
      const out = T.createTensor(ins[0].rows, ins[0].cols + ins[1].cols);
      T.concatBatchedRows([ins[0], ins[1]], out);
      return [out];
    },
  });

  def({
    type: 'clamp', label: 'Clamp', cat: 'Tensor', color: '#94a3b8',
    desc: 'Element-wise clip into [lo, hi] — the saturating activation (e.g. ReLU6 with 0..6).',
    ins: ['x'], outs: ['y'],
    params: [
      { key: 'lo', label: 'Min', type: 'float', def: -1, min: -1e6, max: 1e6, step: 0.1 },
      { key: 'hi', label: 'Max', type: 'float', def: 1, min: -1e6, max: 1e6, step: 0.1 },
    ],
    shape: (ins, p) => p.hi < p.lo ? 'Max must be ≥ Min' : [ins[0]],
    stats: (ins) => ({ params: 0, flops: 2 * Shape.elems(ins[0]) }),
    exec: (T, ins, p) => {
      const y = ins[0].clone();
      T.clamp(y, p.lo, p.hi);
      return [y];
    },
  });

  def({
    type: 'meanpool', label: 'Mean Pool', cat: 'Tensor', color: '#94a3b8',
    desc: 'Average over the token/row axis — collapses a sequence (L×D) into one pooled ' +
          'feature vector (D×1). The sentence-embedding / global-pool readout.',
    ins: ['x'], outs: ['y'], params: [],
    shape: (ins) => Shape.isMatrix(ins[0])
      ? [Shape.matrix(ins[0].dims[1], 1)]
      : needMatrix('Mean Pool', ins[0]),
    stats: (ins) => ({ params: 0, flops: Shape.elems(ins[0]) }),
    exec: (T, ins) => {
      const y = T.createTensor(ins[0].cols, 1);
      T.maskedMeanPoolForward(ins[0], null, y);
      return [y];
    },
  });

  // ---- public API ------------------------------------------------------
  const ORDER = ['Source', 'Dense', 'Activation', 'Norm', 'Attention', 'T5',
    'Conv', 'Spatial', 'Layout', 'Tensor'];
  export const Ops = {
    defs: DEFS,
    get: (type) => DEFS[type],
    list: () => Object.keys(DEFS).map((k) => DEFS[k]),
    categories: () => ORDER,
    byCategory: (cat) => Object.keys(DEFS).map((k) => DEFS[k]).filter((d) => d.cat === cat),
  };
