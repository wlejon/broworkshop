// view/fog.js — the fog-of-war viewer: "show me what team X can see right
// now". Independent of which agent is selected (infoset_mcts keeps its own
// belief for planning); nothing here feeds back into any think(). It runs
// the same createTeamBelief + observe() primitives (sim/belief.js) over the
// live world and applies the result to the stage (view/stage.js applyFog).
import { beliefTracker } from "/app/sim/belief.js";
import { applyFog, clearFog } from "/app/view/stage.js";

const beliefs = beliefTracker(0xF06E0);
let enabled = false;
let viewTeam = 0;

export const fog = {
    get enabled() { return enabled; },
    set enabled(v) {
        enabled = !!v;
        if (!enabled) clearFog();
    },
    get team() { return viewTeam; },
    set team(t) { viewTeam = t | 0; },

    /** A new match: the old beliefs describe the previous world. */
    reset() { beliefs.reset(); },

    /** After the stage's own per-frame update, so the fog's hiding sticks. */
    tick(state, dt) {
        if (!enabled) return;
        const tb = beliefs.update(viewTeam, state, dt);
        const means = tb.mean();
        const enemies = tb.enemies();
        for (const e of enemies) {
            const m = means[e.enemyId];
            e.meanX = m ? m.x : null;
            e.meanZ = m ? m.z : null;
        }
        applyFog(enemies, state.byId);
    },
};
