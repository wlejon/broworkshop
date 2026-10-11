# Birds

Zero-shot species identification for wildlife photos with
[BioCLIP](https://huggingface.co/imageomics/bioclip) and
[BioCLIP 2](https://huggingface.co/imageomics/bioclip-2), over the
Upper-Midwest species list (birds of the MN, WI, IA, ND, SD, MB and ON
checklists plus common yard mammals). The app opens a photo, finds the animal
with [OWLv2](https://huggingface.co/google/owlv2-base-patch16-ensemble), crops
to it and shows the top five; the modules are what a folder-processing script
builds on.

## Files

| File | What |
|------|------|
| `species.js` | `loadSpeciesModel({ modelDir, speciesPath, cacheDir })` -> `classify(image, { topK })`, `embedImage`, `classifyEmbedding`; `speciesPrompt`, `readSpeciesList`, `squareInput` |
| `detect.js` | `loadAnimalDetector({ weightsDir })` -> `detect(image, { queries, threshold })` -> `[{ box: [x, y, w, h], score, label }]`: OWLv2 with the yard animals as queries; `subjectSquare`, `cropImage`, `ANIMAL_QUERIES`, `DEFAULT_THRESHOLD` |
| `models.js` | `locate(name)`: the one place weights are looked up |
| `main.js`, `index.html` | the app |
| `tests/test_helpers.js` | prompts, subject square, crop, square input; no models |
| `tests/test_species.js` | BioCLIP end to end on a synthetic image (tagged `ml`) |
| `tests/test_detect.js` | OWLv2 on synthetic frames: nothing in an empty one, sorted in-frame boxes, RGB = RGBA (tagged `ml`) |

## Weights

`species.js` and `detect.js` take explicit paths. The app and its tests find
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
- `owlv2` (`brovisionml-data/owlv2`): the Hugging Face release of
  `google/owlv2-base-patch16-ensemble` as-is (model.safetensors, vocab.json,
  merges.txt; Apache-2.0, see its `ATTRIBUTION.md`). Optional: without it the
  app classifies the whole frame and cannot say "no animal".

With bro.models in the engine, `BRO_MODELS` (or the `models.dirs` setting)
must name the directory holding these, e.g.
`BRO_MODELS=/path/to/brovisionml-data`; the sibling-repo search is only the
fallback for an engine without it.

## Using species.js

```js
import { loadSpeciesModel } from "/app/species.js";
import { loadAnimalDetector, subjectSquare, cropImage } from "/app/detect.js";

const model = loadSpeciesModel({
    modelDir: '/path/to/brovisionml-data/bioclip-2',
    speciesPath: '/path/to/brovisionml-data/species/upper-midwest.json',
    cacheDir: outDir + '/.species-cache',   // text embeddings, keyed by model + list
    accidental: false,                       // optional: drop accidental/vagrant rows
});
const detector = loadAnimalDetector({ weightsDir: '/path/to/brovisionml-data/owlv2' });

const photo = bro.image.decodeScaled(path, { width: 1280, height: 1280 });
const hits = detector.detect(photo);          // best first; [] = no animal
if (hits.length) {
    const sq = subjectSquare(hits[0].box, photo.width, photo.height);   // +15%, square
    const top = model.classify(cropImage(photo, sq), { topK: 5 });
    // [{ common, scientific, class, order, family, score, similarity }, ...]
}
```

- **Prompts** follow the BioCLIP paper and model cards: "a photo of <kingdom
  phylum class order family genus species> with common name <name>."
- **score** is the softmax over the whole list at the model's temperature
  (100): how far the best answer stands out among the listed species. It does
  not say whether the photo shows a listed species at all; a photo of a
  feeder with no bird in it still gets a confident-looking answer. The
  detector is what answers "is there an animal here", not the classifier.
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
similar to finding the subject (below). Both run through the same code. (The
44-photo comparison was made with an earlier salient-object crop, not OWLv2.)

## Finding the animal

`detect.js` asks OWLv2 for each animal on the list ("a bird", "a squirrel",
"a deer", ... `ANIMAL_QUERIES`) and takes the best box, padded 15% and made
square, as the classifier's input. No box at or above the threshold means no
animal: the app says so and does not classify.

- **Threshold** (`DEFAULT_THRESHOLD`, 0.15): on a 958-photo card, frames with
  nothing listed in them (people, mushrooms, empty feeders, bare branches,
  water) mostly scored under 0.1, and clear animals 0.3 and up. Between them
  sit both real animals (a warbler deep in leaves, distant geese, a sparrow in
  grass, 0.10 to 0.29) and look-alikes (a rock as "a beaver", a stink bug as
  "a bird", a feeder, leaves, 0.11 to 0.22); 0.15 keeps most of the real
  ones and lets a few look-alikes through to the classifier. Raise it for
  fewer false finds.
- **Queries** are only the animals on the species list: a dog or a cat is
  "no animal". Pass `queries` to `detect` to ask for others; their text
  embeddings are computed once and cached.
- **Cost** on a Radeon 8060S: ~75 ms for OWLv2 on the GPU (FP16 at 960 x 960),
  ~98 ms for `detect` with its CPU preprocessing at 1280, and ~87 ms for the
  `decodeScaled(1280)` of a camera JPEG before it.
