// sim/belief.js — per-team fog-of-war belief (bro.ai.game.createTeamBelief +
// observe). Shared by agents/infoset_mcts.js, which searches through it, and
// view/fog.js, which draws what a team can see; each keeps its own tracker
// (the viewer must not perturb the planner's particles).
//
// Ground truth stays fully simulated (brogameagent's World has no visibility
// concept); the belief is a particle filter over each enemy's position,
// seeded at the enemy's spawn (matches don't randomize fog at spawn) and
// driven by propagate() + observe()/update() every tick.

export const VIS_CFG = { fovRadians: Math.PI * 0.6, maxRange: 14, checkLos: true };
const NUM_PARTICLES = 24;
const MOTION = { maxSpeed: 6, accelStd: 4, spreadOnLoss: 3 };

/** A lazily built TeamBelief per team. `seedBase` keeps trackers independent. */
export function beliefTracker(seedBase) {
    let beliefs = {};      // teamId -> TeamBelief
    let registered = {};   // teamId -> { enemyId: true }

    function ensure(teamId, nav) {
        if (!beliefs[teamId]) {
            beliefs[teamId] = bro.ai.game.createTeamBelief({
                teamId, numParticles: NUM_PARTICLES, navGrid: nav, motion: MOTION,
                seed: (seedBase + teamId) >>> 0,
            });
            registered[teamId] = {};
        }
        return beliefs[teamId];
    }

    function registerEnemies(tb, teamId, agents) {
        const seen = registered[teamId];
        for (const a of agents) {
            if (a.unit.teamId === teamId || seen[a.unit.id]) continue;
            seen[a.unit.id] = true;
            tb.registerEnemy(a.unit.id, a.unit.maxHp, { x: a.x, z: a.z });
        }
    }

    return {
        get: (teamId) => beliefs[teamId] || null,

        /** Advance team `teamId`'s belief by dt against match `state`; returns it. */
        update(teamId, state, dt) {
            const tb = ensure(teamId, state.nav);
            registerEnemies(tb, teamId, state.agents);
            tb.propagate(state.world, VIS_CFG, dt);
            tb.update(bro.ai.game.observe(state.world, teamId, VIS_CFG, state.elapsed));
            return tb;
        },

        /**
         * { enemyId: true } for every enemy this team has ever observed, or
         * null before the first update. TeamBelief keeps predicting a lost
         * contact ("last known position"); a never-seen enemy is unknown.
         */
        knownEnemyIds(teamId) {
            const tb = beliefs[teamId];
            if (!tb) return null;
            const known = {};
            for (const e of tb.enemies()) if (e.everSeen) known[e.enemyId] = true;
            return known;
        },

        reset() { beliefs = {}; registered = {}; },
    };
}
