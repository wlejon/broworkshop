# Plant reference textures (CC0)

Curated open-source plant textures used as **reference and showcase material**
for the flora work (flora-lab, plant-recipes) — and as a stand-in until we
author our own. All assets here are **Creative Commons CC0 1.0 Universal
(public domain)** and may be freely copied, modified, redistributed, and
shipped with no attribution required.

## Source & license

Every texture is from **[ambientCG](https://ambientcg.com)** by Lennart Demes.
ambientCG releases all assets under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/):

> You can copy, modify, distribute and perform the assets, even for commercial
> purposes, all without asking permission. You can include the raw files in
> your project, for example a video game. You don't need to give credit …

Credit is appreciated but not required. We credit ambientCG here.

## Install

The texture files are `.gitignored` (they're large) — fetch them with:

```sh
./download.sh            # 1K PNG, ~90 MB total (default)
RES=2K ./download.sh     # crisper
RES=4K ./download.sh     # hero shots
```

## Layout

```
assets/plants/
├── leaves/   LeafSet002, LeafSet004, LeafSet013, LeafSet016
│             leaf-card ATLASES — each PNG is a grid of leaves on a
│             transparent background; the Opacity map is the alpha cut-out.
├── bark/     Bark001, Bark006, Bark012   (tiling trunk PBR)
└── grass/    Grass004                     (tiling ground / blade reference)
```

Each asset folder holds the ambientCG PBR set:
`*_Color.png`, `*_Opacity.png` (leaf sets), `*_Normal(GL).png`,
`*_Roughness.png`, `*_AmbientOcclusion.png`, `*_Displacement.png`.

## Notes for use

- **Leaf sets are atlases.** A single leaf card samples one cell of the grid
  via UVs; the `Opacity` map drives alpha-cutout so the card reads as a leaf
  silhouette rather than a rectangle. Pair with `createMesh({ texture,
  normalTexture, alphaCutoff, vertexColorTint:false, wind:1 })`.
- **Bark tiles** along a trunk's length UV (`meshBranches` emits UVs +
  tangents), so the `Normal` map gives real bark relief.
- Prefer the `NormalGL` (OpenGL, +Y up) normal variant for this engine.
