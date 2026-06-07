// RAVE Lab — shared state and DOM helpers (all lib/ modules share one global
// scope, loaded in order by index.html).
//
//   audio.js    AudioContext clip publish/play, file decode, tone synthesis
//   model.js    setBadge, RAVE model load, native file/folder dialogs
//   render.js   source/output waveform draw, the latent curve grid layout
//   curves.js   the per-dimension latent contour editor (drag / smooth / …)
//   app.js      wire the DOM up and kick off the first load
//
// The loop the whole lab is built around:
//
//   source PCM ─encode─► latent (nLatent × frames)  ─edit curves─► latent'
//                                                    ─decode─► morphed PCM
//
// RAVE's latent axes are PCA-sorted by variance, so the first rows carry the
// big, interpretable controls (loudness, pitch) and later rows carry timbre —
// each row is one editable time-series curve.

const $ = (s) => document.querySelector(s);

let rave = null;            // the loaded bro.rave handle
let audioCtx = null;        // broaudio context (lazy)

let srcSamples = null;      // Float32Array — source audio at rave.sampleRate
let srcClipId = -1;         // published audio clip for the source (A)
let outClipId = -1;         // published audio clip for the morph   (B)

let enc = null;             // { latent:Float32Array, nLatent, frames } — the ORIGINAL encode
let work = null;            // Float32Array(nLatent*frames) — the editable latent (channel-major)
let lastOut = null;         // Float32Array — most recent decoded waveform
let dimRanges = [];         // [mn,mx] per dim — fixed vertical frame for each curve
let curveCells = [];        // per-dim { cv, body, c, statsEl } — canvases persist, redraw in place

let busy = false;           // an encode/decode is in flight (guards the UI)
let activePaint = null;     // in-progress curve drag {cv,c,mn,mx,W,H,pad,lastI,lastV}
let decodeTimer = 0;        // debounce auto-decode after a non-drag edit
