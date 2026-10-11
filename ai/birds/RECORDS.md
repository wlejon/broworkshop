# Batch records

What `process.js` writes. Everything goes under the output directory given
on the command line, never beside the photos: the run refuses an output
directory that is the photo folder or inside it. Paths in the records are
absolute; nothing else about the photos (no pixels, no copies) is stored,
apart from the 96 px grey thumbnails in `thumbs.jsonl`.

| File | What | Written |
|------|------|---------|
| `records.jsonl` | one line per photo (below) | appended as each photo finishes; rewritten (compacted) at the end of a run |
| `bursts.jsonl` | one line per burst | at the end of every run, from all records |
| `meta.json` | how the records were made: models, thresholds, options, run statistics | end of run |
| `summary.md` | the report for people | end of run |
| `thumbs.jsonl` | `{ path, key, width, height, luma }`: a 96 px luma thumbnail (base64), for the burst scene check | with the records |

Files that replace an earlier version are written to `<name>.tmp` and
renamed, so a reader never sees half a file.

## Incremental runs

A record's identity is the photo's absolute path; it is reused when its
`key` (`"<size>:<mtime ms>"`) and its `config` (a hash of the settings that
shape a record: schema, image sizes, models with their revisions and weight
sizes, threshold, queries, top K, subject margin, species list) both match.
Anything else (a new or changed photo, another model or threshold, `--force`)
processes the photo again. Records of photos no longer in the folder are
dropped when the file is compacted. Burst options (`--gap`, `--scene-ncc`,
`--metric`) do not touch the records: bursts are regrouped every run.

Because lines are appended as photos finish, an interrupted run keeps its
work: the next run reads the file (the last line for a path wins; a torn last
line is ignored) and carries on. A photo that failed (an `error` record) is
not retried while its key is unchanged; `--force` retries it.

## records.jsonl

