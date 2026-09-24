// LIVE-MODEL check (tagged `ml` in tests/app-tags.txt; runs with
// scripts/validate.sh --ml). Gated on the Qwen3-32B GGUF being found: loads
// the real model (CUDA), runs three serial thinks for one villager on real
// situation digests, and requires at least one to come back as strict JSON
// and be applied. Prints every raw output plus tokens/sec.
import { check, frames, pumpUntil } from "/lib/kit/test.js";
import { findWeights, missingWeights } from "/lib/kit/weights.js";
import { QWEN_CANDIDATES } from "/app/models.js";

const H = window.HEARTH;
if (!findWeights(QWEN_CANDIDATES)) {
    console.log("LIVE: skipped (this is the gate, not a failure): " + missingWeights("Qwen3-32B", QWEN_CANDIDATES));
} else {
    frames(2);
    const game = H.start();
    frames(4);

    // Wait (wall-clock) for the model load the run kicked off: a 32B GGUF
    // takes minutes to reach VRAM.
    console.log("LIVE: waiting for model load…");
    pumpUntil(() => game.mind.status !== "loading", 15 * 60 * 1000, 500);
    check(game.mind.status === "ready", "model loaded (status: " + game.mind.status + ")");

    const rowan = game.villagerByName("Rowan");
    let accepted = 0;
    for (let n = 0; n < 3; n++) {
        const acc0 = game.mind.accepted;
        const t0 = Date.now();
        game.requestThink(rowan);
        pumpUntil(() => !game.mind.inFlight, 5 * 60 * 1000, 250);
        check(!game.mind.inFlight, "think " + (n + 1) + " completed");
        const ok = game.mind.accepted > acc0;
        if (ok) accepted++;
        console.log("LIVE think " + (n + 1) + " [" + (ok ? "ACCEPTED" : "DISCARDED") + ", " +
            (Date.now() - t0) + " ms] raw output:\n" + String(rowan.lastThink ? rowan.lastThink.raw : "(none)"));
        if (ok) console.log("LIVE parsed: " + JSON.stringify(rowan.lastThink.parsed));
        advanceTime(2000);   // let any goto/say play out between thinks
    }
    check(accepted >= 1, "at least one live think parsed as strict JSON and was applied (" + accepted + "/3)");

    const s = game.mind.stats;
    const tps = s.genMs > 0 ? s.tokens / (s.genMs / 1000) : 0;
    console.log("LIVE: acceptance " + accepted + "/3, " + s.tokens + " tokens in " +
        (s.genMs / 1000).toFixed(1) + " s = " + tps.toFixed(1) + " tok/s");
    console.log("LIVE: goal=\"" + rowan.goal + "\" memories=" + JSON.stringify(rowan.memories));
}
