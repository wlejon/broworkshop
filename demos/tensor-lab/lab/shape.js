// Tensor Lab — logical tensor shapes.
//
// brotensor stores every tensor as a flat 2D (rows × cols) buffer. A Shape is
// the *logical* view the graph reasons about, and it knows how it maps onto
// that 2D storage. Two layouts:
//
//   matrix  [rows, cols]      tokens/batch × features — the transformer layout
//   image   [N, C, H, W]      conv feature maps — stored 2D as (N, C*H*W)
//
// Ops infer and validate Shapes in pure JS; exec() reads the storage dims off
// the GpuTensor directly, and the logical N/C/H/W off node.inShapes.
(function () {
  'use strict';
  const Lab = (window.Lab = window.Lab || {});

  function matrix(rows, cols) {
    return { layout: 'matrix', dims: [rows | 0, cols | 0] };
  }
  function image(n, c, h, w) {
    return { layout: 'image', dims: [n | 0, c | 0, h | 0, w | 0] };
  }

  // --- storage mapping: how a Shape lands in brotensor's 2D (rows, cols) ----
  function rows(s) { return s.dims[0]; }
  function cols(s) {
    return s.layout === 'image' ? s.dims[1] * s.dims[2] * s.dims[3] : s.dims[1];
  }
  function elems(s) { return rows(s) * cols(s); }

  function isMatrix(s) { return !!s && s.layout === 'matrix'; }
  function isImage(s) { return !!s && s.layout === 'image'; }

  function eq(a, b) {
    if (!a || !b || a.layout !== b.layout || a.dims.length !== b.dims.length) return false;
    for (let i = 0; i < a.dims.length; i++) if (a.dims[i] !== b.dims[i]) return false;
    return true;
  }

  // compact logical label: "32×128" or "1×3×32×32"
  function label(s) { return s ? s.dims.join('×') : '—'; }

  Lab.Shape = {
    matrix: matrix, image: image,
    rows: rows, cols: cols, elems: elems,
    isMatrix: isMatrix, isImage: isImage,
    eq: eq, label: label,
  };
})();
