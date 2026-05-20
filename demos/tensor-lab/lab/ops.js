// Tensor Lab — operation registry.
//
// Every op carries four things:
//   shape(ins,p)  pure-JS shape inference  -> [{rows,cols}] or an error string
//   stats(ins,p)  parameter + FLOP estimate
//   exec(T,ins,p,node)  the real bro.tensor GPU call -> [GpuTensor]
//   params[]      config fields surfaced in the inspector
//
// Source ops (input, embedding) take zero inputs. Learnable weights are
// created lazily and cached on the node, rebuilt only when their signature
// (the dims they depend on) changes — so re-running keeps a stable network
// and only the activations move.
(function () {
  'use strict';
  const Lab = (window.Lab = window.Lab || {});

  // ---- number formatting (shared across modules) -----------------------
  Lab.fmtNum = function (n) {
    if (n == null || !isFinite(n)) return '—';
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(2) + 'G';
    if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(n | 0);
  };
  Lab.fmtMs = function (ms) {
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

  const S = (rows, cols) => ({ rows: rows, cols: cols });

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
    shape: (ins, p) => [S(p.rows, p.cols)],
    stats: () => ({ params: 0, flops: 0 }),
    exec: (T, ins, p) => [dataFill(T, p.rows, p.cols, p.fill)],
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
    shape: (ins, p) => [S(p.batch, p.dim)],
    stats: (ins, p) => ({ params: p.vocab * p.dim, flops: 0 }),
    exec: (T, ins, p, node) => {
      const table = cached(node, 'e' + p.vocab + 'x' + p.dim,
        () => weight(T, p.vocab, p.dim, p.dim));
      const idxI = new Int32Array(p.batch);
      for (let i = 0; i < p.batch; i++) idxI[i] = (Math.random() * p.vocab) | 0;
      const idx = T.createTensor(p.batch, 1);
      idx.upload(new Float32Array(idxI.buffer));
      const out = T.createTensor(p.batch, p.dim);
      T.embeddingLookupForward(table, idx, p.batch, out);
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
    shape: (ins, p) => [S(ins[0].rows, p.out)],
    stats: (ins, p) => {
      const inF = ins[0].cols;
      return { params: inF * p.out + (p.bias ? p.out : 0), flops: 2 * ins[0].rows * inF * p.out };
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
    shape: (ins) => ins[0].cols !== ins[1].rows
      ? 'inner dims differ: A is ' + ins[0].rows + '×' + ins[0].cols +
        ', B is ' + ins[1].rows + '×' + ins[1].cols
      : [S(ins[0].rows, ins[1].cols)],
    stats: (ins) => ({ params: 0, flops: 2 * ins[0].rows * ins[0].cols * ins[1].cols }),
    exec: (T, ins) => {
      const c = T.createTensor(ins[0].rows, ins[1].cols);
      T.matmul(ins[0], ins[1], c);
      return [c];
    },
  });

  // === Activations ======================================================
  function activation(type, label, desc, opName, flopK) {
    def({
      type: type, label: label, cat: 'Activation', color: '#a78bfa', desc: desc,
      ins: ['x'], outs: ['y'], params: [],
      shape: (ins) => [S(ins[0].rows, ins[0].cols)],
      stats: (ins) => ({ params: 0, flops: flopK * ins[0].rows * ins[0].cols }),
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

  def({
    type: 'swiglu', label: 'SwiGLU', cat: 'Activation', color: '#a78bfa',
    desc: 'Gated FFN activation: input (B×2D) splits to A,B; output silu(A)·B  (B×D).',
    ins: ['x'], outs: ['y'], params: [],
    shape: (ins) => ins[0].cols % 2 !== 0
      ? 'SwiGLU needs an even feature count, got ' + ins[0].cols
      : [S(ins[0].rows, ins[0].cols / 2)],
    stats: (ins) => ({ params: 0, flops: 6 * ins[0].rows * ins[0].cols }),
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
    shape: (ins) => [S(ins[0].rows, ins[0].cols)],
    stats: (ins) => ({ params: 0, flops: 5 * ins[0].rows * ins[0].cols }),
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
    shape: (ins) => [S(ins[0].rows, ins[0].cols)],
    stats: (ins) => ({ params: 2 * ins[0].cols, flops: 8 * ins[0].rows * ins[0].cols }),
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
    shape: (ins) => [S(ins[0].rows, ins[0].cols)],
    stats: (ins) => ({ params: ins[0].cols, flops: 6 * ins[0].rows * ins[0].cols }),
    exec: (T, ins, p, node) => {
      const x = ins[0], D = x.cols;
      const g = cached(node, 'rms' + D, () => constant(T, D, 1, 1));
      const y = T.createTensor(x.rows, D);
      T.rmsNormForward(x, g, p.eps, y);
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
      const D = ins[0].cols;
      if (D % p.heads !== 0) return 'feature dim ' + D + ' is not divisible by ' + p.heads + ' heads';
      return [S(ins[0].rows, D)];
    },
    stats: (ins, p) => {
      const Sq = ins[0].rows, D = ins[0].cols;
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
      const D = ins[0].cols;
      if (D % p.heads !== 0) return 'feature dim ' + D + ' is not divisible by ' + p.heads + ' heads';
      if ((D / p.heads) % 2 !== 0) return 'head dim ' + (D / p.heads) + ' must be even';
      return [S(ins[0].rows, D)];
    },
    stats: (ins) => ({ params: 0, flops: 6 * ins[0].rows * ins[0].cols }),
    exec: (T, ins, p) => {
      const x = ins[0], hd = x.cols / p.heads;
      const y = T.createTensor(x.rows, x.cols);
      T.ropeForward(x, hd, p.heads, 0, p.theta, y);
      return [y];
    },
  });

  // === Convolution ======================================================
  def({
    type: 'conv2d', label: 'Conv2D', cat: 'Conv', color: '#f472b6',
    desc: 'NCHW 2-D convolution. The input row is a flattened (C·H·W) image.',
    ins: ['x'], outs: ['y'],
    params: [
      { key: 'cin', label: 'In channels', type: 'int', def: 3, min: 1, max: 1024 },
      { key: 'h', label: 'In height', type: 'int', def: 32, min: 1, max: 256 },
      { key: 'w', label: 'In width', type: 'int', def: 32, min: 1, max: 256 },
      { key: 'cout', label: 'Out channels', type: 'int', def: 16, min: 1, max: 1024 },
      { key: 'k', label: 'Kernel', type: 'int', def: 3, min: 1, max: 11 },
      { key: 'stride', label: 'Stride', type: 'int', def: 1, min: 1, max: 8 },
      { key: 'pad', label: 'Padding', type: 'int', def: 1, min: 0, max: 16 },
    ],
    shape: (ins, p) => {
      const need = p.cin * p.h * p.w;
      if (ins[0].cols !== need)
        return 'input has ' + ins[0].cols + ' cols, expected C·H·W = ' + need;
      const ho = ((p.h + 2 * p.pad - p.k) / p.stride | 0) + 1;
      const wo = ((p.w + 2 * p.pad - p.k) / p.stride | 0) + 1;
      if (ho < 1 || wo < 1) return 'kernel/stride/pad yield a non-positive output size';
      return [S(ins[0].rows, p.cout * ho * wo)];
    },
    stats: (ins, p) => {
      const ho = ((p.h + 2 * p.pad - p.k) / p.stride | 0) + 1;
      const wo = ((p.w + 2 * p.pad - p.k) / p.stride | 0) + 1;
      return {
        params: p.cout * p.cin * p.k * p.k + p.cout,
        flops: 2 * ins[0].rows * p.cout * ho * wo * p.cin * p.k * p.k,
      };
    },
    exec: (T, ins, p, node) => {
      const x = ins[0], N = x.rows;
      const ho = ((p.h + 2 * p.pad - p.k) / p.stride | 0) + 1;
      const wo = ((p.w + 2 * p.pad - p.k) / p.stride | 0) + 1;
      const w = cached(node, 'cv' + p.cin + '_' + p.cout + '_' + p.k, () => ({
        W: weight(T, p.cout, p.cin * p.k * p.k, p.cin * p.k * p.k),
        b: constant(T, p.cout, 1, 0),
      }));
      const y = T.createTensor(N, p.cout * ho * wo);
      T.conv2dForward(x, w.W, w.b, N, p.cin, p.h, p.w, p.cout, p.k, p.k,
        p.stride, p.stride, p.pad, p.pad, 1, 1, 1, y);
      return [y];
    },
  });

  // === Tensor ops =======================================================
  def({
    type: 'add', label: 'Add', cat: 'Tensor', color: '#94a3b8',
    desc: 'Element-wise sum — the residual / skip connection.',
    ins: ['a', 'b'], outs: ['sum'],
    params: [],
    shape: (ins) => (ins[0].rows !== ins[1].rows || ins[0].cols !== ins[1].cols)
      ? 'shapes differ: ' + ins[0].rows + '×' + ins[0].cols +
        ' vs ' + ins[1].rows + '×' + ins[1].cols
      : [S(ins[0].rows, ins[0].cols)],
    stats: (ins) => ({ params: 0, flops: ins[0].rows * ins[0].cols }),
    exec: (T, ins) => {
      const y = ins[0].clone();
      T.addInplace(y, ins[1]);
      return [y];
    },
  });

  def({
    type: 'concat', label: 'Concat', cat: 'Tensor', color: '#94a3b8',
    desc: 'Concatenate two tensors along the feature axis (same row count).',
    ins: ['a', 'b'], outs: ['out'],
    params: [],
    shape: (ins) => ins[0].rows !== ins[1].rows
      ? 'row counts differ: ' + ins[0].rows + ' vs ' + ins[1].rows
      : [S(ins[0].rows, ins[0].cols + ins[1].cols)],
    stats: () => ({ params: 0, flops: 0 }),
    exec: (T, ins) => {
      const out = T.createTensor(ins[0].rows, ins[0].cols + ins[1].cols);
      T.concatBatchedRows([ins[0], ins[1]], out);
      return [out];
    },
  });

  // ---- public API ------------------------------------------------------
  const ORDER = ['Source', 'Dense', 'Activation', 'Norm', 'Attention', 'Conv', 'Tensor'];
  Lab.Ops = {
    defs: DEFS,
    get: (type) => DEFS[type],
    list: () => Object.keys(DEFS).map((k) => DEFS[k]),
    categories: () => ORDER,
    byCategory: (cat) => Object.keys(DEFS).map((k) => DEFS[k]).filter((d) => d.cat === cat),
  };
})();
