// agents/exit_net.js — Showcase for brogameagent's ExIt (expert iteration)
// training stack: SingleHeroNet + NeuralEvaluator/NeuralPrior driving a
// normal createMcts search, exactly like brogameagent's own reference
// trainer (brogameagent/tools/nn_exit.cpp). This ONE module serves two
// roles:
//   - Selectable in the live Red/Blue AI dropdown as "exit_net" — pure
//     inference against whatever weights are currently loaded/trained.
//   - Driven by train_exit.js (a headless-only script, not imported here)
//     during self-play generation: setCapturing(true) makes think() also
//     record a Situation per decision via bro.ai.game.learn.makeSituation,
//     which the trainer backfills with the episode's discounted return
//     and pushes into a ReplayBuffer.
//
// setUseNet(false) switches the search to classical HpDelta/AggressiveRollout
// MCTS instead of the neural evaluator/prior — mirrors nn_exit.cpp's own
// iteration-0 special case (an untrained net produces noise, so the first
// generation pass uses the same classical MCTS every other agent in this
// app already exercises, for cleaner bootstrap data).
import { AI } from "/app/ai.js";
import { ActionExec } from "/app/agents/action_exec.js";
import { Agents } from "/app/agents/registry.js";

export const ExitNet = (function () {
    "use strict";

    var net = null;
    var handle = null;
    var mctsByHero = {};   // heroUnitId -> { mcts, useNet, seed } — rebuilt if either changes
    var useNet = true;
    var seed = 0xE717;     // train_exit.js varies this per episode for self-play diversity
    var capturing = false;
    var captured = [];     // Situations recorded this episode (only while capturing)

    function ensureNet() {
        if (!net) {
            net = bro.ai.game.nn.createSingleHeroNet({
                enc: { hidden: 32, embedDim: 32 },
                trunkHidden: 64, valueHidden: 32,
                seed: 0xE7C0DEn,
            });
            handle = bro.ai.game.nn.createWeightsHandle();
            handle.publish(net.save(), 0n);
        }
        return net;
    }

    function ensureMcts(heroId) {
        ensureNet();
        var cur = mctsByHero[heroId];
        if (cur && cur.useNet === useNet && cur.seed === seed) return cur.mcts;

        var cfg = {
            iterations: 250, budgetMs: 12, rolloutHorizon: 16, actionRepeat: 3,
            opponentPolicy: "aggressive", seed: (seed + heroId) >>> 0,
        };
        if (useNet) {
            cfg.evaluator = bro.ai.game.learn.createNeuralEvaluator(net, handle);
            cfg.prior = bro.ai.game.learn.createNeuralPrior(net, handle);
            cfg.priorC = 1.5;
            cfg.useLeafValue = true;
        } else {
            cfg.evaluator = "hpDelta";
            cfg.rolloutPolicy = "aggressive";
        }
        var m = bro.ai.game.createMcts(cfg);
        mctsByHero[heroId] = { mcts: m, useNet: useNet, seed: seed };
        return m;
    }

    return {
        net: function () { return ensureNet(); },
        handle: function () { ensureNet(); return handle; },

        // bytes: Uint8Array of a saved .bgnn blob (see net.save()/net.load()).
        loadCheckpoint: function (bytes) {
            ensureNet();
            net.load(bytes);
            handle.publish(net.save(), (handle.version() || 0n) + 1n);
            mctsByHero = {};   // stale NeuralEvaluator/Prior closures reference the old blob
        },

        setUseNet: function (v) { useNet = !!v; },
        isUsingNet: function () { return useNet; },
        setSeed: function (v) { seed = v >>> 0; },

        setCapturing: function (v) { capturing = !!v; },
        isCapturing: function () { return capturing; },
        // Hands back and clears the situations recorded since the last call —
        // train_exit.js calls this once per episode.
        takeCaptured: function () { var c = captured; captured = []; return c; },

        reset: function () { mctsByHero = {}; captured = []; },

        think: function (self, world) {
            var agent = self.agent;
            var u = agent.unit;
            if (!u.alive) { self.hold(0.2); return; }

            var m = ensureMcts(u.id);
            var action = m.search(world, agent);
            if (capturing) {
                var sit = bro.ai.game.learn.makeSituation(m, agent, world);
                if (sit) captured.push(sit);
            }
            m.advanceRoot(action);
            ActionExec.apply(self, world, action);
        },
    };
})();

Agents.register({
    id: "exit_net",
    label: "ExIt Net (learned)",
    reset: function () { ExitNet.reset(); },
    think: ExitNet.think,
    stats: function (appState, teamId) {
        var heroes = AI.shared.teams[teamId] || [];
        if (!heroes.length) return null;
        var h = ExitNet.handle();
        return {
            label: "exit_net",
            useNet: ExitNet.isUsingNet(),
            netVersion: h ? Number(h.version()) : 0,
        };
    },
});
