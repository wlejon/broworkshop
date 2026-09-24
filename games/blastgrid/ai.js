// ai.js — BlastGrid's rival bombers: flee danger, bomb crates and rivals
// when an escape exists, chase power-ups, otherwise hunt or wander.
// Plans are paths over the TileWorld (findPath / distanceField); movement
// follows them one cell at a time through nextStep().

import {
    MAP_W, MAP_H, FUSE, FLAG_SOFT, FLAG_BOMB, MOVE_MASK, SAFE_MASK,
} from "/app/rules.js";

const AI_REACT = 0.24;           // seconds before an AI responds to new danger
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * `game` is the sim object; `random()` is the sim's current seeded stream
 * (it is reseeded per round, so read it through the function).
 */
export function createAI(game, random) {
    const world = game.world;
    const idx = (x, y) => y * MAP_W + x;
    const inBounds = (x, y) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;

    function fresh() {
        return {
            path: [], fleeing: false, replanNow: false, replanTimer: 0,
            bombCd: 1.2 + random() * 1.2, react: 0, dangerVer: -1,
        };
    }

    function adjacentSoftCount(x, y) {
        let n = 0;
        for (const [dx, dy] of DIRS)
            if (inBounds(x + dx, y + dy) && world.hasFlag(x + dx, y + dy, FLAG_SOFT)) n++;
        return n;
    }

    // Run fn with the entity's own cell un-bombed, so an AI standing on its
    // own fresh bomb still sees escape routes (the source cell would
    // otherwise be impassable and everything unreachable).
    function offOwnBomb(e, fn) {
        const onBomb = world.hasFlag(e.cx, e.cy, FLAG_BOMB);
        if (onBomb) world.setFlag(e.cx, e.cy, FLAG_BOMB, false);
        try { return fn(); }
        finally { if (onBomb) world.setFlag(e.cx, e.cy, FLAG_BOMB, true); }
    }

    const fieldFrom = (e, mask) =>
        offOwnBomb(e, () => world.distanceField([{ x: e.cx, y: e.cy }], { blockMask: mask }));

    function pathTo(e, x, y, mask) {
        const p = offOwnBomb(e, () => world.findPath(e.cx, e.cy, x, y, { blockMask: mask }));
        if (p && p.length && p[0].x === e.cx && p[0].y === e.cy) p.shift();
        return p || [];
    }

    function flee(e) {
        const field = fieldFrom(e, MOVE_MASK);
        let best = -1, bx = -1, by = -1;
        for (let k = 0; k < field.length; k++) {
            const d = field[k];
            if (d < 0 || d > 14 || game.dangerSet.has(k)) continue;
            const score = d + random() * 0.25;
            if (best < 0 || score < best) { best = score; bx = k % MAP_W; by = (k / MAP_W) | 0; }
        }
        if (bx < 0) { e.ai.path = []; return; }             // boxed in: doomed
        // Prefer a route that stays out of OTHER danger; fall back to raw.
        let p = pathTo(e, bx, by, SAFE_MASK);
        if (!p.length) p = pathTo(e, bx, by, MOVE_MASK);
        e.ai.path = p;
        e.ai.fleeing = true;
    }

    function canEscapeAfterBomb(e) {
        const blast = new Set(game.blastCells(e.cx, e.cy, e.range).cells.map((c) => idx(c.x, c.y)));
        const field = fieldFrom(e, MOVE_MASK);
        const maxSteps = Math.max(3, Math.floor(e.speed * FUSE) - 1);
        for (let k = 0; k < field.length; k++) {
            const d = field[k];
            if (d >= 0 && d <= maxSteps && !blast.has(k) && !game.dangerSet.has(k)) return true;
        }
        return false;
    }

    function shouldBomb(e) {
        if (adjacentSoftCount(e.cx, e.cy) > 0) return true;
        for (const o of game.contenders) {
            if (o === e || !o.alive) continue;
            if (Math.abs(o.cx - e.cx) + Math.abs(o.cy - e.cy) <= 2) return true;
            // A rival on the same open row/column within blast reach.
            if ((o.cx === e.cx || o.cy === e.cy) &&
                game.blastCells(e.cx, e.cy, e.range).cells.some((c) => c.x === o.cx && c.y === o.cy)) return true;
        }
        return false;
    }

    function softRemaining() {
        let n = 0;
        for (let y = 1; y < MAP_H - 1; y++)
            for (let x = 1; x < MAP_W - 1; x++)
                if (world.hasFlag(x, y, FLAG_SOFT)) n++;
        return n;
    }

    function goal(e) {
        const field = fieldFrom(e, SAFE_MASK);
        // 1. nearest reachable power-up
        let pu = null, puD = 1e9;
        for (const p of game.powerups) {
            const d = field[idx(p.x, p.y)];
            if (d >= 0 && d < puD) { puD = d; pu = p; }
        }
        if (pu && puD <= 12) { e.ai.path = pathTo(e, pu.x, pu.y, SAFE_MASK); return; }
        // 2. approach a cell next to a crate or (sometimes) next to a living
        //    rival: that is where bombs get dropped. The fewer crates remain,
        //    the more the AI hunts.
        const hunt = random() < 0.25 + 0.55 * (1 - Math.min(1, softRemaining() / 50));
        let bx = -1, by = -1, best = 1e9;
        for (let k = 0; k < field.length; k++) {
            const d = field[k];
            if (d <= 0 || d > 18) continue;
            const x = k % MAP_W, y = (k / MAP_W) | 0;
            let want = adjacentSoftCount(x, y) > 0;
            if (!want && hunt) {
                want = game.contenders.some((o) =>
                    o !== e && o.alive && Math.abs(o.cx - x) + Math.abs(o.cy - y) === 1);
            }
            if (!want) continue;
            const score = d + random() * 2.5;
            if (score < best) { best = score; bx = x; by = y; }
        }
        if (bx >= 0) { e.ai.path = pathTo(e, bx, by, SAFE_MASK); return; }
        // 3. wander anywhere safe nearby
        let wx = -1, wy = -1, wBest = 1e9;
        for (let k = 0; k < field.length; k++) {
            const d = field[k];
            if (d <= 0 || d > 6) continue;
            const score = random() * 10 - d;
            if (score < wBest) { wBest = score; wx = k % MAP_W; wy = (k / MAP_W) | 0; }
        }
        e.ai.path = wx >= 0 ? pathTo(e, wx, wy, SAFE_MASK) : [];
    }

    function plan(e) {
        const ai = e.ai;
        ai.replanNow = false;
        ai.fleeing = false;
        ai.replanTimer = 0.5 + random() * 0.4;
        if (game.dangerSet.has(idx(e.cx, e.cy))) { flee(e); return; }
        if (ai.bombCd <= 0 && shouldBomb(e) && canEscapeAfterBomb(e) && game.placeBomb(e)) {
            ai.bombCd = 1.5 + random() * 1.3;
            flee(e);                          // danger now includes the own bomb
            return;
        }
        goal(e);
    }

    /** Per-frame thinking: react to danger changes, replan when due. */
    function think(e, dt) {
        const ai = e.ai;
        ai.bombCd = Math.max(0, ai.bombCd - dt);
        ai.replanTimer -= dt;
        if (ai.dangerVer !== game.dangerVersion) {
            ai.dangerVer = game.dangerVersion;
            ai.replanNow = true;
            // Human-ish hesitation before reacting to danger that isn't ours.
            if (game.dangerSet.has(idx(e.cx, e.cy)) && !ai.fleeing) ai.react = AI_REACT;
        }
        if (ai.react > 0) { ai.react -= dt; if (ai.react > 0) return; }
        if (!e.moving && (ai.replanNow || !ai.path.length || ai.replanTimer <= 0)) plan(e);
    }

    /** The next step [dx, dy] along the plan, or null (forces a replan). */
    function nextStep(e) {
        const p = e.ai.path;
        while (p.length && p[0].x === e.cx && p[0].y === e.cy) p.shift();
        if (!p.length) return null;
        const n = p[0];
        const replan = () => { p.length = 0; e.ai.replanNow = true; return null; };
        if (Math.abs(n.x - e.cx) + Math.abs(n.y - e.cy) !== 1 || !game.canEnter(n.x, n.y)) return replan();
        // Never walk INTO danger unless already in it (fleeing crosses danger).
        if (!e.ai.fleeing && game.dangerSet.has(idx(n.x, n.y)) && !game.dangerSet.has(idx(e.cx, e.cy)))
            return replan();
        return [n.x - e.cx, n.y - e.cy];
    }

    return { fresh, think, nextStep };
}
