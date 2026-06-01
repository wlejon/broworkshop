// Headless GPU test — exercises every newly-added op end-to-end on the device.
flush();
advanceTime(200);
flush();

const G = Lab.Graph.create();
const R = Lab.Runner.create(G);

if (!bro.tensor || !bro.tensor.available) {
  console.log('TEST FAIL: no GPU tensor backend');
} else {
  try { bro.tensor.init(); } catch (e) {}

  // src spec → builds a source node feeding the op under test
  const MATRIX = { type: 'input', params: { rows: 32, cols: 128, fill: 'gauss' } };
  const MATRIX_EVEN = { type: 'input', params: { rows: 32, cols: 128, fill: 'gauss' } };
  const GRID = { type: 'input', params: { rows: 64, cols: 128, fill: 'gauss' } };   // 8×8 grid
  const IMAGE = { type: 'image', params: { n: 1, c: 16, h: 16, w: 16, fill: 'gauss' } };
  const IMAGE_C8 = { type: 'image', params: { n: 1, c: 8, h: 8, w: 8, fill: 'gauss' } };

  // [opType, params, [sourceSpec...]]  — last sources wire to ports 1..n
  const CASES = [
    ['sigmoid', {}, [MATRIX]],
    ['tanh', {}, [MATRIX]],
    ['elu', { alpha: 1 }, [MATRIX]],
    ['leakyrelu', { slope: 0.1 }, [MATRIX]],
    ['geglu', {}, [MATRIX_EVEN]],
    ['groupnorm', { groups: 8 }, [IMAGE]],
    ['l2norm-pixel', {}, [IMAGE]],
    ['flash-attn', { heads: 4, causal: true, window: 0 }, [MATRIX]],
    ['flash-attn', { heads: 4, causal: true, window: 8 }, [MATRIX]],
    ['flash-attn', { heads: 4, causal: false, window: 0 }, [MATRIX]],
    ['sam-attn', { heads: 4, gridH: 8, gridW: 8, window: 0 }, [GRID]],
    ['sam-attn', { heads: 4, gridH: 8, gridW: 8, window: 4 }, [GRID]],
    ['cross-attn', { heads: 4 }, [MATRIX, MATRIX]],
    ['conv-transpose2d', { cout: 8, k: 4, stride: 2, pad: 1, outpad: 0 }, [IMAGE]],
    ['maxpool2d', { k: 2, stride: 2, pad: 0 }, [IMAGE]],
    ['avgpool', { hout: 1, wout: 1 }, [IMAGE]],
    ['upsample2x', { mode: 'nearest' }, [IMAGE]],
    ['upsample2x', { mode: 'bilinear' }, [IMAGE]],
    ['downsample2x', {}, [IMAGE]],
    ['interp2d', { hout: 24, wout: 24, mode: 'bilinear', align: false }, [IMAGE]],
    ['interp2d', { hout: 24, wout: 24, mode: 'bicubic-pil', align: true }, [IMAGE]],
    ['unfold2d', { k: 3, mode: 'zero' }, [IMAGE]],
    ['pad2d', { pad: 2, mode: 'reflect' }, [IMAGE]],
    ['spatial-merge', {}, [IMAGE]],
    ['convex-upsample', { scale: 4 }, [IMAGE_C8]],
    ['nchw-to-seq', {}, [IMAGE]],
  ];

  let pass = 0, fail = 0;
  for (const [type, params, sources] of CASES) {
    G.nodes.length = 0; G.edges.length = 0;
    const op = G.addNode(type);
    Object.assign(op.params, params);
    sources.forEach((s, i) => {
      const src = G.addNode(s.type);
      Object.assign(src.params, s.params);
      G.addEdge(src, 0, op, i);
    });
    G.propagate();
    const tag = type + ' ' + JSON.stringify(params);
    if (op.error) { console.log('SHAPE-FAIL ' + tag + '  → ' + op.error); fail++; continue; }
    try {
      R.run(() => {});
      const out = op._out && op._out[0];
      const okShape = out ? (out.rows + '×' + out.cols) : 'no-output';
      // sanity: download a few values and check finiteness
      const d = out.download();
      let bad = 0;
      for (let i = 0; i < Math.min(d.length, 4096); i++) if (!isFinite(d[i])) bad++;
      const want = op.shapes && op.shapes[0] ? Lab.Shape.label(op.shapes[0]) : '?';
      console.log('OK   ' + tag + '  out=' + okShape + ' (logical ' + want + ')' +
        (bad ? '  ⚠ ' + bad + ' non-finite' : ''));
      pass++;
    } catch (e) {
      console.log('RUN-FAIL ' + tag + '  → ' + (e && e.message || e));
      fail++;
    }
  }
  console.log('NEW-OPS DONE  pass=' + pass + ' fail=' + fail);
}
flush();
