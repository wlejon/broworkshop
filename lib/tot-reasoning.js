// lib/tot-reasoning.js — Tree-of-Thought MCTS reasoning for LLM apps.
// Integrates bro.ai.game.createGenericMcts (PUCT search) with LLM / heuristic thought generation.

/**
 * Executes a Tree-of-Thought search using Monte Carlo Tree Search.
 *
 * @param {Object} options
 * @param {string} options.prompt - The initial problem or reasoning prompt.
 * @param {Function} options.generateStep - (trajectory, actionIndex) => { text, reward, isTerminal }
 * @param {Function} [options.evaluateState] - (trajectory) => float in [-1, 1]
 * @param {number} [options.branchingFactor=3] - Candidate thoughts per reasoning step.
 * @param {number} [options.maxDepth=5] - Maximum reasoning depth.
 * @param {number} [options.iterations=80] - MCTS iterations per decision step.
 * @param {number} [options.cPuct=1.4] - Exploration constant.
 * @param {Function} [options.onStep] - Optional callback after each depth step (depth, chosenStep, stats).
 * @returns {Object} { trajectory, finalThought, totalSteps, completed }
 */
export function searchTreeOfThoughts(options) {
    const {
        prompt,
        generateStep,
        evaluateState = null,
        branchingFactor = 3,
        maxDepth = 5,
        iterations = 80,
        cPuct = 1.4,
        onStep = null,
    } = options;

    if (!prompt) throw new Error('searchTreeOfThoughts: prompt is required');
    if (typeof generateStep !== 'function') throw new Error('searchTreeOfThoughts: generateStep function is required');

    const liveState = {
        prompt,
        trajectory: [],
        depth: 0,
        done: false,
        cumulativeReward: 0,
    };

    // GenericEnv bridge contract matching brogameagent::mcts::GenericEnv
    const env = {
        numActions: branchingFactor,
        snapshot() {
            return {
                trajectory: liveState.trajectory.map(s => ({ ...s })),
                depth: liveState.depth,
                done: liveState.done,
                cumulativeReward: liveState.cumulativeReward,
            };
        },
        restore(snap) {
            liveState.trajectory = snap.trajectory.map(s => ({ ...s }));
            liveState.depth = snap.depth;
            liveState.done = snap.done;
            liveState.cumulativeReward = snap.cumulativeReward;
        },
        step(action) {
            if (liveState.done || liveState.depth >= maxDepth) {
                return { reward: 0.0, done: true };
            }
            const stepResult = generateStep(liveState.trajectory, action);
            const reward = (stepResult && typeof stepResult.reward === 'number') ? stepResult.reward : 0.0;
            const isTerminal = !!(stepResult && stepResult.isTerminal);

            liveState.trajectory.push({
                text: stepResult ? stepResult.text : '',
                reward,
                isTerminal,
            });
            liveState.depth += 1;
            liveState.cumulativeReward += reward;

            const done = isTerminal || liveState.depth >= maxDepth;
            liveState.done = done;
            return { reward, done };
        },
        legalActions() {
            if (liveState.done || liveState.depth >= maxDepth) return [];
            const acts = [];
            for (let i = 0; i < branchingFactor; i++) acts.push(i);
            return acts;
        },
        observe() {
            let evalScore = 0.0;
            if (evaluateState) {
                try { evalScore = evaluateState(liveState.trajectory); } catch (_) {}
            }
            return [
                liveState.depth,
                liveState.trajectory.length,
                liveState.cumulativeReward,
                evalScore,
            ];
        },
    };

    const finalTrajectory = [];

    // Native brogameagent GenericMcts path
    const hasNativeMcts = typeof bro !== 'undefined' && bro.ai && bro.ai.game && typeof bro.ai.game.createGenericMcts === 'function';

    for (let depth = 0; depth < maxDepth; depth++) {
        let bestAction = 0;
        let stats = null;

        if (hasNativeMcts) {
            const mcts = bro.ai.game.createGenericMcts({
                env,
                numActions: branchingFactor,
                iterations,
                cPuct,
                gamma: 0.95,
                rolloutDepth: 4,
            });
            bestAction = mcts.search();
            stats = mcts.lastStats();
        } else {
            // High-performance JS fallback for PUCT search when running in minimal environments
            bestAction = fallbackMctsSearch(env, iterations, cPuct, branchingFactor);
            stats = { iterations, bestAction };
        }

        if (bestAction < 0 || bestAction >= branchingFactor) break;

        const res = env.step(bestAction);
        const chosenStep = liveState.trajectory[liveState.trajectory.length - 1];
        finalTrajectory.push(chosenStep);

        if (onStep) {
            onStep(depth, chosenStep, stats);
        }

        if (res.done || chosenStep.isTerminal) break;
    }

    return {
        trajectory: finalTrajectory,
        finalThought: finalTrajectory.length ? finalTrajectory[finalTrajectory.length - 1].text : '',
        totalSteps: finalTrajectory.length,
        completed: finalTrajectory.length > 0 && (finalTrajectory[finalTrajectory.length - 1].isTerminal || finalTrajectory.length >= maxDepth),
    };
}

function fallbackMctsSearch(env, iterations, cPuct, numActions) {
    const rootSnapshot = env.snapshot();
    const visits = new Array(numActions).fill(0);
    const returns = new Array(numActions).fill(0.0);

    for (let iter = 0; iter < iterations; iter++) {
        env.restore(rootSnapshot);
        let totalVisits = 0;
        for (let a = 0; a < numActions; a++) totalVisits += visits[a];

        let bestA = 0;
        let bestScore = -Infinity;
        for (let a = 0; a < numActions; a++) {
            const q = visits[a] > 0 ? (returns[a] / visits[a]) : 0.0;
            const u = cPuct * Math.sqrt(Math.max(1, totalVisits)) / (1 + visits[a]);
            const score = q + u;
            if (score > bestScore) {
                bestScore = score;
                bestA = a;
            }
        }

        const res = env.step(bestA);
        let returnG = res.reward;
        if (!res.done) {
            // Random rollout
            for (let r = 0; r < 3; r++) {
                const acts = env.legalActions();
                if (!acts.length) break;
                const rndA = acts[Math.floor(Math.random() * acts.length)];
                const rRes = env.step(rndA);
                returnG += rRes.reward * Math.pow(0.95, r + 1);
                if (rRes.done) break;
            }
        }

        visits[bestA] += 1;
        returns[bestA] += returnG;
    }

    env.restore(rootSnapshot);

    let maxV = -1;
    let bestAction = 0;
    for (let a = 0; a < numActions; a++) {
        if (visits[a] > maxV) {
            maxV = visits[a];
            bestAction = a;
        }
    }
    return bestAction;
}
