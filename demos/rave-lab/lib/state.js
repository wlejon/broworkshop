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

export const $ = (s) => document.querySelector(s);

let decodeTimer = 0;        // debounce auto-decode after a non-drag edit
