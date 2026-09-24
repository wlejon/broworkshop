// Tests for lib/tot-reasoning.js (Tree-of-Thought MCTS reasoning).
import { searchTreeOfThoughts } from "/lib/tot-reasoning.js";

function assert(cond, msg) {
    if (!cond) throw new Error('Assertion failed: ' + msg);
}

console.log('=== Test Tree-of-Thought MCTS Reasoning ===');

// Test 1: Deductive reasoning path
{
    console.log('--- Test 1: Deductive Problem ---');
    const result = searchTreeOfThoughts({
        prompt: 'Solve the riddle: what has keys but no locks?',
        branchingFactor: 3,
        maxDepth: 3,
        iterations: 60,
        generateStep: (traj, action) => {
            const depth = traj.length;
            if (depth === 0) {
                const hypotheses = [
                    { text: 'Hypothesis A: A treasure chest', reward: -0.5, isTerminal: false },
                    { text: 'Hypothesis B: A piano or keyboard', reward: 0.9, isTerminal: false },
                    { text: 'Hypothesis C: A padlock', reward: -0.8, isTerminal: false },
                ];
                return hypotheses[action];
            } else if (depth === 1) {
                const parent = traj[0].text;
                if (parent.includes('piano')) {
                    const steps = [
                        { text: 'Verification: A piano has 88 keys and produces music, no physical locks.', reward: 1.0, isTerminal: true },
                        { text: 'Verification: It might be a computer keyboard.', reward: 0.8, isTerminal: true },
                        { text: 'Alternative: A map legend has keys.', reward: 0.7, isTerminal: true },
                    ];
                    return steps[action];
                } else {
                    return { text: 'Dead end', reward: -1.0, isTerminal: true };
                }
            }
            return { text: 'Concluded', reward: 0.0, isTerminal: true };
        },
    });

    assert(result.completed, 'Search completed');
    assert(result.trajectory.length === 2, 'Reasoning required 2 steps');
    assert(result.trajectory[0].text.includes('piano'), 'MCTS chose the piano hypothesis at root');
    assert(result.trajectory[1].reward >= 0.8, 'Final verification has high reward');
    console.log('  PASS: Deductive search chose optimal reasoning path');
}

// Test 2: Arithmetic Countdown / 24 Game
{
    console.log('--- Test 2: Arithmetic Countdown Search ---');
    // Target 24 from [3, 8, 5]
    const result = searchTreeOfThoughts({
        prompt: 'Target 24 from 3, 8',
        branchingFactor: 3,
        maxDepth: 2,
        iterations: 80,
        generateStep: (traj, action) => {
            const depth = traj.length;
            if (depth === 0) {
                const ops = [
                    { text: 'Step 1: Compute 8 * 3 = 24', reward: 1.0, isTerminal: true },
                    { text: 'Step 1: Compute 8 + 3 = 11', reward: -0.2, isTerminal: false },
                    { text: 'Step 1: Compute 8 - 3 = 5', reward: -0.5, isTerminal: false },
                ];
                return ops[action];
            }
            return { text: 'Done', reward: 0, isTerminal: true };
        },
    });

    assert(result.completed, 'Countdown completed');
    assert(result.trajectory[0].text.includes('8 * 3 = 24'), 'MCTS picked 8 * 3 = 24');
    console.log('  PASS: Arithmetic countdown successfully found optimal branch');
}

console.log('All Tree-of-Thought tests passed successfully!');
