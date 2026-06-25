// tasks.js — task / instruction-tree system for farm NPC workers.
//
// A TASK is PLAIN SERIALIZABLE DATA — no functions, no closures. A future LLM
// orchestrator will emit these objects directly, so the only things inside a
// task are JSON-shaped values. The executor (advanceTask) and the task builders
// live here; the orchestrator (orchestrator.js) decides WHICH task to build.
//
// Task shape:
//   {
//     id: 'task-3',
//     npcId: 'npc-mara',            // set by the orchestrator on assignment
//     goal: 'service-water:pasture',// human/agent-readable intent
//     target: 'pasture',            // dedup key the orchestrator tracks in-flight
//     steps: [                      // small, data-only vocabulary
//       { type:'move', x, y, label },          // walk to a tile
//       { type:'act',  verb, args, carry?, drop?, say? }, // invoke world.actions[verb]
//       { type:'wait', ms },                   // dwell so the action reads as deliberate
//     ],
//     cursor: 0,                    // index of the active step
//     status: 'running',            // running | done | aborted
//     result: [],                   // recorded act results (for inspection)
//   }
//
// Step flavor fields on an `act`:
//   carry  — set npc.carrying to this string (e.g. 'water') after the act
//   drop   — clear npc.carrying after the act
//   say    — npc speaks this line on success (announce on completion)

import {
    REGIONS, PENS, CROP_KINDS, WORKER,
    moveSpeedMul, proficiencyMul, STAT_XP,
} from './defs.js';

const WALK = 3.2;     // tiles / second when executing a task (brisker than wander)
const ARRIVE = 0.28;  // tiles — "close enough" to count a move step done

// Work-XP awarded per completed `act`, by verb. Animal-domain acts feed
// Husbandry (with a little Strength for the haul), crop acts feed Farming, and
// the raw fetch/load acts feed Strength. world.awardWork rolls these into the
// worker's sheet and announces any level-up. (Distance walked -> Agility, and a
// finished job -> Endurance, are handled in the executor below.)
const VERB_XP = {
    drawWater:         [['strength', STAT_XP.strength]],
    loadFeed:          [['strength', STAT_XP.strength]],
    refillWaterTrough: [['husbandry', STAT_XP.husbandry], ['strength', STAT_XP.strength * 0.5]],
    refillFeedTrough:  [['husbandry', STAT_XP.husbandry], ['strength', STAT_XP.strength * 0.5]],
    tendAnimal:        [['husbandry', STAT_XP.husbandry]],
    collectProduce:    [['husbandry', STAT_XP.husbandry * 0.7], ['strength', STAT_XP.strength * 0.4]],
    plant:             [['farming', STAT_XP.farming]],
    waterCrop:         [['farming', STAT_XP.farming]],
    harvest:           [['farming', STAT_XP.farming]],
};

// The work DOMAIN a job's role belongs to, for the proficiency speed-up: a
// rancher job is animal work (Husbandry), a gardener job is crop work (Farming).
function jobDomain(role) {
    return role === 'rancher' ? 'husbandry' : role === 'gardener' ? 'farming' : null;
}

let _taskSeq = 0;

function makeTask(goal, target, steps) {
    return {
        id: 'task-' + (++_taskSeq),
        npcId: null,
        goal,
        target,
        steps,
        cursor: 0,
        status: 'running',
        result: [],
    };
}

// Center tile of a named building/region from defs.js.
function regionCenter(id) {
    const r = REGIONS.find((x) => x.id === id);
    if (!r) return { x: 0, y: 0 };
    return { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 };
}

function penLabel(penId) {
    return (PENS[penId] && PENS[penId].label) || penId;
}

