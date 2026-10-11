# Birds

Zero-shot species identification for wildlife photos with
[BioCLIP](https://huggingface.co/imageomics/bioclip) and
[BioCLIP 2](https://huggingface.co/imageomics/bioclip-2), over the
Upper-Midwest species list (birds of the MN, WI, IA, ND, SD, MB and ON
checklists plus common yard mammals). The app opens a photo, finds the animal
with [OWLv2](https://huggingface.co/google/owlv2-base-patch16-ensemble), crops
to it and shows the top five; `process.js` runs a whole card.

The per-photo analysis (find the animal, name the species, sharpness) and
the burst grouping are the engine's: `bro.vision.wildlife`, documented in
bro's `docs/vision-api.js` ("Wildlife"), so other apps use the same pipeline.
This app is its batch front end and the reference its records pin.

## Files

| File | What |
|------|------|
| `main.js`, `index.html` | the app |
| `process.js` | the batch processor's command line (below) |
| `batch.js` | `runBatch(opts)`: scan, the decode-worker / GPU pipeline (`bro.vision.wildlife` analyze), records, bursts, meta; `scanPhotos`, `sceneNcc` |
| `decode-worker.js` | the CPU half of a photo in a Worker: decode, EXIF, sharpness, thumbnail |
| `store.js` | the JSONL store: keys, appending, compaction, atomic writes |
| `report.js` | `summary.md` |
| `RECORDS.md` | every field of the batch output |
| `tests/test_process.js` | the batch processor without models on synthetic JPEGs with fake EXIF times: records, keys, incremental skip, changes, pairs, corrupt files, bursts, keepers, output-dir refusal |
| `tests/test_process_ml.js` | the batch processor with OWLv2 + BioCLIP on synthetic frames (tagged `ml`) |
| `tests/synth.js` | synthetic textures and JPEGs with an EXIF capture time, for the tests |

The models themselves are tested in bro: `tests/vision/test_vision_wildlife.js`
(no weights) and `test_vision_wildlife_models.js`.

## Weights

`bro.vision.wildlife` finds them through `bro.models`, so `BRO_MODELS` (or
the `models.dirs` setting) must name the directory holding these, e.g.
`BRO_MODELS=/path/to/brovisionml-data`:

- `bioclip`, `bioclip-2` (`brovisionml-data/bioclip{,-2}`): the open_clip
  releases converted by `brolm/scripts/convert-openclip.py` (model.safetensors,
  config.json, vocab.json, merges.txt), published in the Hugging Face dataset
  [`wlejon/brovisionml-data`](https://huggingface.co/datasets/wlejon/brovisionml-data).
- `species/upper-midwest.json`, `species/upper-midwest-herps/species.json`,
  `species/upper-midwest-arthropods/species.json` and `species/pets/species.json`
  (`brovisionml-data/species/...`): the label set, merged. The first is the
  birds and yard mammals with eBird names (assembled from the sources in its
  `ATTRIBUTION.md`), the second 78 reptiles and amphibians and the third the
  insects and spiders, generated from GBIF by
  `brovisionml/scripts/gen-species-gbif` (CC BY 4.0), the last the domestic
  dog and cat. A list's `taxa` map names genera and up ("Darners").
- `owlv2` (`brovisionml-data/owlv2`): the Hugging Face release of
  `google/owlv2-base-patch16-ensemble` as-is (model.safetensors, vocab.json,
  merges.txt; Apache-2.0, see its `ATTRIBUTION.md`).

## Using bro.vision.wildlife

```js
const wildlife = bro.vision.wildlife;
if (!wildlife.available()) return;            // weights not there: hide the feature
const an = wildlife.open({ model: 'bioclip-2' });   // OWLv2 + BioCLIP 2 + the list

const photo = bro.image.decodeScaled(path, { width: 1280, height: 1280 });
const rec = an.analyze(photo, { source: { width: photo.sourceWidth, height: photo.sourceHeight } });
// { animal, detections: [{ label, score, box }], subject: { x, y, w, h },
//   species: [{ common, scientific, family, order, class, score, similarity }, ...],
//   animals: [{ box, label, subject, species, taxa, candidates }, ...], animalsDropped }
const names = wildlife.labels(rec, burst, { taxa: an.taxa });   // [] = unidentified
// [{ common: 'Mallard', rank: 'species', score, boxes, ... }, { common: 'Darners', rank: 'family', ... }]
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

`bro.vision.wildlife` asks OWLv2 for each animal on the list ("a bird", "a
squirrel", "a deer", ... `wildlife.QUERIES`) and takes the best box, padded
15% and made square, as the classifier's input. No box at or above the
threshold means no animal: the app says so and does not classify.

- **Threshold** (`wildlife.DEFAULTS.threshold`, 0.15): on a 958-photo card, frames with
  nothing listed in them (people, mushrooms, empty feeders, bare branches,
  water) mostly scored under 0.1, and clear animals 0.3 and up. Between them
  sit both real animals (a warbler deep in leaves, distant geese, a sparrow in
  grass, 0.10 to 0.29) and look-alikes (a rock as "a beaver", a stink bug as
  "a bird", a feeder, leaves, 0.11 to 0.22); 0.15 keeps most of the real
  ones and lets a few look-alikes through to the classifier. Raise it for
  fewer false finds.
- **Queries** are only the animals on the species lists (28: the birds and
  yard mammals; snake, turtle, frog, toad, lizard, salamander; dog and cat;
  insect, dragonfly, butterfly, moth, bee, beetle, spider). Pass `queries`
  to `open` (or the analyzer's `detect`) to ask for others; their text
  embeddings are computed once and cached.
- **Every animal**: each box after NMS (up to 8, `--max-classify`) is
  cropped and classified on its own, so a heron and a duck in one frame
  are both named. Boxes past that are counted (`animalsDropped`).
- **Cost** on a Radeon 8060S: ~75 ms for OWLv2 on the GPU (FP16 at 960 x 960),
  ~98 ms for `detect` with its CPU preprocessing at 1280, and ~87 ms for the
  `decodeScaled(1280)` of a camera JPEG before it.

## Batch processing

```sh
# from broworkshop/, with BRO_MODELS naming brovisionml-data
bro-headless ai/birds ai/birds/process.js -- /media/card/DCIM/100CANON ~/birds/card-2026-10 [options]
```

Every photo under the folder (recursive; `.jpg`/`.jpeg` and Canon `.cr3`;
videos and other files are counted and skipped) is decoded, its EXIF read,
OWLv2 asked for animals, BioCLIP 2 asked for the top 5 species on the subject
square, and its sharpness measured; then the photos are grouped into bursts,
each with a consensus species and a keeper. A RAW+JPEG pair (same folder,
same name) is one shot: the JPEG is processed and the CR3 recorded as its
`pair`. A CR3 on its own is processed through its embedded JPEG.

The output directory gets `records.jsonl` (one line per photo),
`bursts.jsonl`, `meta.json` (models with their revisions, thresholds,
options, run statistics), `summary.md` (the report: counts, species by photos
and bursts, burst sizes, keepers, timing, failures) and `thumbs.jsonl`. Every
field is in [RECORDS.md](RECORDS.md). Nothing is written beside the photos,
and an output directory inside the photo folder is refused. Re-running skips
every photo whose path, size and mtime match its record (and whose record was
made with the same models and settings); a photo that fails to decode is
recorded as an error and the run goes on.

| Option | Default | |
|--------|---------|-|
| `--model bioclip-2\|bioclip` | `bioclip-2` | species model |
| `--threshold N` | 0.15 | OWLv2 score threshold (see above) |
| `--label-threshold N` | 0.85 | the report's labelled / unidentified split (below); the records keep every score |
| `--candidates all\|byQuery` | `all` | a crop's softmax over every species, or over the classes of its box's query (below) |
| `--max-classify N` | 8 | animal boxes classified a photo, best first |
| `--gap S` | 1.0 | max seconds between consecutive shots of one burst |
| `--scene-ncc N` | 0 (off) | also split a burst where consecutive frames correlate below N |
| `--metric tenengrad\|laplacianVar` | `tenengrad` | keeper sharpness measure |
| `--workers N` | 3 | decode workers |
| `--no-models` | | decode, EXIF, sharpness and bursts only |
| `--force` | | process every photo again |
| `--limit N` | | only the first N photos by path |
| `--progress S` | 10 | seconds between progress lines |

**Pipeline.** `decode-worker.js` workers decode each photo with
`bro.image.decodeScaled` to 3000 px on the long side, which for a 6000 x 4000
camera JPEG is libjpeg-turbo's 1/2 DCT scale and costs the same as the 1280 px
decode the detector needs (~95 ms either way; it is the entropy decoding that
costs), resize it to 1280 for detection and classification, read EXIF, and
measure the whole frame's sharpness and a 96 px luma thumbnail; the 3000 px
image stays in the worker until the page sends back the subject's box, whose
sharpness is measured on it. The page runs OWLv2 and BioCLIP on the GPU while
the workers decode the next photos, so a photo costs what the GPU stages cost:
on a Radeon 8060S ~102 ms detect (OWLv2 with its preprocessing) + ~31 ms
classify, ~137 ms a photo end to end, about 7.4 photos a second, while decode
(~100 ms), EXIF (0.2 ms), sharpness (3.6 ms frame, ~1 ms subject) and the
thumbnail (2.5 ms) run beside it and the page waits on them for under 3% of
the run. A re-run that finds nothing changed takes ~4 s for 958 photos
(reading the records and regrouping the bursts; the models are not loaded).

**Sharpness** is `bro.image.sharpness` (broimage): variance of the Laplacian
and Tenengrad on integer luma, over the whole frame and over the best
detection box (not the padded square), at 3000 px. The keeper is the frame
with the highest subject Tenengrad. On a 958-photo card the two measures pick
the same keeper in 113 of 147 bursts with three or more animal frames, and
where they differ the frames are within a few percent of each other; ordered
by Tenengrad, bursts put wing-blurred and missed-focus frames last. Both
measures also grow with contrast, so they rank frames of one burst, not
unrelated photos.

**Bursts.** Shots are sorted by EXIF capture time with sub-seconds. On the
two cards here (2436 shots from a Canon R50) consecutive frames of the
camera's own bursts are 0.07-0.2 s apart (1349 pairs; 6 more at 0.2-0.35 s);
from 0.35 to 1 s sit 38 quick
re-presses on the same subject (34 of the 36 with an animal in both frames
name the same species), and from 1 s on the gaps grow into new framings and
new subjects. Any gap from 0.35 to 1 s keeps every camera burst whole; 1.0 s
also keeps the quick re-presses with them. The scene check (`--scene-ncc`) aligns the 96 px luma
thumbnails of consecutive frames (`bro.image.alignSimilarity`, translation
only: with scale and rotation free a thumbnail bends onto an unrelated scene)
and splits below the threshold. It is off by default because it did not
help: on both cards every pair under 1 s apart with an NCC below 0.6 (14
pairs) was the same subject: herons and egrets in flight, a bird leaving the
frame, a pan following a gull, ripples, reed texture; none was a change of
scene. `minNcc`
is still recorded per burst.

**Consensus.** Each animal frame of a burst votes with its top 5 scores; the
species with the largest sum is the burst's, `share` its mean probability and
`agree` the frames naming it first. The report lists species by bursts as
well as by photos, since a 28-frame burst of one heron is one sighting.

**Labels.** An app names an animal only at a score of 0.85 or more, at
the narrowest rank that reaches it (`bro.vision.wildlife.labels`: a
species, else its genus, family, order or class, a taxon scoring the sum of
its species), every animal of a photo, and a photo in a burst shows the
burst's names; with no rank there the animal is shown as found but
unidentified. The report (`meta.json` `run.labels`, RECORDS.md) counts
photos and bursts labelled and unidentified at `--label-threshold`, those
with two or more names, labels by rank, photos labelled with a bird, a
mammal, a reptile or amphibian, an insect or spider, or a pet, the boxes
not classified, and per name the photos and bursts showing it.

**Candidates.** With the arthropod list, a bird crop's softmax runs over
~2,000 species, 1,350 of them insects and spiders, and every one takes a little
of the probability. `--candidates byQuery` ranks a crop only over the
classes its box's query fits ("a bird" Aves, "a dragonfly" Insecta, ...),
falling back to every species when that answer is under the label
threshold and another class's best clears it.
