// Inference-side ExIt agent: policy/value net + MCTS over the sim, with
// per-decision (obs, visit distribution, reward) bookkeeping. No replay
// buffer or SGD; the trainer worker owns those. Used by mcts_worker.js.
//
//   const agent = createPlayAgent({ sim, iterations });
//   agent.setWeights(bytes, version);            // whenever the trainer publishes
//   agent.startEpisode();
//   while (!done) done = agent.applyAction(agent.decide()).done;
//   const r = agent.endEpisode(reason);          // { tuples, actions, startSnap, ... }
//
// opts.priorAdjust(sig, prior) may reshape the search prior (the failure
// tape's applyPriors); opts.sigFn() gives the state key it is looked up by.

import { NUM_ACTIONS } from "/app/sim.js";
import { buildObs } from "/app/ai/obs.js";
import { createNet, softmax } from "/app/ai/policy.js";

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

export function createPlayAgent(opts) {
    const sim = opts.sim;
    const iterations = opts.iterations ?? 64;
    const gamma = opts.gamma ?? 0.99;
    const { priorAdjust = null, sigFn = null } = opts;
    const seed = opts.seed != null ? BigInt(opts.seed) : undefined;

    const net = createNet(seed);
    const logits = new Float32Array(NUM_ACTIONS);
    let netVersion = 0n;
    let weightsLoaded = false;

    function setWeights(bytes, version) {
        net.load(bytes);
        netVersion = BigInt(version || 0n);
        weightsLoaded = true;
    }

    function priorFn(obs, legal) {
        net.forward(obs, logits);
        const probs = softmax(logits, legal);
        if (!priorAdjust || !sigFn) return probs;
        const adjusted = priorAdjust(sigFn(), probs);
        if (!adjusted) return probs;
        let s = 0;
        for (let i = 0; i < adjusted.length; i++) s += adjusted[i];
        if (s > 0) for (let i = 0; i < adjusted.length; i++) adjusted[i] /= s;
        return adjusted;
    }

    // The tilemap keeps one saved damage slot, so the snapshot handed to
    // the native MCTS stays small (one search at a time per worker).
    const mcts = bro.ai.game.createGenericMcts({
        env: {
            numActions: NUM_ACTIONS,
            snapshot: () => {
                sim.tilemap.saveDamageSnapshot();
                return sim.snapshot();
            },
            restore: (s) => {
                sim.restore(s);
                sim.tilemap.restoreDamageSnapshot();
            },
            step: (a) => sim.step(a),
            legalActions: () => sim.legalActions(),
            observe: () => buildObs(sim),
        },
        cPuct: opts.cPuct ?? 1.5,
        gamma,
        rolloutDepth: opts.rolloutDepth ?? 12,
        iterations,
        dirichletAlpha: opts.dirichletAlpha ?? 0,
        dirichletEpsilon: opts.dirichletEpsilon ?? 0,
        seed: seed != null ? (Number(seed & 0xFFFFFFFFn) ^ 0xC0DE) >>> 0 : 0xC0DE,
        priorFn,
        valueFn: (obs) => net.forward(obs, logits),
    });

    const pending = [];    // [{ obs, policyTarget, reward }]
    const actions = [];
    let startSnap = null;
    let bestX = -Infinity;
    let totalReturn = 0;

    function startEpisode() {
        startSnap = sim.snapshot();
        pending.length = 0;
        actions.length = 0;
        bestX = sim.player.x;
        totalReturn = 0;
    }

    function decide() {
        const obs = buildObs(sim).slice();
        mcts.reset();
        const action = mcts.search();
        // Drop any beam overlays the search left behind before the real move.
        if (sim.tilemap.clearOverlays) sim.tilemap.clearOverlays();
        pending.push({ obs, policyTarget: mcts.rootVisits(), reward: 0 });
        return action;
    }

    /** Take the real move and bake its beam overlays into the terrain. */
    function applyAction(action) {
        const out = sim.step(action);
        if (sim.tilemap.commitOverlays) sim.tilemap.commitOverlays();
        if (pending.length) pending[pending.length - 1].reward = out.reward;
        actions.push(action);
        totalReturn += out.reward;
        if (sim.player.x > bestX) bestX = sim.player.x;
        return out;
    }

    /** Seal value targets (discounted return, clamped to ±1). */
    function endEpisode(reason) {
        let g = 0;
        for (let i = pending.length - 1; i >= 0; i--) {
            g = pending[i].reward + gamma * g;
            pending[i].valueTarget = clamp(g, -1, 1);
        }
        const result = {
            tuples: pending.slice(),
            reason: reason || "end",
            actions: actions.slice(),
            startSnap,
            bestX,
            decisions: pending.length,
            totalReturn,
        };
        pending.length = 0;
        actions.length = 0;
        startSnap = null;
        return result;
    }

    return {
        setWeights, startEpisode, decide, applyAction, endEpisode,
        get netVersion() { return netVersion; },
        get weightsLoaded() { return weightsLoaded; },
        get iterations() { return iterations; },
    };
}
