// farm.js — the running farm: the world model plus everyone acting in it (the
// player avatar, the NPC task executor, the Foreman's orchestrator) and their
// voices, advanced as one unit. No DOM, no scene: game.js renders it.
//
//   const farm = createFarm({ getAudioCtx, isActive, voices });
//   farm.step(dt, dx, dy)       dt ms, dx/dy player move axes (-1..1)
//   farm.interact() / farm.buyFeed()
//   farm.auto = false           freeze the Foreman (tests drive by hand)

import { createWorld } from "/app/world.js";
import { GRID, REGIONS } from "/app/defs.js";
import { advanceTask } from "/app/tasks.js";
import { createOrchestrator } from "/app/orchestrator.js";
import { initPlayer, movePlayer, runInteract, buyFeed } from "/app/player.js";
import { createVoice } from "/app/voice.js";

const SEED = 7;
const PLAYER_SPAWN = { x: 22, y: 14 };
const DECIDE_INTERVAL = 1000;   // ms between Foreman decisions (sooner when a worker idles)
const FEED_BUY_UNITS = 200;     // the market key's feed order
const NAV_BLOCKERS = new Set(["farmhouse", "barn", "silo", "well"]);

export function createFarm(opts) {
    const o = opts || {};
    const world = createWorld({ seed: SEED });
    initPlayer(world, PLAYER_SPAWN.x, PLAYER_SPAWN.y);

    // Nav grid: solid buildings are obstacles, the open field is walkable.
    const nav = bro.ai.game.createNavGrid({
        minX: 0, minZ: 0, maxX: GRID.cols, maxZ: GRID.rows, cellSize: 0.5, padding: 0.1,
        obstacles: REGIONS.filter((r) => NAV_BLOCKERS.has(r.type)).map((r) => ({
            x: (r.x0 + r.x1 + 1) / 2, z: (r.y0 + r.y1 + 1) / 2,
            hw: (r.x1 - r.x0 + 1) / 2, hd: (r.y1 - r.y0 + 1) / 2,
        })),
    });
    world.pathfind = (x0, y0, x1, y1) =>
        nav.findPath(x0, y0, x1, y1).map((p) => ({ x: p.x, y: p.z }));

    const farm = {
        world, nav,
        orchestrator: createOrchestrator(),
        auto: true,
        voice: null,
        step, interact, buyFeed: () => buyFeed(world, FEED_BUY_UNITS),
        speakerPos, listenerPos,
    };

    farm.voice = createVoice({
        getAudioCtx: o.getAudioCtx,
        npcVoiceTag: (id) => { const n = npc(id); return n ? n.voice : null; },
        isActive: o.isActive,
        speakerPos,
        listenerPos,
        enabled: o.voices !== false,
    });
    world._emitSpeech = (id, text, onStart) => farm.voice.speak(id, text, { onStart });

    let decideAccum = 0;

    function step(dt, dx, dy) {
        movePlayer(world, dt, dx || 0, dy || 0);
        world.step(dt);
        for (const n of world.npcs) if (n.task) advanceTask(world, n, dt);
        decideAccum += dt;
        const anyIdle = world.npcs.some((n) => n.task == null);
        if (farm.auto && (decideAccum >= DECIDE_INTERVAL || anyIdle)) {
            decideAccum = 0;
            farm.orchestrator.decide(world);
        }
    }

    function interact() {
        return runInteract(world);
    }

    function npc(id) {
        return world.npcs.find((n) => n.id === id) || null;
    }

    // Tile positions for spatial voices: the player is the listener.
    function speakerPos(id) {
        if (id === "You") return listenerPos();
        if (world.foreman && id === world.foreman.id) return { x: world.foreman.x, y: world.foreman.y };
        const n = npc(id);
        return n ? { x: n.x, y: n.y } : null;
    }

    function listenerPos() {
        return world.player ? { x: world.player.x, y: world.player.y } : null;
    }

    return farm;
}
