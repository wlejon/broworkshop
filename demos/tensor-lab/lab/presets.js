// Tensor Lab — preset architectures.
//
// Each preset wires a real modern network block out of the op registry.
// They load straight into the freeform editor, so they double as both a
// guided tour and an editable starting point.
(function () {
  'use strict';
  const Lab = (window.Lab = window.Lab || {});

  // layered (left-to-right) auto-layout over a DAG
  function autoLayout(g) {
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
  Lab.autoLayout = autoLayout;

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
  ];

  Lab.Presets = {
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
})();
