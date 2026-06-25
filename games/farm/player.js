// player.js — the human-controlled farmer avatar.
//
// The player is a first-class actor in the SAME world the NPCs inhabit: it
// owns a tile position, and every action it takes is routed through the very
// same world.actions verbs the orchestrator and NPC tasks use. It never pokes
// world state directly. Because all three (player, orchestrator, NPCs) mutate
// one shared world, a need the player resolves simply vanishes from observe()
// and the orchestrator naturally moves on — no parallel mutation path.
//
// Cooperation with the orchestrator: each frame we recompute the single best
// interactable in reach and stash its dedup `target` on world.player.targetHint.
// orchestrator.decide() folds that into its in-flight set, so it won't dispatch
// an NPC to the very thing the player is standing over. Walk away and the hint
// clears, and the farm self-heals as before.

import { REGIONS, GRID } from './defs.js';

const PLAYER_SPEED   = 4.6;  // tiles / second — a touch brisker than NPC walk
const INTERACT_RANGE = 2.4;  // tiles — how close counts as "standing next to"
const FULL = 99.5;           // treat >= this as "no room / already done"

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function regionCenter(id) {
    const r = REGIONS.find((x) => x.id === id);
    if (!r) return { x: 0, y: 0 };
    return { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 };
}

function penRegionId(penId) { return penId; } // region id == penId for pens

// Create world.player and return it. Spawn between the fields and the pens.
export function initPlayer(world, x = 22, y = 14) {
    world.player = {
        x, y,
        facing: { x: 0, y: 1 },
        targetHint: null,   // dedup key the orchestrator skips while we're on it
        highlight: null,    // { x, y, label } of the in-reach interactable (render)
        moving: false,
    };
    return world.player;
}

// Move the avatar. dx/dy are raw input axes (-1..1); zero is allowed (we still
// refresh the interaction hint every frame so the highlight tracks position).
export function movePlayer(world, dt, dx, dy) {
    const p = world.player;
    if (!p) return;
    p.moving = false;
    if (dx || dy) {
        const d = Math.hypot(dx, dy) || 1;
        const ux = dx / d, uy = dy / d;
        const s = PLAYER_SPEED * (dt / 1000);
        p.x = clamp(p.x + ux * s, 0.4, GRID.cols - 0.4);
        p.y = clamp(p.y + uy * s, 0.4, GRID.rows - 0.4);
        p.facing = { x: ux, y: uy };
        p.moving = true;
    }
    const best = resolveInteract(world);
    p.targetHint = best ? best.target : null;
    p.highlight  = best ? { x: best.x, y: best.y, label: best.label } : null;
}

