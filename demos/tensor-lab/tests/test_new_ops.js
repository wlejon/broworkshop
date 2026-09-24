// Tensor Lab: runs each of the newer ops end to end on the device, fed from
// source nodes. Shape inference must accept the inputs, the op must run, and
// its output must be finite.
//
//   scripts/validate.sh demos/tensor-lab

import { check, eq, test, done, frames, skip } from "/lib/kit/test.js";
import { Shape } from "/app/lab/shape.js";
import { Graph } from "/app/lab/graph.js";
import { Runner } from "/app/lab/runner.js";

frames(10);
if (typeof bro === 'undefined' || !bro.tensor || !bro.tensor.available) skip('no GPU tensor backend');
try { bro.tensor.init(); } catch (_) {}

const G = Graph.create();
const R = Runner.create(G);

const MATRIX = { type: 'input', params: { rows: 32, cols: 128, fill: 'gauss' } };
const GRID = { type: 'input', params: { rows: 64, cols: 128, fill: 'gauss' } };      // 8×8 grid
const IMAGE = { type: 'image', params: { n: 1, c: 16, h: 16, w: 16, fill: 'gauss' } };
const IMAGE_C8 = { type: 'image', params: { n: 1, c: 8, h: 8, w: 8, fill: 'gauss' } };

// [opType, params, [source spec per input port]]
const CASES = [
    ['sigmoid', {}, [MATRIX]],
    ['tanh', {}, [MATRIX]],
    ['elu', { alpha: 1 }, [MATRIX]],
    ['leakyrelu', { slope: 0.1 }, [MATRIX]],
    ['geglu', {}, [MATRIX]],
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
    ['gelu-exact', {}, [MATRIX]],
    ['geglu-exact', {}, [MATRIX]],
    ['batchnorm', {}, [IMAGE]],
    ['clamp', { lo: -0.5, hi: 0.5 }, [MATRIX]],
    ['meanpool', {}, [MATRIX]],
    ['timestep', { batch: 8, dim: 128, maxT: 1000 }, []],
];

for (const [type, params, sources] of CASES) {
    test(type + ' ' + JSON.stringify(params), () => {
        G.nodes.length = 0; G.edges.length = 0;
        const op = G.addNode(type);
        Object.assign(op.params, params);
        sources.forEach((s, i) => {
            const src = G.addNode(s.type);
            Object.assign(src.params, s.params);
            G.addEdge(src, 0, op, i);
        });
        G.propagate();
        check(!op.error, 'shape: ' + op.error);
        R.run(() => {});
        const out = op._out && op._out[0];
        check(out, 'no output tensor');
        const d = out.download();
        let bad = 0;
        for (let i = 0; i < Math.min(d.length, 4096); i++) if (!isFinite(d[i])) bad++;
        eq(bad, 0, 'non-finite outputs');
        console.log('       out ' + out.rows + '×' + out.cols + ' (logical ' + Shape.label(op.shapes[0]) + ')');
    });
}
done('tensor-lab new ops');
