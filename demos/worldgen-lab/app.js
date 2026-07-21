// ═══ Worldgen Lab — entry ════════════════════════════════════════════════════
// Wire the checkpoint bar + location spine + probe tabs, then run one rAF clock
// that drives the active probe (animation + a single due regen when the world is
// free). See lib/core.js for the whole design.
import { installSystemMenu } from "/lib/system-menu.js";
import { $, state, on, isReady, world } from "/app/lib/core.js";
import { browseFolder, pParent } from "/app/lib/helpers.js";
import { loadWorld, defaultDir, availabilityHint, setBadge } from "/app/lib/model.js";
import { buildRegionBar } from "/app/lib/region.js";
import { buildTabs, tick, regenActive } from "/app/lib/registry.js";

// probes register themselves on import — order here is tab order.
import "/app/lib/probes/pipeline.js";
import "/app/lib/probes/climate.js";
import "/app/lib/probes/relief.js";
import "/app/lib/probes/seams.js";

function init() {
    // status line ← the core event bus
    on('status', (msg, bad) => {
        const s = $('#status');
        if (!s) return;
        s.textContent = msg;
        s.classList.toggle('err', !!bad);
    });

    // checkpoint bar
    $('#btn-browse').addEventListener('click', () => {
        const d = browseFolder(pParent($('#model-dir').value.trim()));
        if (d) { $('#model-dir').value = d; loadWorld(d, state.seed, null); }
    });
    $('#btn-load').addEventListener('click', () => loadWorld($('#model-dir').value.trim(), state.seed, null));
    $('#model-dir').addEventListener('change', () => { state.dir = $('#model-dir').value.trim(); });

    buildRegionBar($('#sidebar'));
    buildTabs($('#tabs'), $('#probe'));

    setBadge(availabilityHint(), !window.bro || !bro.worldgen || bro.worldgen.available === false);

    // one clock for the whole lab
    let last = performance.now();
    function frame() {
        const now = performance.now();
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        try { tick(dt); } catch (e) { console.error('tick', e); }
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    // first load — probe the machine for a checkpoint
    const dir = defaultDir($('#model-dir').value.trim());
    $('#model-dir').value = dir;
    state.dir = dir;
    loadWorld(dir, state.seed, null);
}

installSystemMenu();
init();

// test seams — the smoke drives these against a synchronously-loaded world.
export { isReady as ready, world };
export { regenActive };
