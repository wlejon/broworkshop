// Supertonic Lab — drive Supertonic-3, a flow-matching multilingual TTS, through
// its real control seams.
//
// Supertonic is text-driven end to end (a codepoint frontend — no G2P, no phoneme
// step) and synthesises in two stages worth steering:
//
//   VOICE   identity — a VoiceStyle preset (the style_ttl / style_dp matrices)
//           loaded from the model's voice_styles/, plus the synthesis language.
//   FLOW    the flow-matching seam — how many classifier-free-guided Euler steps
//           the vector estimator takes (smoothness vs speed), the speed factor
//           (utterance length), and the Philox seed for the N(0,1) flow noise
//           (which take you draw). Long-form splits paragraphs into sentences.
//
// The lab RE-SYNTHESISES ON CHANGE (synth.js scheduleLive): touch a seam and the
// new audio plays once it lands (Supertonic runs faster-than-realtime on GPU). The
// model is single-owner, so synthesis serialises and the newest change wins.
//
// Modules share nothing but imports; loaded as ES modules from index.html:
//   state.js     this file — the $ helper + the shared narrative
//   helpers.js   el / mkCanvas / fs+os bridges / native dialogs / WAV encode
//   model.js     setBadge, model load, voice-preset scan, the language list
//   audio.js     clip publish/play + WAV export
//   delivery.js  the flow dials (steps / speed / seed / long-form) + currentFlow()
//   synth.js     scheduleLive (re-synth on change) + synthesize/cancel, latest-wins
//   render.js    the waveform card
//   app.js       wire the DOM up and kick off the first load

export const $ = (s) => document.querySelector(s);
