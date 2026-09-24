// Reader — import documents (txt / md / html) into a persistent library with
// reading positions, and have them narrated by a local TTS engine:
//   Kokoro     word-accurate highlight from per-phoneme durations, native rate
//   Qwen3-TTS  preset speakers, sentence highlight, speed via playback rate
// Sentences prefetch ahead on the async synthesis path. Extras: WAV export,
// sleep timer, light/dark theme, per-document voice memory.
//
// lib/state.js       settings (prefStore) + theme
// lib/text.js        html / markdown stripping, paragraph + sentence split
// lib/docs.js        library records, persistence, import
// lib/engine.js      weight discovery, Kokoro / Qwen loading, voices
// lib/tts.js         one sentence through either engine + Kokoro word timing
// lib/player.js      playback: prefetch, cache, clock, sleep, preview, model gate
// lib/reader.js      reader view: highlight, auto-scroll, transport
// lib/library.js     library view: cards, import, resume, delete
// lib/exporter.js    WAV export job
// lib/settingsui.js  settings dialog
// lib/app.js         boot, keys, drag-drop
import { start } from "/app/lib/app.js";

start();
