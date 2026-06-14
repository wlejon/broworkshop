// ---------------------------------------------------------------------------
// View state — the one reactive seam.
//
// `activeVersion` bumps whenever the active signal (layer or mic) changes.
// Views subscribe via `effect(() => { activeVersion(); ...refresh... })` instead
// of being called manually. `refreshActive()` is invoked by whoever changes the
// active signal (e.g. Layers.onSelect, preset load).
// ---------------------------------------------------------------------------

import { signal } from "/std/signal.js";

export const activeVersion = signal(0);

export function refreshActive() {
    activeVersion.update(function(n) { return n + 1; });
}
