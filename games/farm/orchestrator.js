// orchestrator.js — THE SWAPPABLE SEAM.
//
// This is a rule-based stand-in for a future LLM orchestrator. It is isolated
// behind a tiny interface so the LLM version drops in unchanged:
//
//   const orch = createOrchestrator();
//   orch.decide(world);   // reads world.observe(), assigns tasks to idle NPCs,
//                         // and speaks instructions through world.say().
//
// decide() is the ENTIRE contract. The LLM version keeps the same signature:
// read observe(), emit task objects (see tasks.js), set npc.task, and call
// world.say(speakerId, text). It owns no other state the caller depends on.
//
// Rules: prioritize by need severity, never double-assign the same target
// (in-flight goals are read back off the NPCs themselves), and softly prefer
// NPCs by role — but let any idle worker take any job when needed.

import {
    buildServiceWaterTrough, buildServiceFeedTrough,
    buildHarvest, buildWaterCrop, buildPlant, buildCollectProduce,
} from './tasks.js';

const BOSS = 'Foreman';   // orchestrator's speaker label in the dialog feed

// Short, varied templates. flavor only — proves the speaking channel before
// the LLM exists. {name} = worker, {what} = subject.
const TEMPLATES = {
    water: [
        '{name}, the {what} are thirsty — top up their water.',
        '{name}, water trough\'s low at the {what}. Go fill it.',
        'Need water at the {what}, {name}.',
    ],
    feed: [
        '{name}, feed\'s running low at the {what} — restock it.',
        '{name}, the {what} need feeding.',
        'Load up some feed for the {what}, {name}.',
    ],
    harvest: [
        '{name}, {what} is ripe — bring it in.',
        '{name}, get that {what} harvested.',
        'Harvest time, {name}: {what}.',
    ],
    waterCrop: [
        '{name}, {what} is parched — give it a drink.',
        '{name}, water {what} before it wilts.',
    ],
    plant: [
        '{name}, sow {what} while there\'s daylight.',
        '{name}, that bed\'s empty — plant {what}.',
    ],
    collect: [
        '{name}, go collect the {what}.',
        '{name}, {what} are piling up — gather them.',
    ],
};

const ACKS = ['On it.', 'Right away.', 'Heading over.', 'Got it.', 'Will do.'];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function fill(tmpl, name, what) {
    return tmpl.replace('{name}', name).replace('{what}', what);
}

// Soft role affinity: rancher -> animals/troughs/produce, gardener -> crops.
// farmhand is a generalist. Score is only a tiebreaker; any idle npc qualifies.
function roleScore(npc, jobRole) {
    if (npc.role === jobRole) return 2;
    if (npc.role === 'farmhand') return 1;   // generalist, always willing
    return 0;
}

