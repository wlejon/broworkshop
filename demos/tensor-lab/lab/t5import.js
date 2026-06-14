// Tensor Lab — T5 text-encoder importer.
//
// Opens a Hugging Face T5 .safetensors checkpoint, infers its config from
// the tensor shapes, and stamps an encoder graph whose nodes are bound to
// the real weights. A bound node carries `node.bind = { file, keys }`; on
// first run boundW() in ops.js loads the named tensor through the open
// safetensors file instead of synthesising a random weight.
//
// The graph is built from the same ops as the freeform editor — embedding,
// rmsnorm, t5-relbias, t5-attention, t5-ffn, add — so every layer is a
// navigable circuit, not an opaque blob.
import { autoLayout } from "/app/lab/presets.js";

  // first present name from a candidate list
  function firstName(hdr, cands) {
    for (const c of cands) if (hdr[c]) return c;
    return null;
  }

  // Infer { vocab, dModel, heads, buckets, dff, layers } from tensor shapes.
  function inferConfig(file) {
    const hdr = file.header();
    const embKey = firstName(hdr, ['shared.weight', 'encoder.embed_tokens.weight']);
    if (!embKey) throw new Error('no token-embedding tensor (shared.weight)');
    const rbKey = 'encoder.block.0.layer.0.SelfAttention.relative_attention_bias.weight';
    if (!hdr[rbKey]) throw new Error('not a T5 encoder checkpoint — no relative_attention_bias');
    const wiKey = 'encoder.block.0.layer.1.DenseReluDense.wi_0.weight';
    if (!hdr[wiKey]) throw new Error('missing DenseReluDense.wi_0 — not a T5 v1.1 encoder');
    let maxB = -1;
    const names = file.names();
    for (let i = 0; i < names.length; i++) {
      const m = names[i].match(/encoder\.block\.(\d+)\./);
      if (m) maxB = Math.max(maxB, +m[1]);
    }
    return {
      embKey: embKey,
      vocab:  hdr[embKey].shape[0],
      dModel: hdr[embKey].shape[1],
      heads:  hdr[rbKey].shape[1],
      buckets: hdr[rbKey].shape[0],
      dff:    hdr[wiKey].shape[0],
      layers: maxB + 1,
      hasFinalLn: !!hdr['encoder.final_layer_norm.weight'],
    };
  }

  // Build `opts.layers` encoder blocks (default 2) into `graph`, each bound
  // to `file`. Returns the inferred config plus how many layers were stamped.
  function importEncoder(file, graph, opts) {
    opts = opts || {};
    const cfg = inferConfig(file);
    const nLayers = Math.max(1, Math.min(opts.layers || 2, cfg.layers));
    const seqLen = opts.seqLen || 16;

    graph.nodes.length = 0;
    graph.edges.length = 0;

    function add(type, params, keys) {
      const n = graph.addNode(type, 0, 0);
      if (params) Object.assign(n.params, params);
      if (keys) n.bind = { file: file, keys: keys };
      return n;
    }
    function link(from, to, toPort, fromPort) {
      graph.addEdge(from, fromPort || 0, to, toPort || 0);
    }
    const blk = (i, rest) => 'encoder.block.' + i + '.' + rest;

    // token embedding + the relative-position bias shared across all layers
    const emb = add('embedding',
      { vocab: cfg.vocab, dim: cfg.dModel, batch: seqLen },
      { table: cfg.embKey });
    const rb = add('t5-relbias',
      { heads: cfg.heads, buckets: cfg.buckets, maxDist: 128, bidir: true },
      { table: blk(0, 'layer.0.SelfAttention.relative_attention_bias.weight') });
    link(emb, rb);

    let x = emb;
    for (let i = 0; i < nLayers; i++) {
      const ln1 = add('rmsnorm', null, { g: blk(i, 'layer.0.layer_norm.weight') });
      const attn = add('t5-attention', { heads: cfg.heads, scale: 1.0 }, {
        Wq: blk(i, 'layer.0.SelfAttention.q.weight'),
        Wk: blk(i, 'layer.0.SelfAttention.k.weight'),
        Wv: blk(i, 'layer.0.SelfAttention.v.weight'),
        Wo: blk(i, 'layer.0.SelfAttention.o.weight'),
      });
      const add1 = add('add');
      const ln2 = add('rmsnorm', null, { g: blk(i, 'layer.1.layer_norm.weight') });
      const ffn = add('t5-ffn', { dff: cfg.dff }, {
        wi0: blk(i, 'layer.1.DenseReluDense.wi_0.weight'),
        wi1: blk(i, 'layer.1.DenseReluDense.wi_1.weight'),
        wo:  blk(i, 'layer.1.DenseReluDense.wo.weight'),
      });
      const add2 = add('add');
      link(x, ln1);
      link(ln1, attn, 0); link(rb, attn, 1);
      link(attn, add1, 0); link(x, add1, 1);
      link(add1, ln2); link(ln2, ffn);
      link(ffn, add2, 0); link(add1, add2, 1);
      x = add2;
    }
    if (cfg.hasFinalLn) {
      link(x, add('rmsnorm', null, { g: 'encoder.final_layer_norm.weight' }));
    }

    if (autoLayout) autoLayout(graph);
    graph.propagate();
    cfg.builtLayers = nLayers;
    cfg.seqLen = seqLen;
    return cfg;
  }

  export const T5 = {
    open: function (path) { return bro.tensor.openSafetensors(path); },
    inferConfig: inferConfig,
    importEncoder: importEncoder,
  };
