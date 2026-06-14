// Parakeet Lab — shared state and DOM helpers (all lib/ modules share one
// global scope, loaded in order by index.html).
//
//   audio.js       AudioContext clip publish/play, file decode, mic recording
//   model.js       setBadge, model + tokenizer load, native file dialogs
//   transcribe.js  the async bro.stt.transcribe run (streaming partials)
//   render.js      waveform + token timeline, the token table
//   app.js         wire the DOM up and kick off the first load
//
// The loop the whole lab is built around:
//
//   mic / file ──► source PCM (16 kHz mono) ──transcribe──► token ids
//                                                           + frame positions
//                                            ──detokenize─► transcript
//
// Parakeet is a transducer: each token is emitted AT an encoder frame, so the
// id stream carries its own word timing (frame × 0.08 s) — no alignment pass.
// The timeline pins every token to the moment in the waveform it was decoded
// from, and the transcript streams in live as the TDT loop emits.

export const $ = (s) => document.querySelector(s);

export const TARGET_RATE = 16000;   // Parakeet's fixed input rate