// ---- executor ---------------------------------------------------------------
// Drives npc.task one step at a time. Returns true while the task is live.
export function advanceTask(world, npc, dt) {
    const task = npc.task;
    if (!task) return false;
    const s = dt / 1000;

    let step = task.steps[task.cursor];
    if (!step) { finishTask(world, npc, task, 'done'); return false; }

    // Stat coupling replaces the old flat role bonus:
    //   • walk speed   <- Agility (moveSpeedMul)
    //   • work dwell   <- the relevant skill for this job's domain (proficiencyMul:
    //                     Husbandry speeds animal tasks, Farming speeds crop tasks)
    // task.role is stamped by the orchestrator from the job's role.
    const domain = jobDomain(task.role);
    const walkMul = moveSpeedMul(npc);
    const workMul = proficiencyMul(npc, domain);

    if (step.type === 'move') {
        npc.state = 'walking';
        npc.tx = step.x; npc.ty = step.y;
        const dx = step.x - npc.x, dy = step.y - npc.y;
        const d = Math.hypot(dx, dy);
        if (d <= ARRIVE) {
            npc.x = step.x; npc.y = step.y;
            task.cursor++;
        } else {
            const sp = Math.min(WALK * walkMul * s, d);
            npc.x += (dx / d) * sp;
            npc.y += (dy / d) * sp;
            // Distance walked builds Agility (small, accumulated over move steps).
            world.awardWork(npc, [['agility', sp * STAT_XP.agility]]);
        }
        return true;
    }

    if (step.type === 'wait') {
        npc.state = 'working';
        step._elapsed = (step._elapsed || 0) + dt;
        if (step._elapsed >= (step.ms || 0) / workMul) task.cursor++;
        return true;
    }

    // ---- spoken-exchange step: hold the worker until the line is fully heard ---
    // { type:'say', speaker, text } — on first entry, trigger the utterance via
    // the PRIORITY voice path (so the bounded queue can't drop a behaviour-gating
    // briefing line) and push it to the dialog/speech-bubble channel. Then the
    // worker stands ('talking' if it's their own line, else 'listening') until the
    // utterance has FINISHED before the cursor advances — so a briefed worker
    // hears the whole order, and waits out their own reply, before departing.
    //
    // Gating (advance when ANY is true):
    //   1. the real Kokoro utterance resolved with audio (audio on -> exact length)
    //   2. the text-length estimate elapsed AND nothing is currently speaking this
    //      line (audio off/unavailable -> deterministic, readable silent pacing)
    //   3. a hard safety cap elapsed (est*2 + 3s) — a worker can NEVER wedge here
    //      if an utterance never resolves.
    if (step.type === 'say') {
        // Turn-taking: a spoken exchange holds a single global conversation floor
        // (world.convRequest/convRelease) so only ONE briefing is live at a time.
        // A worker that has reached its say step but hasn't been granted the floor
        // stands and waits its turn — it does NOT begin its utterance or start its
        // timer until the floor is free, so its spoken timing lines up with its
        // OWN line instead of elapsing while another worker is being spoken to.
        // The floor is held across the whole contiguous say-run (the Foreman's
        // order + the worker's ack) and released when the run ends (below) or the
        // task finishes/aborts (finishTask).
        const reqFloor = world.convRequest || (() => true);
        if (!reqFloor(npc.id)) {
            npc.state = 'waiting';   // in line at the Foreman, awaiting their turn
            return true;
        }
        npc.state = (step.speaker === npc.id) ? 'talking' : 'listening';
        if (!step._started) {
            step._started = true;
            const words = String(step.text || '').trim().split(/\s+/).filter(Boolean).length || 1;
            step._estSec = words * 0.38 + 0.4;     // ~speaking rate + lead-in
            step._waitMs = 0;
            step._spokenSec = null;                 // set when the real utterance resolves
            step._spokenDone = false;
            // world.say is teed into the voice channel in app.js and returns the
            // voice.speak Promise<seconds>; capture it to learn the real length.
            // A bare world.say (untee'd) returns undefined -> we fall back to the
            // estimate path, which is fully deterministic under virtual time.
            let p = null;
            try { p = world.say(step.speaker, step.text, { priority: true }); } catch (e) { p = null; }
            if (p && typeof p.then === 'function') {
                p.then((sec) => { step._spokenSec = sec; step._spokenDone = true; },
                       () => { step._spokenDone = true; });
            }
        }
        step._waitMs += dt;
        const estMs = step._estSec * 1000;
        const safetyMs = estMs * 2 + 3000;
        const v = (typeof globalThis !== 'undefined') ? globalThis.farmVoice : null;
        const speakingThisLine = !!(v && v.speaking && v.speaking(step.speaker));

        let done = false;
        if (step._spokenDone && step._spokenSec > 0) {
            done = true;                                   // real audio finished
        } else if (step._waitMs >= estMs && !speakingThisLine) {
            done = true;                                   // estimate path (silent)
        } else if (step._waitMs >= safetyMs) {
            done = true;                                   // hard safety cap
        }
        if (done) {
            task.cursor++;
            // Release the floor when leaving the contiguous say-run, so the next
            // worker in line can take their turn. Held across consecutive say
            // steps (order -> ack); freed the moment the worker departs to work.
            const next = task.steps[task.cursor];
            if (!next || next.type !== 'say') {
                (world.convRelease || (() => {}))(npc.id);
            }
        }
        return true;
    }

    // ---- worker-care steps (Pass D) -----------------------------------------
    if (step.type === 'rest') {
        npc.state = 'resting';
        if (npc.stamina >= (step.until || WORKER.staminaOk)) task.cursor++;
        return true;
    }
    if (step.type === 'sleep') {
        npc.state = 'sleeping';
        // Wake at morning (dawn/day); sleep through the whole night otherwise.
        const ph = world.env.dayPhase;
        if (ph === 'dawn' || ph === 'day') task.cursor++;
        return true;
    }
    if (step.type === 'eat') {
        npc.state = 'eating';
        step._elapsed = (step._elapsed || 0) + dt;
        if (npc.energy >= (step.until || WORKER.energyOk) || step._elapsed >= (step.ms || 4000)) task.cursor++;
        return true;
    }
    // Consolidated home care: one visit recovers EVERY low need at once (rest +
    // eat + drink + passive heal — see updateWorkerVitals 'recovering'). Stays
    // until all needs are back to "ok" (or a safety cap), so a worker leaves home
    // topped up across the board — this bounds downtime far better than separate
    // per-need trips, which is what keeps the farm self-sustaining.
    if (step.type === 'recover') {
        npc.state = 'recovering';
        step._elapsed = (step._elapsed || 0) + dt;
        const okStam = npc.stamina  >= (step.staminaOk  != null ? step.staminaOk  : WORKER.staminaOk);
        const okEner = npc.energy   >= (step.energyOk   != null ? step.energyOk   : WORKER.energyOk);
        const okHydr = npc.hydration >= (step.hydrationOk != null ? step.hydrationOk : WORKER.hydrationOk);
        const okHlth = npc.health   >= (step.healthOk   != null ? step.healthOk   : WORKER.healthOk);
        if ((okStam && okEner && okHydr && okHlth) ||
            step._elapsed >= (step.maxMs != null ? step.maxMs : WORKER.recoverMaxMs)) {
            task.cursor++;
        }
        return true;
    }

    if (step.type === 'act') {
        npc.state = 'working';
        const fn = world.actions[step.verb];
        const res = fn ? fn.apply(null, step.args || []) : { ok: false, reason: 'no such verb: ' + step.verb };
        task.result.push({ verb: step.verb, ok: res.ok !== false });

        if (step.carry) npc.carrying = step.carry;
        if (step.drop) npc.carrying = null;

        // A unit of useful work grows the matching attribute(s).
        if (res && res.ok !== false && VERB_XP[step.verb]) {
            world.awardWork(npc, VERB_XP[step.verb]);
        }

        task.cursor++;

        // An act that returned {ok:false} makes the rest of the errand pointless
        // (e.g. trough already full, nothing to harvest). Stop cleanly instead of
        // marching through dead steps.
        if (res && res.ok === false) {
            finishTask(world, npc, task, 'aborted');
            return false;
        }

        if (step.say) world.say(npc.id, step.say);

        if (task.cursor >= task.steps.length) finishTask(world, npc, task, 'done');
        return true;
    }

    // Unknown step type — skip rather than wedge.
    task.cursor++;
    return true;
}

