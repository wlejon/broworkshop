# PixArt Lab

A clean text-to-image bench for **PixArt-Sigma** (`PixArt-alpha/PixArt-Sigma-XL-2-1024-MS`)
running on `bro.diffusion`. PixArt-Σ is a ~0.6B DiT (AdaLN-single) with a T5-XXL
text frontend and the SDXL KL-VAE. brodiffusion auto-detects the family from the
diffusers model directory, so the model rides the model-agnostic `Pipeline` — the
same `generate()` surface SD and Sana use. No PixArt-specific JS binding.

This lab is text-to-image only: there is no conditioning-control axis seam here.
That seam (`loadControlDictionary` / `setControl` / `setControlVector`) is wired
into brodiffusion's Sana and SD1.5 prime paths, **not** PixArt's T5 branch — see
`sana-lab` and `diffusion-lab` for the word-axis steering labs.

## Run

```bash
bro ../broworkshop/demos/pixart-lab
```

Set the **PixArt directory** to your `weights/pixart-sigma` dir, click **Load
model**, then **Generate** (Ctrl/Cmd+Enter in the prompt also fires it).

## Weights

From the `brodiffusion` repo, fetch the PixArt-specific parts and the shared
T5-XXL encoder once:

```bash
cd ../brodiffusion
scripts/download-weights.sh t5-xxl          # ~19 GB, shared with Flux/Sana
scripts/download-weights.sh pixart-sigma    # transformer + vae + tokenizer
```

This produces:

```
brodiffusion/weights/
├── t5-xxl/                      # shared T5-XXL encoder + tokenizer.json
└── pixart-sigma/
    ├── transformer/             # the DiT
    ├── vae/                     # SDXL KL-VAE
    └── tokenizer/               # T5 tokenizer (if not bundled in t5-xxl)
```

### T5-XXL resolution

T5-XXL is typically **not** bundled inside the PixArt dir (it dominates the
download). brodiffusion resolves it, in priority order:

1. `$BRODIFFUSION_T5_DIR` — an explicit t5-xxl directory
2. a bundled `<model-dir>/text_encoder/*.safetensors`
3. a sibling `<model-dir>/../t5-xxl`

The default layout above (sibling `weights/t5-xxl`) satisfies option 3, so no
env var is needed. To point elsewhere, launch bro with `BRODIFFUSION_T5_DIR` set.

## Defaults

| setting  | default | notes |
|----------|---------|-------|
| steps    | 20      | |
| guidance | 4.5     | classifier-free guidance scale |
| size     | 1024²   | also 768² / 512² (multiples of 8, KL-VAE is 8×) |
| seed     | 0       | |