One JSON object per line, sorted by capture time after compaction. Fields
absent from a photo are `null`, `[]` or missing as noted. `animal`,
`detections`, `subject` and `species` are `bro.vision.wildlife`'s
`analyze()` result as it returns it, `sharpness` its `sharpness()`, and
`bursts.jsonl` its `groupBursts()` (bro's docs/vision-api.js, "Wildlife").

| Field | Type | Meaning |
|-------|------|---------|
| `v` | number | record schema (1) |
| `path` | string | absolute path of the processed file: the JPEG of a RAW+JPEG pair, else the JPEG or CR3 |
| `size`, `mtimeMs` | number | the file's size in bytes and modification time (ms since 1970) |
| `key` | string | `"<size>:<mtimeMs>"`, what decides whether the photo changed |
| `config` | string | hash of the processing config (`meta.json` `configHash`) |
| `format` | string | `"jpeg"` or `"cr3"` (a CR3 decodes from its embedded JPEG; never RAW-developed) |
| `pair` | string \| null | the CR3 shot with this JPEG (same folder, same name), not processed itself |
| `processedAt` | string | ISO time the record was made |
| `error`, `stage` | string | only on a failed photo: the message, and the stage (`stat`, `decode`, `analyze`); such a record has none of the fields below |
| `width`, `height` | number | the photo's upright size in pixels (EXIF orientation applied) |
| `decodePath` | string | how `bro.image.decodeScaled` got the sharpness image: `dct` (JPEG at a DCT scale), `full`, `raw-preview` (a CR3's embedded JPEG) |
| `exif` | object \| null | the EXIF fields present (missing tags are absent keys): `dateTaken` (ISO 8601 with sub-seconds and offset when the camera wrote them, e.g. `2026-10-01T17:50:41.62-05:00`), `subSecTime`, `offsetTime`, `make`, `model`, `lensModel`, `focalLength` (mm), `focalLength35mm`, `exposureTime` (s), `exposureTimeText` (`"1/1000"`), `fNumber`, `iso`, `latitude`, `longitude` (signed degrees), `altitude` (m), `orientation` (1-8) |
| `time` | number | capture time in ms: `exif.dateTaken` (a time without an offset read as UTC, i.e. camera clock time) |
| `timeSource` | string | `"exif"`, or `"mtime"` when there is no usable date (then `time` is `mtimeMs`) |
| `animal` | boolean \| null | OWLv2 found at least one box at or above the threshold; `null` under `--no-models` |
| `detections` | array | every box over the threshold after NMS, best first: `{ label, score, box: [x, y, w, h] }`, `label` the query (`"a bird"`, `"a deer"`), `score` 0-1, `box` in upright source pixels |
| `subject` | object \| null | `{ x, y, w, h }`, source pixels: the best box padded 15% and made square, clamped to the frame; the classifier's input |
| `species` | array | the top 5 on the subject (empty without an animal): `{ common, scientific, family, order, class, score, similarity }`; `score` is the softmax over the whole species list at the model's temperature (how far the answer stands out, not whether the photo shows a listed species), `similarity` the cosine similarity |
| `sharpness.scale` | number | long side, in pixels, of the image sharpness was measured on (3000, or the photo's own size if smaller) |
| `sharpness.frame` | object | whole frame: `{ laplacianVar, tenengrad, lumaMean, lumaStd, pixels }` from `bro.image.sharpness` (variance of the Laplacian, mean squared Sobel gradient, luma mean / std in 0-255, pixels counted) |
| `sharpness.subject` | object \| null | the same over the best detection box (not the padded square), when there is an animal |
| `timing` | object | ms per stage for this photo: `decode` (decode + resize to the detection image, worker), `exif`, `sharpness` (whole frame), `thumb`, `detect` (OWLv2 incl. its preprocessing), `classify` (crop + BioCLIP + ranking), `subject` (subject sharpness) |

Sharpness values compare frames of one subject (a burst) at one scale; they
also grow with contrast, so they are not a quality score across unrelated
photos.

## bursts.jsonl

One line per burst, in time order. Every photo without an error is in
exactly one burst.

| Field | Type | Meaning |
|-------|------|---------|
| `id` | number | 1-based index in time order (stable only while the records are) |
| `first` | string | path of the first photo |
| `start` | string \| null | its `exif.dateTaken` |
| `durationS` | number | last capture time minus first, seconds |
| `count` | number | photos in the burst |
| `animalCount` | number | of them with an animal |
| `species` | object \| null | the consensus, null without an animal: `{ common, scientific, share, agree }`. Every animal frame votes with its top 5 scores; the species with the largest sum wins. `share` = that sum / `animalCount` (the mean probability given to it), `agree` = frames whose top-1 it is |
| `keeper` | string | the sharpest photo: the highest subject `tenengrad` (`--metric`) among frames with an animal, else the highest whole-frame value |
| `keeperSharpness` | number | that value |
| `startedBy` | string | `"gap"` (the time gap, or the first photo), or `"scene"` (split by the scene check) |
| `maxGapS` | number \| null | largest gap between consecutive photos inside it, seconds |
| `minNcc` | number \| null | lowest scene NCC between consecutive photos inside it (informational unless `--scene-ncc` is set) |
| `photos` | string[] | its photos' paths in capture order |

## meta.json

| Field | Meaning |
|-------|---------|
| `schema` | record schema |
| `tool` | what wrote it |
| `input`, `output` | the photo folder and this directory (real paths) |
| `configHash`, `config` | the processing config the records were made under: `detectSize` (detection/classification image, long side, 1280), `sharpSize` (3000), `thumbSize` (96), `models` (false under `--no-models`), `detector` and `classifier` (`{ name, repo, revision, weightsBytes }`; repo and revision from the weights' ATTRIBUTION.md), `threshold`, `queries` (OWLv2's text queries), `topK`, `margin`, `speciesList` (`{ file, count }`) |
| `options` | burst options of this run: `gapS`, `sceneNcc`, `metric`; `workers`, `force`, `limit` |
| `engine` | `exePath` (the bro-headless that ran) and `device` (where OWLv2 ran) |
| `run` | `startedAt`, `wallMs`, `photos`, `files` (all files seen), `skippedFiles` (count by extension: videos and others), `processed`, `reused`, `errors`, `removed`, `pairs`, `msPerPhoto` (wall time of the processing loop / photos processed), `timing` (this run's photos, per stage: `n`, `meanMs`, `medianMs`, `totalMs`; `wait` = time the page waited for a decode) |
| `history` | the last 50 runs into this directory, oldest first: `{ startedAt, wallMs, processed, reused, errors, msPerPhoto, configHash }` |
