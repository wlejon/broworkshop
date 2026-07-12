// test-live.js — LIVE-MODEL smoke test. NOT part of the default suite.
// Run: bro-headless games/hearthfolk test-live.js
//
// Gated on the Qwen3-32B GGUF existing. Loads the real model (CUDA), runs
// three serial thinks for one villager on real situation digests, and asserts
// that at least one comes back as strict JSON and is applied. Prints every
// raw model output plus tokens/sec and the acceptance rate.

const fs = require('fs');
const GGUF = 'D:/projects/brolm/weights/Qwen3-32B-GGUF/Qwen3-32B-Q4_K_M.gguf';

if (!fs.existsSync(GGUF)) {
    console.log('LIVE: model not found at ' + GGUF + ' — skipping (this is the gate, not a failure)');
} else {
    advanceTime(400);
    const H = window.HEARTH;
    assert(H, 'HEARTH debug surface exposed');
    const { game } = H;

    // Wait (real wall-clock time) for the async model load the app kicked off
    // at boot — a 32B GGUF takes minutes to reach VRAM.
    console.log('LIVE: waiting for model load…');
    const loadStart = Date.now();
    while (game.mind.status === 'loading' && Date.now() - loadStart < 15 * 60 * 1000)
        advanceTime(500);
    assert(game.mind.status === 'ready', 'model loaded (status: ' + game.mind.status + ')');
    console.log('LIVE: model ready');

    const rowan = game.villagerByName('Rowan');
    const results = [];
    for (let n = 0; n < 3; n++) {
        const acc0 = game.mind.accepted;
        const t0 = Date.now();
        game.requestThink(rowan);
        // Pump until the background generate completes (real time passes).
        while (game.mind.inFlight && Date.now() - t0 < 5 * 60 * 1000) advanceTime(250);
        assert(!game.mind.inFlight, 'think ' + (n + 1) + ' completed');
        const raw = rowan.lastThink ? String(rowan.lastThink.raw) : '(none)';
        const accepted = game.mind.accepted > acc0;
        results.push({ accepted, ms: Date.now() - t0 });
        console.log('LIVE think ' + (n + 1) + ' [' + (accepted ? 'ACCEPTED' : 'DISCARDED') +
            ', ' + (Date.now() - t0) + ' ms] raw output:');
        console.log('----------------------------------------');
        console.log(raw);
        console.log('----------------------------------------');
        if (accepted) {
            console.log('LIVE parsed: ' + JSON.stringify(rowan.lastThink.parsed));
        }
        advanceTime(2000);   // let any goto/say play out between thinks
    }

    const nAccepted = results.filter(r => r.accepted).length;
    assert(nAccepted >= 1, 'at least one live think parsed as strict JSON and was applied (' +
        nAccepted + '/3)');

    const s = game.mind.stats;
    const tps = s.genMs > 0 ? (s.tokens / (s.genMs / 1000)) : 0;
    console.log('LIVE: acceptance ' + nAccepted + '/3, ' + s.tokens + ' tokens in ' +
        (s.genMs / 1000).toFixed(1) + ' s = ' + tps.toFixed(1) + ' tok/s');
    console.log('LIVE: goal="' + rowan.goal + '" memories=' + JSON.stringify(rowan.memories) +
        ' override=' + JSON.stringify(rowan.override));
    console.log('HEARTHFOLK-LIVE: PASS');
}