function finishTask(world, npc, task, status) {
    // Free the conversation floor in case the task ended mid-exchange, so a
    // worker can never leave the talking stick held and stall the whole line.
    if (world.convRelease) world.convRelease(npc.id);
    // Seeing a real job (one with a dedup target) through to completion builds
    // Endurance — the sustained-effort stat. Care errands (rest/sleep/eat carry
    // no target) and aborted tasks grant nothing.
    if (status === 'done' && task.target) {
        world.awardWork(npc, [['endurance', STAT_XP.endurance]]);
    }
    task.status = status;
    npc.task = null;
    npc.state = 'idle';
    npc.carrying = null;
    // Anchor wander to where we ended so the npc doesn't snap home.
    npc.tx = npc.x; npc.ty = npc.y;
}

// ---- task builders ----------------------------------------------------------
// Each returns a plain task object (npcId left null for the orchestrator to set).

// Walk to the well, draw water, carry it to the pen's water trough, refill.
export function buildServiceWaterTrough(world, penId) {
    const well = regionCenter('well');
    const t = world.troughs[penId + '-water'];
    return makeTask('service-water:' + penId, 'water:' + penId, [
        { type: 'move', x: well.x, y: well.y, label: 'well' },
        { type: 'wait', ms: 250 },
        { type: 'act', verb: 'drawWater', args: [140], carry: 'water' },
        { type: 'move', x: t.x, y: t.y, label: penLabel(penId) + ' water trough' },
        { type: 'wait', ms: 250 },
        { type: 'act', verb: 'refillWaterTrough', args: [penId], drop: true,
          say: penLabel(penId) + ' water topped up.' },
    ]);
}