export function createOrchestrator() {
    // Build the candidate job list from a snapshot. Each job carries enough to
    // build the task, dedup it, speak about it, and prioritize it.
    function computeJobs(world, o) {
        const jobs = [];
        const animalsByPen = {};
        for (const a of o.animals) {
            if (!a.alive) continue;
            (animalsByPen[a.penId] || (animalsByPen[a.penId] = [])).push(a);
        }
        const troughByPenKind = {};
        for (const t of o.troughs) troughByPenKind[t.penId + ':' + t.kind] = t.fill;

        // Pens: water + feed service, driven by trough level AND animal need.
        for (const penId of Object.keys(animalsByPen)) {
            const herd = animalsByPen[penId];
            const maxThirst = Math.max(...herd.map((a) => a.thirst));
            const maxHunger = Math.max(...herd.map((a) => a.hunger));
            const waterFill = troughByPenKind[penId + ':water'] ?? 100;
            const feedFill = troughByPenKind[penId + ':feed'] ?? 100;
            const subject = penLabelLower(world, penId);

            if (maxThirst >= 60 || waterFill < 35) {
                jobs.push({
                    goal: 'service-water:' + penId, target: 'water:' + penId,
                    role: 'rancher', kind: 'water', subject,
                    priority: maxThirst + (waterFill < 12 ? 50 : 0) + 20,
                    build: () => buildServiceWaterTrough(world, penId),
                });
            }
            if (maxHunger >= 60 || feedFill < 35) {
                jobs.push({
                    goal: 'service-feed:' + penId, target: 'feed:' + penId,
                    role: 'rancher', kind: 'feed', subject,
                    priority: maxHunger + (feedFill < 12 ? 50 : 0) + 15,
                    build: () => buildServiceFeedTrough(world, penId),
                });
            }
        }

        // Crops: harvest ripe, water dry, plant empty.
        for (const c of o.crops) {
            if (c.stage === 'ripe') {
                jobs.push({
                    goal: 'harvest:' + c.id, target: 'crop:' + c.id,
                    role: 'gardener', kind: 'harvest', subject: c.kind + ' (' + c.id + ')',
                    priority: 58,
                    build: () => buildHarvest(world, c.id),
                });
            } else if (c.stage === 'empty') {
                jobs.push({
                    goal: 'plant:' + c.plotIndex, target: 'plot:' + c.plotIndex,
                    role: 'gardener', kind: 'plant', subject: 'wheat',
                    priority: 22,
                    build: () => buildPlant(world, c.plotIndex, 'wheat'),
                });
            } else if (c.moisture < 25) {
                jobs.push({
                    goal: 'water-crop:' + c.id, target: 'crop:' + c.id,
                    role: 'gardener', kind: 'waterCrop', subject: c.kind + ' (' + c.id + ')',
                    priority: 46 + (c.moisture < 10 ? 20 : 0),
                    build: () => buildWaterCrop(world, c.id),
                });
            }
        }

        // Produce: collect when it's piling up.
        for (const penId of Object.keys(o.pending)) {
            const n = o.pending[penId];
            if (n >= 2) {
                jobs.push({
                    goal: 'collect:' + penId, target: 'collect:' + penId,
                    role: 'rancher', kind: 'collect',
                    subject: (world.pens[penId] && world.pens[penId].goodLabel) || 'produce',
                    priority: 40 + Math.min(30, n * 4),
                    build: () => buildCollectProduce(world, penId),
                });
            }
        }

        return jobs;
    }

    function decide(world) {
        const o = world.observe();

        // In-flight targets, read straight off the workers (no hidden state).
        const inflight = new Set();
        for (const n of world.npcs) {
            if (n.task && n.task.target) inflight.add(n.task.target);
        }
        // Treat whatever the human player is currently standing over as claimed
        // too, so we don't dispatch an NPC to a trough/crop the player is about
        // to handle. The hint clears the moment they walk away.
        if (world.player && world.player.targetHint) {
            inflight.add(world.player.targetHint);
        }

        let idle = world.npcs.filter((n) => n.task == null);
        if (idle.length === 0) return;

        const jobs = computeJobs(world, o)
            .filter((j) => !inflight.has(j.target))
            .sort((a, b) => b.priority - a.priority);

        const assignedTargets = new Set();
        for (const job of jobs) {
            if (idle.length === 0) break;
            if (assignedTargets.has(job.target)) continue;

            // Best idle worker for this job: role affinity, then stable order.
            idle.sort((a, b) => roleScore(b, job.role) - roleScore(a, job.role));
            const npc = idle.shift();

            const task = job.build();
            task.npcId = npc.id;
            npc.task = task;
            npc.state = 'working';

            assignedTargets.add(job.target);

            // Speak: boss issues the order, worker acknowledges.
            const tmpl = TEMPLATES[job.kind];
            if (tmpl) world.say(BOSS, fill(pick(tmpl), npc.name, job.subject));
            world.say(npc.id, pick(ACKS));
        }
    }

    return { decide };
}

function penLabelLower(world, penId) {
    const pen = world.pens[penId];
    if (!pen) return penId;
    // "Cow Pasture" -> "cows", "Chicken Coop" -> "chickens" — light touch.
    if (penId === 'pasture') return 'cows';
    if (penId === 'coop') return 'chickens';
    return (pen.label || penId).toLowerCase();
}
