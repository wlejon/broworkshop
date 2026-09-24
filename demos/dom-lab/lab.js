// DOM & Web Standards Lab — one tab per platform API, each a small module:
//   custom-elements.js  customElements.define + the lifecycle callbacks
//   shadow-dom.js       attachShadow, scoped styles, named slots
//   mutations.js        MutationObserver records
//   range-selection.js  Range boundaries, surroundContents, the Selection
//   web-animations.js   element.animate() transport + state

import { boot } from "/lib/kit/app.js";
import { tabs, logView, frameLoop } from "/lib/kit/ui.js";
import { initCustomElements } from "/app/custom-elements.js";
import { initShadowDom } from "/app/shadow-dom.js";
import { initMutations } from "/app/mutations.js";
import { initRangeSelection } from "/app/range-selection.js";
import { initWebAnimations, renderTelemetry } from "/app/web-animations.js";

export const ui = { tabs: null, lifecycleLog: null, mutationLog: null };

export function init() {
    const { status } = boot();
    ui.lifecycleLog = logView('#lifecycle-log', { newestFirst: true, max: 200 });
    ui.mutationLog = logView('#mutation-log', { newestFirst: true, max: 200 });
    ui.tabs = tabs('#tabs', { onChange: (name) => status.set(name) });

    initCustomElements(ui.lifecycleLog);
    initShadowDom();
    initMutations(ui.mutationLog);
    initRangeSelection();
    const label = initWebAnimations();
    frameLoop(() => { renderTelemetry(); label(); });

    status.ok('custom-elements');
}
