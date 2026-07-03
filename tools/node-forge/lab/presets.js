// Tensor Lab — preset architectures.
//
// Each preset wires a real modern network block out of the op registry.
// They load straight into the freeform editor, so they double as both a
// guided tour and an editable starting point.
  // layered (left-to-right) auto-layout over a DAG
  export function autoLayout(g) {
    const order = g.topo();
    if (!order) return;
    const depth = new Map();
    for (const n of order) {
      let d = 0;
      for (const e of g.edges) {
        if (e.to.node === n) d = Math.max(d, (depth.get(e.from.node) || 0) + 1);
      }
      depth.set(n, d);
    }
    const cols = {};
    for (const n of g.nodes) {
      const d = depth.get(n) || 0;
      (cols[d] = cols[d] || []).push(n);
    }
    const COLW = 218, ROWH = 138;
    for (const d in cols) {
      const list = cols[d];
      const y0 = 70 - ((list.length - 1) * ROWH) / 2;
      for (let i = 0; i < list.length; i++) {
        list[i].x = 70 + d * COLW;
        list[i].y = Math.max(40, y0 + 110) + i * ROWH;
      }
    }
  }
  // small builder: add(type, params) -> node ; link(from, to, toPort, fromPort)
  function builder(g) {
    return {
      add(type, params) {
        const n = g.addNode(type, 0, 0);
        if (params) Object.assign(n.params, params);
        return n;
      },
      link(from, to, toPort, fromPort) {
        g.addEdge(from, fromPort || 0, to, toPort || 0);
      },
    };
  }

  const PRESETS = [
    {
      name: 'Perceptron (MLP)',
      desc: 'The simplest net: two dense layers with a GELU between them.',
      build(g) {
        const b = builder(g);
        const x = b.add('input', { rows: 16, cols: 64, fill: 'gauss' });
        const h1 = b.add('linear', { out: 256 });
        const a = b.add('gelu');
        const h2 = b.add('linear', { out: 10 });
        b.link(x, h1); b.link(h1, a); b.link(a, h2);
      },
    },
    {
      name: 'Transformer Encoder Block',
      desc: 'Pre-norm encoder layer: LayerNorm → MHA → residual → LayerNorm → GELU FFN → residual.',
      build(g) {
        const b = builder(g);
        const x = b.add('input', { rows: 32, cols: 128, fill: 'gauss' });
        const ln1 = b.add('layernorm');
        const attn = b.add('mha', { heads: 4 });
        const add1 = b.add('add');
        const ln2 = b.add('layernorm');
        const ff1 = b.add('linear', { out: 512 });
        const act = b.add('gelu');
        const ff2 = b.add('linear', { out: 128 });
        const add2 = b.add('add');
        b.link(x, ln1); b.link(ln1, attn);
        b.link(attn, add1, 0); b.link(x, add1, 1);
        b.link(add1, ln2); b.link(ln2, ff1); b.link(ff1, act); b.link(act, ff2);
        b.link(ff2, add2, 0); b.link(add1, add2, 1);
      },
    },
    {
      name: 'Llama Block',
      desc: 'Decoder-style block: RMSNorm + RoPE + MHA, then a SwiGLU gated FFN — both residual.',
      build(g) {
        const b = builder(g);
        const x = b.add('input', { rows: 32, cols: 128, fill: 'gauss' });
        const rms1 = b.add('rmsnorm');
        const rope = b.add('rope', { heads: 4 });
        const attn = b.add('mha', { heads: 4 });
        const add1 = b.add('add');
        const rms2 = b.add('rmsnorm');
        const ff1 = b.add('linear', { out: 512 });
        const glu = b.add('swiglu');
        const ff2 = b.add('linear', { out: 128 });
        const add2 = b.add('add');
        b.link(x, rms1); b.link(rms1, rope); b.link(rope, attn);
        b.link(attn, add1, 0); b.link(x, add1, 1);
        b.link(add1, rms2); b.link(rms2, ff1); b.link(ff1, glu); b.link(glu, ff2);
        b.link(ff2, add2, 0); b.link(add1, add2, 1);
      },
    },
    {
      name: 'T5 Encoder Layer',
      desc: 'A T5 v1.1 encoder block: RMSNorm → relative-position-bias ' +
            'self-attention → residual → RMSNorm → gated-GELU FFN → residual.',
      build(g) {
        const b = builder(g);
        const emb = b.add('embedding', { vocab: 256, dim: 128, batch: 32 });
        const rb = b.add('t5-relbias', { heads: 8 });
        const ln1 = b.add('rmsnorm');
        const attn = b.add('t5-attention', { heads: 8 });
        const add1 = b.add('add');
        const ln2 = b.add('rmsnorm');
        const ffn = b.add('t5-ffn', { dff: 512 });
        const add2 = b.add('add');
        b.link(emb, rb);
        b.link(emb, ln1);
        b.link(ln1, attn, 0); b.link(rb, attn, 1);
        b.link(attn, add1, 0); b.link(emb, add1, 1);
        b.link(add1, ln2); b.link(ln2, ffn);
        b.link(ffn, add2, 0); b.link(add1, add2, 1);
      },
    },
    {
      name: 'Vision Transformer Block',
      desc: 'ViT/CLIP encoder layer — same shape as a transformer block but with the QuickGELU FFN.',
      build(g) {
        const b = builder(g);
        const x = b.add('input', { rows: 64, cols: 192, fill: 'gauss' });
        const ln1 = b.add('layernorm');
        const attn = b.add('mha', { heads: 6 });
        const add1 = b.add('add');
        const ln2 = b.add('layernorm');
        const ff1 = b.add('linear', { out: 768 });
        const act = b.add('quickgelu');
        const ff2 = b.add('linear', { out: 192 });
        const add2 = b.add('add');
        b.link(x, ln1); b.link(ln1, attn);
        b.link(attn, add1, 0); b.link(x, add1, 1);
        b.link(add1, ln2); b.link(ln2, ff1); b.link(ff1, act); b.link(act, ff2);
        b.link(ff2, add2, 0); b.link(add1, add2, 1);
      },
    },
    {
      name: 'CNN Stem',
      desc: 'Two 3×3 convolutions with ReLU — the front end of a vision backbone.',
      build(g) {
        const b = builder(g);
        const x = b.add('image', { n: 1, c: 3, h: 32, w: 32, fill: 'gauss' });
        const c1 = b.add('conv2d', { cout: 16, k: 3, stride: 1, pad: 1 });
        const r1 = b.add('relu');
        const c2 = b.add('conv2d', { cout: 32, k: 3, stride: 1, pad: 1 });
        const r2 = b.add('relu');
        b.link(x, c1); b.link(c1, r1); b.link(r1, c2); b.link(c2, r2);
      },
    },
    {
      name: 'Attention Lab',
      desc: 'A focused attention setup — embed tokens, normalise, then 8-head attention. Inspect the heatmap.',
      build(g) {
        const b = builder(g);
        const emb = b.add('embedding', { vocab: 256, dim: 128, batch: 28 });
        const rms = b.add('rmsnorm');
        const attn = b.add('mha', { heads: 8 });
        const proj = b.add('linear', { out: 128 });
        b.link(emb, rms); b.link(rms, attn); b.link(attn, proj);
      },
    },
    {
      name: 'SAM Window Encoder Block',
      desc: 'A SAM / ViTDet encoder layer — decomposed relative-position attention on an ' +
            '8×8 patch grid, then a GELU MLP. Both residual.',
      build(g) {
        const b = builder(g);
        const x = b.add('input', { rows: 64, cols: 128, fill: 'gauss' });   // 8×8 grid · D=128
        const ln1 = b.add('layernorm');
        const attn = b.add('sam-attn', { heads: 4, gridH: 8, gridW: 8, window: 0 });
        const add1 = b.add('add');
        const ln2 = b.add('layernorm');
        const ff1 = b.add('linear', { out: 512 });
        const act = b.add('gelu');
        const ff2 = b.add('linear', { out: 128 });
        const add2 = b.add('add');
        b.link(x, ln1); b.link(ln1, attn);
        b.link(attn, add1, 0); b.link(x, add1, 1);
        b.link(add1, ln2); b.link(ln2, ff1); b.link(ff1, act); b.link(act, ff2);
        b.link(ff2, add2, 0); b.link(add1, add2, 1);
      },
    },
    {
      name: 'Conv → Transformer Bridge',
      desc: 'A conv stem flattened into tokens — Conv2D → GroupNorm → GELU → NCHW→Sequence → ' +
            'LayerNorm → attention. The hybrid-backbone pattern.',
      build(g) {
        const b = builder(g);
        const x = b.add('image', { n: 1, c: 3, h: 16, w: 16, fill: 'gauss' });
        const c1 = b.add('conv2d', { cout: 32, k: 3, stride: 1, pad: 1 });
        const gn = b.add('groupnorm', { groups: 8 });
        const act = b.add('gelu');
        const seq = b.add('nchw-to-seq');
        const ln = b.add('layernorm');
        const attn = b.add('mha', { heads: 4 });
        b.link(x, c1); b.link(c1, gn); b.link(gn, act); b.link(act, seq);
        b.link(seq, ln); b.link(ln, attn);
      },
    },
    {
      name: 'Dense-Prediction Upsample Head',
      desc: 'A depth/normal decoder — ConvTranspose2D learnable upsample, bilinear 2×, an ' +
            'arbitrary corner-aligned resize, a 3×3 conv, then per-pixel L2 normalize ' +
            '(DPT / DSINE direction field).',
      build(g) {
        const b = builder(g);
        const x = b.add('image', { n: 1, c: 16, h: 8, w: 8, fill: 'gauss' });
        const ct = b.add('conv-transpose2d', { cout: 8, k: 4, stride: 2, pad: 1, outpad: 0 });
        const r = b.add('relu');
        const up = b.add('upsample2x', { mode: 'bilinear' });
        const rz = b.add('interp2d', { hout: 48, wout: 48, mode: 'bilinear', align: true });
        const c = b.add('conv2d', { cout: 3, k: 3, stride: 1, pad: 1 });
        const n = b.add('l2norm-pixel');
        b.link(x, ct); b.link(ct, r); b.link(r, up); b.link(up, rz); b.link(rz, c); b.link(c, n);
      },
    },
    {
      name: 'Sliding-Window Attention',
      desc: 'Streaming-codec attention — token embeddings through a causal flash-attention with ' +
            'a sliding key window. Edit the Window field (0 = full) to compare local vs. global.',
      build(g) {
        const b = builder(g);
        const emb = b.add('embedding', { vocab: 256, dim: 128, batch: 48 });
        const ln = b.add('rmsnorm');
        const attn = b.add('flash-attn', { heads: 4, causal: true, window: 8 });
        const proj = b.add('linear', { out: 128 });
        b.link(emb, ln); b.link(ln, attn); b.link(attn, proj);
      },
    },
    {
      name: 'RAVE Latent Morph',
      desc: 'Encode a tone into RAVE\'s latent time-series, paint a dimension by hand, decode ' +
            'and preview both the original synth and the morphed result. Edit dir/paths for your setup.',
      build(g) {
        const b = builder(g);
        const load = b.add('rave-load', { dir: 'D:/projects/brosoundml-data/rave/magnets_z8' });
        const source = b.add('rave-source', { kind: 'harm', freq: 220, secs: 2.0 });
        const encode = b.add('rave-encode');
        const curve = b.add('rave-curve-edit');
        const decode = b.add('rave-decode');
        const preview = b.add('audio-preview');
        b.link(load, source, 0); b.link(load, encode, 0); b.link(source, encode, 1);
        b.link(encode, curve, 0);
        b.link(load, decode, 0); b.link(curve, decode, 1);
        b.link(decode, preview, 0);
      },
    },
    {
      name: 'Kokoro Voice Design',
      desc: 'Design a voice by position in the PCA basis, synthesize with a captured pitch/energy ' +
            'trace, then paint the prosody and re-decode just the back half. Edit dir/paths for your setup.',
      build(g) {
        const b = builder(g);
        const load = b.add('kokoro-load', {
          dir: 'D:/projects/brosoundml-data/kokoro',
          dataRoot: 'D:/projects/brosoundml-data',
        });
        const basis = b.add('kokoro-basis', { path: 'D:/projects/brosoundml-data/kokoro/voice_basis.json' });
        const design = b.add('kokoro-voice-design');
        const text = b.add('kokoro-text', { text: 'Hello, Bro.' });
        const synth = b.add('kokoro-synthesize');
        const prosody = b.add('kokoro-prosody-edit');
        const redecode = b.add('kokoro-redecode');
        const previewA = b.add('audio-preview');
        const previewB = b.add('audio-preview');
        b.link(load, design, 0); b.link(basis, design, 1);
        b.link(load, text, 0);
        b.link(load, synth, 0); b.link(design, synth, 1); b.link(text, synth, 2);
        b.link(synth, previewA, 0, 0);
        b.link(synth, prosody, 0, 1);
        b.link(load, redecode, 0); b.link(design, redecode, 1); b.link(prosody, redecode, 2);
        b.link(redecode, previewB, 0);
      },
    },
  ];

  export const Presets = {
    list: () => PRESETS,
    load(name, g) {
      const p = PRESETS.find((x) => x.name === name);
      if (!p) return false;
      g.nodes.length = 0;
      g.edges.length = 0;
      p.build(g);
      autoLayout(g);
      g.propagate();
      return true;
    },
  };