// Walk to the barn, load feed, carry it to the pen's feed trough, refill.
export function buildServiceFeedTrough(world, penId) {
    const barn = regionCenter('barn');
    const t = world.troughs[penId + '-feed'];
    return makeTask('service-feed:' + penId, 'feed:' + penId, [
        { type: 'move', x: barn.x, y: barn.y, label: 'barn' },
        { type: 'wait', ms: 250 },
        { type: 'act', verb: 'loadFeed', args: [120], carry: 'feed' },
        { type: 'move', x: t.x, y: t.y, label: penLabel(penId) + ' feed trough' },
        { type: 'wait', ms: 250 },
        { type: 'act', verb: 'refillFeedTrough', args: [penId], drop: true,
          say: penLabel(penId) + ' feed restocked.' },
    ]);
}

export function buildHarvest(world, cropId) {
    const c = world.crops.find((x) => x.id === cropId);
    const x = c ? c.x : 0, y = c ? c.y : 0;
    const kind = c ? c.kind : 'crop';
    return makeTask('harvest:' + cropId, 'crop:' + cropId, [
        { type: 'move', x, y, label: cropId },
        { type: 'wait', ms: 250 },
        { type: 'act', verb: 'harvest', args: [cropId], carry: 'crop',
          say: 'Got the ' + kind + ' in.' },
        { type: 'wait', ms: 150 },
        // carrying cleared implicitly when the task finishes
    ]);
}

export function buildWaterCrop(world, cropId) {
    const c = world.crops.find((x) => x.id === cropId);
    const x = c ? c.x : 0, y = c ? c.y : 0;
    return makeTask('water-crop:' + cropId, 'crop:' + cropId, [
        { type: 'move', x, y, label: cropId },
        { type: 'wait', ms: 200 },
        { type: 'act', verb: 'waterCrop', args: [cropId], say: 'That ought to keep it green.' },
    ]);
}

export function buildPlant(world, plotIndex, kind = 'wheat') {
    const c = world.crops.find((x) => x.plotIndex === plotIndex);
    const x = c ? c.x : 0, y = c ? c.y : 0;
    return makeTask('plant:' + plotIndex, 'plot:' + plotIndex, [
        { type: 'move', x, y, label: 'plot ' + plotIndex },
        { type: 'wait', ms: 250 },
        { type: 'act', verb: 'plant', args: [plotIndex, kind], say: kind + ' is in the ground.' },
    ]);
}

