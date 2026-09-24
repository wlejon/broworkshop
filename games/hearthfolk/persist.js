// Save / load the village to localStorage: sim state as JSON plus the tile
// world's own binary save (base64).
//
// installPersist(game, onLoaded) adds saveVillage, loadVillage and hasSave.

const SAVE_KEY = 'hearthfolk-save';

function bytesToB64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
}

function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

export function installPersist(game, onLoaded) {
    const world = game.world;

    game.saveVillage = function () {
        const data = {
            version: 1,
            seed: game.seed, time: game.time, speed: game.speed,
            res: { ...game.res }, fire: game.fire,
            stats: { ...game.stats },
            mind: { accepted: game.mind.accepted, discarded: game.mind.discarded },
            villagers: game.villagers.map((v) => ({
                name: v.name, pos: { ...v.pos }, needs: { ...v.needs },
                goal: v.goal, memories: [...v.memories], counts: { ...v.counts },
                activity: v.activity,
            })),
            trees: game.trees.map((t) => ({ ...t })),
            crops: game.crops.map((c) => ({ ...c })),
            chronicle: game.chronicle.slice(-120),
            grid: bytesToB64(world.save()),
        };
        localStorage.setItem(SAVE_KEY, JSON.stringify(data));
        return true;
    };

    game.loadVillage = function () {
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) return false;
        let data;
        try { data = JSON.parse(raw); } catch (e) { return false; }
        if (!data || data.version !== 1) return false;
        if (!world.load(b64ToBytes(data.grid))) return false;
        // world.load() preserved every registered kind (ids stay valid); only
        // the instance placements were cleared. The per-frame sync and the
        // dirty flags below re-place everything; NO re-registration happens.
        game.seed = data.seed; game.time = data.time; game.speed = data.speed;
        game.res = { ...data.res }; game.fire = data.fire;
        Object.assign(game.stats, data.stats);
        game.mind.accepted = data.mind.accepted;
        game.mind.discarded = data.mind.discarded;
        for (const sv of data.villagers) {
            const v = game.villagerByName(sv.name);
            if (!v) continue;
            v.pos = { ...sv.pos };
            v.needs = { ...sv.needs };
            v.goal = sv.goal;
            v.memories = [...sv.memories];
            v.counts = { ...sv.counts };
            v.activity = 'idle';
            v.path = null; v.target = null; v.plannedAct = null;
            v.commit = null; v.override = null; v.say = null; v.heard = null;
        }
        game.trees = data.trees.map((t) => ({ ...t }));
        game.crops = data.crops.map((c) => ({ ...c }));
        game.chronicle = data.chronicle.map((e) => ({ ...e }));
        game.dirty.trees = true;
        game.dirty.static = true;
        game.dirty.piles = true;
        if (onLoaded) onLoaded();
        return true;
    };

    game.hasSave = () => localStorage.getItem(SAVE_KEY) !== null;
}
