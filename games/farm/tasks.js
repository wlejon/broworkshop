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
    REGIONS, PENS, STATIONS, CROP_KINDS, WORKER,
    moveSpeedMul, proficiencyMul, STAT_XP,
} from './defs.js';

const WALK = 3.2;     // tiles / second when executing a task (brisker than wander)
const ARRIVE = 0.28;  // tiles — "close enough" to count a move step done

// Briefing queue geometry: the line forms south of the Foreman (+y, the open
// yard), the head worker standing FRONT_GAP in front of him and each further
// place QUEUE_SPACING behind the last.
const FRONT_GAP = 1.5;
const QUEUE_SPACING = 1.4;

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
    muckOut:           [['husbandry', STAT_XP.husbandry * 0.8], ['strength', STAT_XP.strength * 0.6]],
    plant:             [['farming', STAT_XP.farming]],
    waterCrop:         [['farming', STAT_XP.farming]],
    harvest:           [['farming', STAT_XP.farming]],
    weedPlot:          [['farming', STAT_XP.farming * 0.8]],
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

        // Resolve a route around obstacles once, on first entry to this step.
        // world.pathfind (injected by the app from the nav grid) returns
        // waypoints from the worker to the target; absent or unroutable -> a
        // null route and we walk straight at the target, so movement can never
        // wedge. We then consume the route waypoint by waypoint.
        if (step._route === undefined) {
            step._route = null;
            if (world.pathfind) {
                const pts = world.pathfind(npc.x, npc.y, step.x, step.y);
                if (pts && pts.length) { step._route = pts; step._leg = 0; }
            }
        }

        // Current leg goal: the active waypoint, or the step target if no route.
        let gx = step.x, gy = step.y, lastLeg = true;
        if (step._route) {
            const wp = step._route[step._leg];
            if (wp) { gx = wp.x; gy = wp.y; }
            lastLeg = step._leg >= step._route.length - 1;
        }

        const dx = gx - npc.x, dy = gy - npc.y;
        const d = Math.hypot(dx, dy);
        if (d <= ARRIVE) {
            npc.x = gx; npc.y = gy;
            if (!lastLeg) step._leg++;          // advance to the next waypoint
            else { npc.x = step.x; npc.y = step.y; task.cursor++; }  // arrived
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
        // Per-speaker serialized speech: enqueue the line on the SPEAKER'S own
        // channel (world.say) and hold the worker until that channel has fully
        // delivered it (handle.done) — the real Kokoro length when voiced, a text
        // estimate when silent. Because the Foreman is one individual, two
        // workers briefed at once simply queue behind his single voice and are
        // addressed in turn; meanwhile a worker's reply (its OWN channel) may
        // overlap other workers' chatter, which is fine — different people, one
        // mouth each. So the word stays tied to the action without forcing the
        // whole farm to fall silent for every exchange.
        npc.state = (step.speaker === npc.id) ? 'talking' : 'listening';
        if (!step._started) {
            step._started = true;
            step._waitMs = 0;
            step._handle = null;
            try { step._handle = world.say(step.speaker, step.text, { priority: true }); } catch (e) { step._handle = null; }
        }
        step._waitMs += dt;
        let done = false;
        if (!step._handle) done = true;               // nothing to say
        else if (step._handle.done) done = true;      // channel delivered it
        else if (step._waitMs >= 20000) done = true;  // backstop; channel sets done well before
        if (done) task.cursor++;
        return true;
    }

    // ---- queued briefing: line up, wait your turn, then be addressed ----------
    // { type:'briefLine', foremanId, fx, fy, order, ack } — the worker joins the
    // shared world.briefing.line, walks to its numbered place in the queue, and
    // holds. Only the worker at the HEAD (index 0) is briefed, and only once it
    // has actually reached the front spot — so the Foreman naturally waits for the
    // next person to approach before speaking. The head hears the order in full,
    // replies (waiting out its own ack), then leaves the line; everyone behind
    // advances one place and walks forward. One worker addressed at a time, no
    // crowd. Self-coordinating across independent task runners via the shared line.
    if (step.type === 'briefLine') {
        if (!world.briefing) world.briefing = { line: [] };
        const line = world.briefing.line;
        if (!step._joined) { step._joined = true; if (!line.includes(npc.id)) line.push(npc.id); }

        const i = line.indexOf(npc.id);
        const place = i < 0 ? 0 : i;                       // my slot from the front
        const gx = step.fx;
        const gy = step.fy + FRONT_GAP + place * QUEUE_SPACING;
        const dx = gx - npc.x, dy = gy - npc.y, d = Math.hypot(dx, dy);

        if (d > ARRIVE) {                                  // still walking to my place
            npc.state = 'walking';
            npc.tx = gx; npc.ty = gy;
            const sp = Math.min(WALK * walkMul * s, d);
            npc.x += (dx / d) * sp; npc.y += (dy / d) * sp;
            world.awardWork(npc, [['agility', sp * STAT_XP.agility]]);
            return true;
        }
        npc.x = gx; npc.y = gy;

        if (place > 0) { npc.state = 'listening'; return true; }   // not my turn yet

        // I'm at the front and have arrived — run the exchange.
        if (step._phase !== 'ack') {
            npc.state = 'listening';
            if (!step._orderStarted) {
                step._orderStarted = true; step._orderMs = 0;
                try { step._orderHandle = step.order ? world.say(step.foremanId, step.order, { priority: true }) : null; }
                catch (e) { step._orderHandle = null; }
            }
            step._orderMs += dt;
            const orderDone = !step._orderHandle || step._orderHandle.done || step._orderMs >= 20000;
            if (orderDone) step._phase = 'ack';
            return true;
        }

        npc.state = 'talking';
        if (!step._ackStarted) {
            step._ackStarted = true; step._ackMs = 0;
            try { step._ackHandle = step.ack ? world.say(npc.id, step.ack, { priority: true }) : null; }
            catch (e) { step._ackHandle = null; }
        }
        step._ackMs += dt;
        const ackDone = !step._ackHandle || step._ackHandle.done || step._ackMs >= 20000;
        if (ackDone) {
            const idx = line.indexOf(npc.id);
            if (idx >= 0) line.splice(idx, 1);             // leave; line behind advances
            task.cursor++;
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

        // A worker doesn't narrate each act as it happens — it REMEMBERS the deed
        // and recaps the day to the Foreman at dusk (world.deliverReport).
        if (step.say) world.report(npc.id, step.say);

        if (task.cursor >= task.steps.length) finishTask(world, npc, task, 'done');
        return true;
    }

    // Unknown step type — skip rather than wedge.
    task.cursor++;
    return true;
}