// ---- worker-care task builders (Pass D) -------------------------------------
// All head to the farmhouse; the differing final step recovers stamina/energy.
export function buildRest(world) {
    const h = regionCenter('farmhouse');
    return makeTask('rest', null, [
        { type: 'move', x: h.x, y: h.y, label: 'farmhouse' },
        { type: 'rest' },
    ]);
}
export function buildSleep(world) {
    const h = regionCenter('farmhouse');
    return makeTask('sleep', null, [
        { type: 'move', x: h.x, y: h.y, label: 'farmhouse' },
        { type: 'sleep' },
    ]);
}
export function buildEat(world) {
    const h = regionCenter('farmhouse');
    return makeTask('eat', null, [
        { type: 'move', x: h.x, y: h.y, label: 'farmhouse' },
        { type: 'wait', ms: 150 },
        { type: 'eat', ms: 4000 },
    ]);
}
// Consolidated care: go HOME and recover every low need in one visit (stamina,
// energy, hydration AND health). Thematically "the worker goes home to recover."
// Supersedes per-need rest/eat/drink trips so worker downtime stays bounded — the
// single biggest lever on keeping the farm self-sustaining once needs multiply.
export function buildRecover(world, opts = {}) {
    const h = regionCenter('farmhouse');
    return makeTask('recover', null, [
        { type: 'move', x: h.x, y: h.y, label: 'farmhouse' },
        { type: 'recover',
          staminaOk:   opts.staminaOk,
          energyOk:    opts.energyOk,
          hydrationOk: opts.hydrationOk,
          healthOk:    opts.healthOk,
          maxMs:       opts.maxMs },
    ]);
}

// Walk to a sick animal and tend it back to health.
export function buildTend(world, animalId) {
    const a = world.animals.find((x) => x.id === animalId);
    const x = a ? a.x : 0, y = a ? a.y : 0;
    return makeTask('tend:' + animalId, 'tend:' + animalId, [
        { type: 'move', x, y, label: animalId },
        { type: 'wait', ms: 300 },
        { type: 'act', verb: 'tendAnimal', args: [animalId], carry: 'medkit',
          say: 'Easy now — you\'ll be alright.' },
        { type: 'wait', ms: 150 },
    ]);
}

export function buildCollectProduce(world, penId) {
    const pen = world.pens[penId];
    // Collect at the pen's feed trough (a sensible "gather point" inside the pen).
    const t = pen ? pen.feedTrough : { x: 0, y: 0 };
    const goodLabel = (pen && pen.goodLabel) || 'produce';
    return makeTask('collect:' + penId, 'collect:' + penId, [
        { type: 'move', x: t.x, y: t.y, label: penLabel(penId) },
        { type: 'wait', ms: 200 },
        { type: 'act', verb: 'collectProduce', args: [penId], carry: 'crate',
          say: goodLabel + ' collected.' },
        { type: 'wait', ms: 150 },
    ]);
}

// ---- briefing protocol ------------------------------------------------------
// Turn an instant job assignment into a physical briefing: the worker walks to
// the embodied Foreman, HEARS the spoken order in full, replies, waits out their
// own reply, and only THEN runs the job's own steps. Prepends three steps to an
// already-built job task (preserving task.target so the orchestrator's in-flight
// dedup keeps working). Steps stay plain serializable data — a future LLM can
// emit this same shape directly.
//
//   1. move to the Foreman's post
//   2. Foreman speaks the order   (worker stands and listens, gated on duration)
//   3. worker speaks the ack      (worker waits out their own reply)
export function prependBriefing(task, opts) {
    const { foremanId, foremanPos, order, npcId, ack } = opts || {};
    const pre = [
        { type: 'move', x: foremanPos.x, y: foremanPos.y, label: 'foreman' },
    ];
    if (order) pre.push({ type: 'say', speaker: foremanId, text: order });
    if (ack)   pre.push({ type: 'say', speaker: npcId, text: ack });
    task.steps = pre.concat(task.steps);
    return task;
}

export { CROP_KINDS };
