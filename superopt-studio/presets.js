// superopt-studio/presets.js — Wild JavaScript presets for the Prover-Backed Superoptimizer Studio (#145).

export const PRESETS = {
    branchy_abs: {
        title: "1. Branchy Bit-Twiddling & Abs (CEGIS Superopt)",
        mode: "rewrite",
        code: `function branchyAbs(x) {
  if (x < 0) {
    return -x;
  }
  return x;
}`,
        benchInput: (i) => ((i * 2654435761) | 0)
    },

    poly_soup: {
        title: "2. Defensive Guard & Polymorphic Math Soup (SMT + Horner)",
        mode: "rewrite",
        code: `function polySoup(x) {
  let u = x & 255;
  if (u < 0) return -1;
  if (u > 255) return 999;
  let a = Math.max(0, x & 255);
  let b = Math.floor((x & 255) / 8);
  let p = Math.pow(u, 3) + 3 * Math.pow(u, 2) + 3 * u + 1;
  return a + b + p;
}`,
        benchInput: (i) => (i & 255)
    },

    deforest: {
        title: "3. Allocation-Heavy .map().filter().reduce() Pipeline (Deforestation)",
        mode: "rewrite",
        code: `function sumFilteredSquares(items) {
  return items.map(x => x * 2).filter(y => y > 10).reduce((acc, z) => acc + z, 0);
}`,
        benchArray: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32]
    },

    auto_kernel: {
        title: "4. Sequential Float32Array SAXPY Loop -> Parallel @kernel + SPIR-V",
        mode: "autokernel",
        code: `function saxpy(out, x, y, a, n) {
  for (let i = 0; i < n; i++) {
    out[i] = a * x[i] + y[i];
  }
}`
    },

    hazard_trap: {
        title: "5. Loop-Carried Hazard Trap: Prefix Sum (Refuted by SMT Witness)",
        mode: "autokernel",
        code: `function prefixSum(a, x, n) {
  for (let i = 0; i < n; i++) {
    a[i] = a[i - 1] + x[i];
  }
}`
    }
};
