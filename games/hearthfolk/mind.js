// Tier 1, the mind: a language model (or a test's fake) reads a situation
// digest and answers with one strict JSON object that steers a villager for a
// while. Anything that is not exactly that object is discarded, never
// repaired, and tier 0 (the utility AI in sim.js) carries on regardless.
//
// installMind(game, { cellOf, spotFor, addEvent }) adds buildThink,
// applyThink, pickNextThinker, activeGenerate and requestThink to `game`
// and returns stepMind(dt) for the sim's update.

import {
    MAP_W, MAP_H, FLAG, MEMORY_CAP, OVERRIDE_DUR, THINK_INTERVAL,
} from "/app/defs.js";

const ACTIONS = ['work', 'eat', 'rest', 'socialize', 'idle'];

// Extract the single JSON object from raw model output: drop any
// <think>...</think> block, then take first '{' .. last '}'.
function extractJson(raw) {
    if (typeof raw !== 'string') return null;
    const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '');
    const a = cleaned.indexOf('{');
    const b = cleaned.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    return cleaned.slice(a, b + 1);
}

const optString = (o, k, max) => !(k in o) || o[k] === undefined ||
    (typeof o[k] === 'string' && o[k].length <= max);

function validateThink(o, world) {
    if (o === null || typeof o !== 'object' || Array.isArray(o)) return false;
    if ('say' in o && o.say !== undefined &&
        (typeof o.say !== 'string' || !o.say.trim() || o.say.length > 200)) return false;
    if ('goto' in o && o.goto !== undefined) {
        const g = o.goto;
        if (g === null || typeof g !== 'object' || Array.isArray(g)) return false;
        if (!Number.isInteger(g.x) || !Number.isInteger(g.y)) return false;
        if (g.x < 0 || g.y < 0 || g.x >= MAP_W || g.y >= MAP_H) return false;
        if (!world.isWalkable(g.x, g.y, FLAG.WATER)) return false;
    }
    if ('action' in o && o.action !== undefined &&
        (typeof o.action !== 'string' || !ACTIONS.includes(o.action))) return false;
    return optString(o, 'goal', 200) && optString(o, 'remember', 200);
}

function roleWorkText(game, v) {
    switch (v.role) {
        case 'farmer': return 'tending and harvesting the grain field around 18,25';
        case 'forester': return 'felling trees in the western forest around 10,11';
        case 'mason': return 'cutting stone at the quarry at ' + game.quarry.x + ',' + game.quarry.y;
        case 'cook': return 'cooking meals at the hearth kitchen at ' + game.kitchen.x + ',' + game.kitchen.y;
        case 'elder': return 'keeping the hearth fire alive from the bench at ' + game.bench.x + ',' + game.bench.y;
    }
    return 'odd jobs';
}

