# Birds

Zero-shot species identification for wildlife photos with
[BioCLIP](https://huggingface.co/imageomics/bioclip) and
[BioCLIP 2](https://huggingface.co/imageomics/bioclip-2), over the
Upper-Midwest species list (birds of the MN, WI, IA, ND, SD, MB and ON
checklists plus common yard mammals). The app opens a photo, crops to the
subject and shows the top five; the modules are what a folder-processing
script builds on.

## Files

| File | What |
|------|------|
| `species.js` | `loadSpeciesModel({ modelDir, speciesPath, cacheDir })` -> `classify(image, { topK })`, `embedImage`, `classifyEmbedding`; `speciesPrompt`, `readSpeciesList`, `squareInput` |
| `crop.js` | `loadSubjectCropper({ weightsPath })` -> `crop(image)`: BiRefNet salient-object matte -> square box around the subject, else the whole frame; `subjectBox` |
| `models.js` | `locate(name)`: the one place weights are looked up |
| `main.js`, `index.html` | the app |
| `tests/test_helpers.js` | prompts, subject box, square input; no models |
| `tests/test_species.js` | BioCLIP end to end on a synthetic image (tagged `ml`) |

## Weights

`species.js` and `crop.js` take explicit paths. The app and its tests find
them in one place, `models.js` `locate(name)`: `bro.models.find(name)` when
the engine has it, else (until then) the kit's sibling-repo search
(`lib/kit/weights.js`, `BRO_WEIGHTS` names the directory holding the
siblings). Names and their sibling paths:

- `bioclip`, `bioclip-2` (`brovisionml-data/bioclip{,-2}`): the open_clip
  releases converted by `brolm/scripts/convert-openclip.py` (model.safetensors,
  config.json, vocab.json, merges.txt), published in the Hugging Face dataset
  [`wlejon/brovisionml-data`](https://huggingface.co/datasets/wlejon/brovisionml-data).
- `species/upper-midwest.json` (`brovisionml-data/species/...`): the label
  set. Not in the published dataset (its taxonomy is under the eBird API's
  terms); it is assembled locally from the sources in its `ATTRIBUTION.md`.
- `birefnet.safetensors`
  (`brovisionml/weights/triposplat/background_removal/...`): the subject
  cropper (optional; without it the whole frame is classified).

## Using species.js

```js
import { loadSpeciesModel } from "/app/species.js";
import { loadSubjectCropper } from "/app/crop.js";

const model = loadSpeciesModel({
    modelDir: '/path/to/brovisionml-data/bioclip-2',
    speciesPath: '/path/to/brovisionml-data/species/upper-midwest.json',
    cacheDir: outDir + '/.species-cache',   // text embeddings, keyed by model + list
    accidental: false,                       // optional: drop accidental/vagrant rows
});
const cropper = loadSubjectCropper({ weightsPath: birefnetPath });

const photo = bro.image.decodeScaled(path, { width: 1024, height: 1024 });
const { image, box, method } = cropper.crop(photo);
const top = model.classify(image, { topK: 5 });
// [{ common, scientific, class, order, family, score, similarity }, ...]
```

- **Prompts** follow the BioCLIP paper and model cards: "a photo of <kingdom
  phylum class order family genus species> with common name <name>."
- **score** is the softmax over the whole list at the model's temperature
  (100): how far the best answer stands out among the listed species. It does
  not say whether the photo shows a listed species at all; a photo of a
  feeder with no bird in it still gets a confident-looking answer. Use
  `similarity` (cosine) or a detector for "is there an animal here".
- **Text embeddings** take a few seconds for the ~570 species and are cached
  in memory and, with `cacheDir`, on disk.
- **Images** are any `{ width, height, data | pixels, channels? }` of 8-bit
  RGB(A); they are centre-cropped to a square and area-resized to 224 here,
  the framing open_clip's preprocessing gives.

## BioCLIP or BioCLIP 2

BioCLIP 2 (ViT-L/14, 1.7 GB) is the stronger model on the published
benchmarks and on a local check of 44 hand-labelled yard and river photos
(44/44 subject-cropped, 43/44 whole frame, against BioCLIP's 43/44 and 38/44),
and its labels hold steadier across bursts. BioCLIP (ViT-B/16, 600 MB) costs
about half as much per image: ~16 ms against ~33 ms on a Radeon 8060S, both
small next to the subject crop (~1.1 s for BiRefNet at 1024). Both run
through the same code.
