#!/usr/bin/env python3
"""One-time export of krea-research's Krea 2 axis bank to bro's BCD1 control-
dictionary format (see brodiffusion/include/brodiffusion/cond_control.h).

Input: ../../../krea-research/runs/axes_turbo/{axes.npz,axes_meta.json} —
18 research-validated perceptual axes, each a unit direction in Krea 2's
fused (post encode_text) 6144-dim conditioning space, plus a single shared
`scale` (natural-unit injection norm) ui.py's apply_axes() applies as
`txt += alpha * scale * dir`. Same convention CondControl::apply() uses.

Output (bundled with the app, loaded via Pipeline.loadControlDictionary()):
  assets/axes_turbo.bcd1  — the BCD1 binary dictionary
  assets/axes_meta.json   — {name: {category, label, order}} for UI grouping
                            (consistency dropped — not needed at runtime)

Re-run this if krea-research produces a newer axes_turbo run.
"""
import json
import struct
import sys
from pathlib import Path

import numpy as np

SRC = Path(__file__).resolve().parents[4] / "krea-research" / "runs" / "axes_turbo"
OUT = Path(__file__).resolve().parents[1] / "assets"


def main():
    npz_path = SRC / "axes.npz"
    meta_path = SRC / "axes_meta.json"
    if not npz_path.exists() or not meta_path.exists():
        sys.exit(f"missing {npz_path} or {meta_path}")

    d = np.load(npz_path)
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    scale = float(d["scale"])
    names = [k for k in d.files if k != "scale"]
    names.sort(key=lambda n: meta[n]["order"])

    dim = int(d[names[0]].shape[0])
    for n in names:
        v = d[n]
        if v.shape != (dim,):
            sys.exit(f"axis {n}: expected shape ({dim},), got {v.shape}")

    OUT.mkdir(parents=True, exist_ok=True)
    bcd1_path = OUT / "axes_turbo.bcd1"
    with open(bcd1_path, "wb") as f:
        f.write(b"BCD1")
        f.write(struct.pack("<i", len(names)))
        f.write(struct.pack("<i", dim))
        for n in names:
            name_bytes = n.encode("utf-8")
            f.write(struct.pack("<i", len(name_bytes)))
            f.write(name_bytes)
            f.write(struct.pack("<f", scale))
            f.write(d[n].astype("<f4").tobytes())

    ui_meta = {
        n: {
            "category": meta[n]["category"],
            "label": meta[n]["label"],
            "order": meta[n]["order"],
        }
        for n in names
    }
    meta_out_path = OUT / "axes_meta.json"
    meta_out_path.write_text(json.dumps(ui_meta, indent=1), encoding="utf-8")

    print(f"wrote {bcd1_path} ({len(names)} axes, dim={dim}, scale={scale})")
    print(f"wrote {meta_out_path}")


if __name__ == "__main__":
    main()