// Build the list of MEANINGFUL interactions near a position. "Meaningful" is
// the context filter: a full trough, an empty pen, a fully-grown-but-handled
// crop emit no candidate, so the nearest remaining one is always something
// worth doing.
function candidates(world) {
    const out = [];

    // Pen troughs: only when there's room to add.
    for (const id of Object.keys(world.troughs)) {
        const t = world.troughs[id];
        if (t.fill >= FULL) continue;
        if (t.kind === 'water') {
            out.push({
                x: t.x, y: t.y, target: 'water:' + t.penId, sfx: 'splash',
                label: 'Fill water trough',
                run: () => world.actions.refillWaterTrough(t.penId),
                say: 'Topped up the ' + t.penId + ' water.',
            });
        } else {
            out.push({
                x: t.x, y: t.y, target: 'feed:' + t.penId, sfx: 'feed',
                label: 'Fill feed trough',
                run: () => world.actions.refillFeedTrough(t.penId),
                say: 'Filled the ' + t.penId + ' feed.',
            });
        }
    }

    // Crops: ripe -> harvest, empty -> plant, planted & drying -> water.
    for (const c of world.crops) {
        if (c.stage === 'ripe') {
            out.push({
                x: c.x, y: c.y, target: 'crop:' + c.id, sfx: 'harvest',
                label: 'Harvest ' + (c.kind || 'crop'),
                run: () => world.actions.harvest(c.id),
                say: 'Harvested the ' + (c.kind || 'crop') + '.',
            });
        } else if (c.stage === 'empty') {
            out.push({
                x: c.x, y: c.y, target: 'plot:' + c.plotIndex, sfx: 'plant',
                label: 'Plant wheat',
                run: () => world.actions.plant(c.plotIndex, 'wheat'),
                say: 'Planted some wheat.',
            });
        } else if (c.moisture < 80) {
            out.push({
                x: c.x, y: c.y, target: 'crop:' + c.id, sfx: 'splash',
                label: 'Water ' + (c.kind || 'crop'),
                run: () => world.actions.waterCrop(c.id),
                say: 'Watered the ' + (c.kind || 'crop') + '.',
            });
        }
    }

    // Pens with pending produce: gather at the pen's center.
    for (const penId of Object.keys(world.pens)) {
        const pen = world.pens[penId];
        if (pen.pending <= 0) continue;
        const ctr = regionCenter(penRegionId(penId));
        out.push({
            x: ctr.x, y: ctr.y, target: 'collect:' + penId, sfx: 'pickup',
            label: 'Collect ' + (pen.goodLabel || 'produce'),
            run: () => world.actions.collectProduce(penId),
            say: 'Collected the ' + (pen.goodLabel || 'produce').toLowerCase() + '.',
        });
    }

    // Silo / market -> sell all produce on hand (only when there's something).
    const inv = world.resources;
    if ((inv.eggs + inv.milk + inv.wool + inv.crops) > 0) {
        const silo = regionCenter('silo');
        out.push({
            x: silo.x, y: silo.y, target: null, sfx: 'pickup',
            label: 'Sell produce at market',
            run: () => sellAll(world),
            say: null,   // sellAll speaks its own (dynamic) line
        });
    }

    // Well -> draw water into the pool. Barn -> load feed into the pool. These
    // are resupply, not pen-jobs, so they carry no orchestrator dedup target.
    const well = regionCenter('well');
    out.push({
        x: well.x, y: well.y, target: null, sfx: 'splash',
        label: 'Draw water',
        run: () => world.actions.drawWater(60),
        say: 'Drew water from the well.',
    });
    const barn = regionCenter('barn');
    out.push({
        x: barn.x, y: barn.y, target: null, sfx: 'feed',
        label: 'Load feed',
        run: () => world.actions.loadFeed(60),
        say: 'Loaded feed from the barn.',
    });

    return out;
}

// The single best interaction the player can do right now, or null. Picks the
// nearest candidate within reach.
export function resolveInteract(world) {
    const p = world.player;
    if (!p) return null;
    let best = null, bestD = INTERACT_RANGE;
    for (const cand of candidates(world)) {
        const d = Math.hypot(cand.x - p.x, cand.y - p.y);
        if (d <= bestD) { best = cand; bestD = d; }
    }
    return best;
}

// Run the best in-reach interaction. Returns a small result for the caller to
// turn into SFX feedback. Speaks a 'You' line through the shared dialog channel
// so the player reads as just another actor in the feed.
export function runInteract(world) {
    const best = resolveInteract(world);
    if (!best) return { ok: false, none: true };
    const res = best.run();
    if (res && res.ok === false) {
        return { ok: false, sfx: best.sfx, label: best.label, reason: res.reason };
    }
    if (best.say) world.say('You', best.say);   // null when run() spoke its own line
    return { ok: true, sfx: best.sfx, label: best.label };
}

// Sell every unit of produce the farm holds at current market prices.
function sellAll(world) {
    let total = 0, gold = 0;
    for (const g of ['eggs', 'milk', 'wool', 'crops']) {
        const r = world.actions.sell(g);
        if (r.ok) { total += r.sold; gold += r.gold; }
    }
    if (total <= 0) return { ok: false, reason: 'nothing to sell' };
    world.say('You', `Sold ${total} goods at market for ${gold}g.`);
    return { ok: true, total, gold };
}

// Buy feed into the barn (the 'market' key). Returns the action result so the
// caller can pick a success/fail SFX.
export function buyFeed(world, units = 200) {
    const r = world.actions.buy('feed', units);
    if (r.ok) world.say('You', `Bought ${r.bought} feed for ${r.cost}g.`);
    return r;
}