export function installMind(game, { cellOf, spotFor, addEvent }) {
    const world = game.world;
    const near = (a, b, r) => {
        const ca = cellOf(a), cb = cellOf(b);
        return world.cellDistance(ca.x, ca.y, cb.x, cb.y) <= r;
    };

    /** The prompt for one villager: { system, user, text }. */
    game.buildThink = function (v) {
        const c = cellOf(v);
        const pct = (n) => Math.round(n * 100);
        const nearby = game.villagers
            .filter((o) => o !== v && near(v, o, 6))
            .map((o) => o.name + ' the ' + o.role + ' (' + o.activity + ', ' +
                cellOf(o).x + ',' + cellOf(o).y + ')');
        const recent = game.chronicle.slice(-5).map((e) => e.text);
        const mems = v.memories.slice(-8);
        const system =
            'You are the mind of ' + v.name + ', a ' + v.temperament + ' ' + v.role +
            ' in the tiny village of Hearthfolk. You decide what ' + v.name +
            ' does next. Respond with EXACTLY one JSON object on a single line and nothing else. Fields (all optional): ' +
            '"say" (a short spoken line, under 90 chars), ' +
            '"goto" ({"x":int,"y":int} a map cell to walk to; the map is ' + MAP_W + 'x' + MAP_H +
            ', the hearth is at ' + game.hearth.x + ',' + game.hearth.y + '), ' +
            '"action" (one of "work","eat","rest","socialize","idle"), ' +
            '"goal" (a short private intention), ' +
            '"remember" (a short note to keep). No prose, no markdown, JSON only.';
        const lines = [
            'Day ' + game.day() + ', ' + game.phaseName() + '.',
            'You are at ' + c.x + ',' + c.y + ', currently ' + v.activity + '. Goal: ' + v.goal + '.',
            'Needs (0 fine, 100 desperate): hunger ' + pct(v.needs.hunger) +
                ', tiredness ' + pct(v.needs.energy) + ', loneliness ' + pct(v.needs.social) +
                ', cold ' + pct(v.needs.warmth) + '.',
            'Village stores: food ' + game.res.food + ', wood ' + game.res.wood +
                ', stone ' + game.res.stone + ', meals ' + game.res.meals + '. Hearth fire ' +
                Math.round(game.fire * 100) + '%.',
            'Your home is at ' + v.home.x + ',' + v.home.y + '. Your work: ' + roleWorkText(game, v) + '.',
            nearby.length ? 'Nearby: ' + nearby.join('; ') + '.' : 'Nobody is nearby.',
            recent.length ? 'Recent village events: ' + recent.join(' | ') : '',
            mems.length ? 'Your memories: ' + mems.join(' | ') : '',
        ];
        if (v.heard) lines.push(v.heard.from + ' just said to you: “' + v.heard.text + '”');
        lines.push('What do you do? One JSON object only. /no_think');
        const user = lines.filter(Boolean).join('\n');
        return { system, user, text: system + '\n\n' + user };
    };

    /** Apply one raw model answer to `v`. Returns true when accepted. */
    game.applyThink = function (v, raw) {
        const slice = extractJson(raw);
        let parsed = null;
        if (slice !== null) {
            try { parsed = JSON.parse(slice); } catch (e) { parsed = null; }
        }
        const ok = parsed !== null && validateThink(parsed, world);
        v.lastThink = { raw, parsed: ok ? parsed : null, discarded: !ok, t: game.time };
        v.lastThinkT = game.time;   // rotate the queue even on a discard
        v.heard = null;
        if (!ok) { game.mind.discarded++; return false; }
        game.mind.accepted++;

        if (typeof parsed.goal === 'string' && parsed.goal.trim()) v.goal = parsed.goal.trim();
        if (typeof parsed.remember === 'string' && parsed.remember.trim()) {
            v.memories.push(parsed.remember.trim());
            while (v.memories.length > MEMORY_CAP) v.memories.shift();
        }
        if (typeof parsed.say === 'string' && parsed.say.trim()) game.speak(v, parsed.say.trim());

        const action = parsed.action || (parsed.goto ? 'idle' : null);
        if (action || parsed.goto) {
            const target = parsed.goto ? { x: parsed.goto.x, y: parsed.goto.y } : spotFor(v, action);
            v.override = { until: game.time + OVERRIDE_DUR, action: action || 'idle', target };
            v.target = null;         // force re-path toward the new target
            v.plannedAct = null;
            addEvent(v.name + ' resolves: ' + (v.goal || action || 'a new intention'), 'think');
        } else {
            addEvent(v.name + ' reflects quietly', 'think');
        }
        return true;
    };

    // Who thinks next: villagers who just heard a line take priority (real
    // back-and-forth conversation), else the one who has waited longest.
    game.pickNextThinker = function () {
        let best = null, bestKey = Infinity;
        for (const v of game.villagers) {
            const heardBoost = (v.heard && v.heard.t >= v.lastThinkT) ? -1e6 : 0;
            const key = heardBoost + v.lastThinkT;
            if (key < bestKey) { bestKey = key; best = v; }
        }
        return best;
    };

    // The generator in force: a test-injected fake takes precedence over the
    // app-installed model-backed one.
    game.activeGenerate = function () {
        if (typeof globalThis.__hearthmindGenerate === 'function') return globalThis.__hearthmindGenerate;
        return game.mind.generate;
    };

    // One think, serially: build the digest, run the generator, apply. Only
    // ever ONE generate in flight.
    game.requestThink = function (v) {
        const gen = game.activeGenerate();
        if (!gen || game.mind.inFlight) return Promise.resolve(false);
        game.mind.inFlight = true;
        const parts = game.buildThink(v);
        game.mind.lastPrompt = parts.text;
        let p;
        try {
            p = Promise.resolve(gen(parts.text, parts));
        } catch (e) {
            game.mind.inFlight = false;
            game.mind.discarded++;
            return Promise.resolve(false);
        }
        return p.then(
            (raw) => { game.mind.inFlight = false; return game.applyThink(v, raw); },
            (err) => {
                game.mind.inFlight = false;
                game.mind.discarded++;
                v.lastThink = { raw: String(err), parsed: null, discarded: true, t: game.time };
                return false;
            });
    };

    return function stepMind(dt) {
        if (!game.activeGenerate() || game.mind.inFlight) return;
        game.mind.thinkT += dt;
        if (game.mind.thinkT < THINK_INTERVAL) return;
        game.mind.thinkT = 0;
        const v = game.pickNextThinker();
        if (v) game.requestThink(v);
    };
}
