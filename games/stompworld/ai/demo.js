// AI Demo mode: one full run of the level by the trained agent.
//   network    greedy argmax of the policy from spawn until the hero takes
//              the beam pickup (auto-fire handles enemies and terrain)
//   backtrack  a scripted walker heads back to the spawn column
//   toflag     then walks to the flag, auto-fire clearing the way
//   finished   frozen on the last frame until the player backs out
// Runs on the page (no workers). Without ckpt/best.bin it says so.

import { TILE } from "/app/rules.js";
import { createLevelSim, FIXED_DT_MS, FRAME_SKIP, endReason } from "/app/sim.js";
import { createCamera, followBody, drawWorld, drawBeams, drawPanel, drawNotice, makeFlash, ageFlashes } from "/app/render.js";
import { buildObs } from "/app/ai/obs.js";
import { createNet, loadBest, argmax, ckptFiles } from "/app/ai/policy.js";
import { scriptedMove } from "/app/ai/heuristic.js";

const DECISION_MS = FIXED_DT_MS * FRAME_SKIP;   // the training cadence
const MAX_CATCHUP = 4;

/** `ckptDir` holds best.bin (default ckpt). */
export function createDemo({ ckptDir } = {}) {
    const sim = createLevelSim({ timeLimit: 600, stallDecisions: 0 });
    const cam = createCamera(sim.tilemap);
    followBody(cam, sim.player, true);
    const net = createNet();
    const hasCheckpoint = loadBest(net, ckptDir);
    const logits = new Float32Array(sim.numActions);
    const spawnX = sim.player.x;

    let phase = hasCheckpoint ? "network" : "finished";
    let ending = "";
    let sinceDecision = 0;
    let beams = [];
    let pickupT = 0;

    function decide() {
        if (phase === "network") {
            net.forward(buildObs(sim), logits);
            return argmax(logits);
        }
        if (phase === "backtrack") return scriptedMove(sim, -1);
        if (phase === "toflag") return scriptedMove(sim, 1);
        return 0;
    }

    function step() {
        const out = sim.step(decide());
        sim.tilemap.commitOverlays();
        for (const b of sim.recentBeams) beams.push(makeFlash(b));
        if (phase === "network" && sim.hasWeapon) phase = "backtrack";
        else if (phase === "backtrack" && sim.player.x <= spawnX + 2) phase = "toflag";
        if (out.done) {
            ending = endReason(sim);
            phase = "finished";
        }
    }

    function update(dt) {
        if (phase === "finished") return;
        pickupT += dt;
        beams = ageFlashes(beams, dt);
        // Catch up after a stall, but only a few decisions per frame.
        sinceDecision += dt;
        for (let n = 0; n < MAX_CATCHUP && sinceDecision >= DECISION_MS && phase !== "finished"; n++) {
            sinceDecision -= DECISION_MS;
            step();
        }
        followBody(cam, sim.player);
    }

    function draw(ctx) {
        if (!hasCheckpoint) {
            drawNotice(ctx, "No checkpoint found", [
                "Train the AI first (" + ckptFiles().best + ")",
                "Esc to return to the title screen",
            ], { dim: true });
            return;
        }
        drawWorld(ctx, cam, {
            tilemap: sim.tilemap,
            flag: sim.flag,
            pickup: sim.pickupCollected ? null : sim.pickup,
            pickupT,
            stompers: sim.stompers,
            flyers: sim.flyers,
            hero: sim.player,
            heroTick: sim.tick,
        });
        drawBeams(ctx, cam, beams);
        drawPanel(ctx, [
            "AI DEMO — Esc to exit",
            "phase: " + phase + (ending ? " (" + ending + ")" : ""),
            "hasWeapon: " + (sim.hasWeapon ? "yes" : "no")
                + "   x=" + (sim.player.x | 0) + "   col=" + Math.floor(sim.player.x / TILE),
        ], 360);
    }

    return {
        update, draw,
        stop() { beams = []; },
        get state() { return { phase, ending, hasCheckpoint, tick: sim.tick, x: sim.player.x, hasWeapon: sim.hasWeapon }; },
    };
}
