// Tensor Lab — the Attention and T5 encoder ops, split out of lab/ops.js.
//
// ops.js calls registerAttentionOps() with its registry function and the
// shared tensor helpers, at the point in the registry where these ops belong.
import { Shape } from "/app/lab/shape.js";

export function registerAttentionOps(h) {
  const { def, cached, weight, constant, boundW, needMatrix } = h;

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
          for (let hh = 0; hh < H; hh++) bias[hh * L * L + q * L + k] = tbl[b * H + hh];
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
}

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