function finishTask(world, npc, task, status) {
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
    // Never leave a stranded id holding up the briefing line.
    if (world.briefing && world.briefing.line) {
        const bi = world.briefing.line.indexOf(npc.id);
        if (bi >= 0) world.briefing.line.splice(bi, 1);
    }
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

// Muck out a pen: walk into it and restore its cleanliness. A station-owner's
// recurring animal chore — a clean pen keeps illness down.
export function buildMuckOut(world, penId) {
    const r = REGIONS.find((x) => x.penId === penId);
    const x = r ? (r.x0 + r.x1) / 2 : 0, y = r ? (r.y0 + r.y1) / 2 : 0;
    return makeTask('muck:' + penId, 'muck:' + penId, [
        { type: 'move', x, y, label: penLabel(penId) },
        { type: 'wait', ms: 350 },
        { type: 'act', verb: 'muckOut', args: [penId],
          say: 'Got the ' + penLabel(penId).toLowerCase() + ' cleaned up.' },
    ]);
}

// Pull the weeds on a planted plot. The gardener's recurring crop chore.
export function buildWeed(world, cropId) {
    const c = world.crops.find((x) => x.id === cropId);
    const x = c ? c.x : 0, y = c ? c.y : 0;
    return makeTask('weed:' + cropId, 'crop:' + cropId, [
        { type: 'move', x, y, label: cropId },
        { type: 'wait', ms: 200 },
        { type: 'act', verb: 'weedPlot', args: [cropId], say: 'Cleared the weeds out.' },
    ]);
}

// Walk into a station's work-area to SEE (first-hand) what it currently needs.
// Dispatched when a worker has nothing it KNOWS to do and isn't already near the
// station: walking there refreshes its belief (senseInto, every step within
// sight), so the next decision can pull real chores. Carries no dedup target —
// it's pure information-gathering, not a unit of work.
export function buildAssessStation(world, stationId) {
    const st = STATIONS.find((s) => s.id === stationId);
    const c = st ? regionCenter(st.region) : { x: 0, y: 0 };
    return makeTask('assess:' + stationId, null, [
        { type: 'move', x: c.x, y: c.y, label: (st && st.label) || stationId },
        { type: 'wait', ms: 200 },
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
          say: 'Nursed a sick animal back to health.' },
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
// Turn an instant job assignment into a physical briefing where workers QUEUE
// at the Foreman rather than crowd him: each joins a single-file line, waits its
// turn, steps to the front when the worker ahead leaves, HEARS the order, replies,
// and only THEN departs for the job. The whole exchange is one `briefLine` step
// (state machine in advanceTask) so the coordination — who's at the front, the
// Foreman waiting for the next worker to actually arrive — lives in one place.
// Prepended ahead of the job's own steps; task.target is preserved so the
// orchestrator's in-flight dedup keeps working. Plain serializable data — a
// future LLM can emit this same shape directly.
export function prependBriefing(task, opts) {
    const { foremanId, foremanPos, order, npcId, ack } = opts || {};
    const step = {
        type: 'briefLine', foremanId, npcId,
        fx: foremanPos.x, fy: foremanPos.y, order, ack,
    };
    task.steps = [step].concat(task.steps);
    return task;
}

export { CROP_KINDS };
