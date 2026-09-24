// economy.js — Fintank's catalogue (fish, pellets, tank upgrades, pets),
// the three save slots and the shop. Pure data + rules; no DOM, no canvas.
// Settings and the high-score list live in the shell save (game.js).

export const FISH_TIERS = [
    { id: 1, name: "GLIMFIN",    price: 100,  coinTier: 1, feedMs: 5500,  color: "#f8c85a", size: 14, speed: 50 },
    { id: 2, name: "BLUEWISP",   price: 250,  coinTier: 2, feedMs: 7200,  color: "#5ecdf5", size: 17, speed: 44 },
    { id: 3, name: "ROSEFIN",    price: 600,  coinTier: 3, feedMs: 9500,  color: "#ff7aa8", size: 20, speed: 40 },
    { id: 4, name: "EGGLAYER",   price: 1400, coinTier: 3, feedMs: 10500, color: "#a8f06c", size: 22, speed: 36, eggLayer: true },
    { id: 5, name: "GILDJAW",    price: 3000, coinTier: 5, feedMs: 12500, color: "#ffd060", size: 26, speed: 32 },
    { id: 6, name: "PEARLSCALE", price: 7000, coinTier: 6, feedMs: 15500, color: "#e8e0ff", size: 30, speed: 28, diamondDrop: true },
];

export const COIN_VALUES = { 1: 5, 2: 12, 3: 30, 4: 60, 5: 120, 6: 500 };

export const PELLET_TIERS = [
    { id: 1, name: "BASIC PELLET", price: 0,    coinBoost: 1.0,  restore: 60 },
    { id: 2, name: "RICH PELLET",  price: 400,  coinBoost: 1.25, restore: 75 },
    { id: 3, name: "GOURMET",      price: 1500, coinBoost: 1.5,  restore: 95 },
    { id: 4, name: "AMBROSIA",     price: 5000, coinBoost: 2.0,  restore: 110 },
];

export const TANK_UPGRADES = [
    { id: "cap",    name: "FISH CAPACITY",        levels: [10, 14, 18, 22, 26],       prices: [0, 300, 800, 2000, 5000] },
    { id: "filter", name: "FILTER (SLOW HUNGER)", levels: [1.0, 0.85, 0.72, 0.6, 0.5], prices: [0, 500, 1400, 3500, 8000] },
    { id: "light",  name: "TANK LIGHTING",        levels: [1.0, 1.1, 1.2, 1.35, 1.5],  prices: [0, 250, 700, 1800, 4000] },
];

export const PETS = [
    { id: "bubbler",     name: "BUBBLER",     price: 800,  desc: "AUTO-FEEDS HUNGRY FISH" },
    { id: "coinkeeper",  name: "COINKEEPER",  price: 1200, desc: "AUTO-COLLECTS OLD COINS" },
    { id: "pufferguard", name: "PUFFERGUARD", price: 1800, desc: "ATTACKS INTRUDERS" },
    { id: "alchem",      name: "ALCHEM",      price: 2600, desc: "UPGRADES COINS" },
    { id: "sprout",      name: "SPROUT",      price: 1500, desc: "DROPS FREE PELLETS" },
];

export const DIFFICULTY = ["EASY", "NORMAL", "HARD"];
/** Hunger decay multiplier per difficulty. */
export const HUNGER_MULT = [0.7, 1.0, 1.3];

export const STARTING_COINS = 200;
export const STARTER_FISH = () => [{ tier: 1 }, { tier: 1 }];

export const fishById = (id) => FISH_TIERS.find((f) => f.id === id) || null;
export const pelletById = (id) => PELLET_TIERS.find((p) => p.id === id) || null;
export const petById = (id) => PETS.find((p) => p.id === id) || null;
export const tankUpgrade = (id) => TANK_UPGRADES.find((u) => u.id === id) || null;
export const coinValue = (tier) => COIN_VALUES[tier] || 5;

// ── Save slots ───────────────────────────────────────────────────────────

const slotKey = (n) => "fintank:slot" + n;

export function freshSlot(n) {
    return {
        slot: n,
        day: 1,
        coins: STARTING_COINS,
        fish: [],               // [{ tier }] carried between days
        pets: [],               // owned pet ids
        activePet: null,
        pelletTier: 1,
        upgrades: { cap: 1, filter: 1, light: 1 },
        bestDay: 1,
        totalCoins: 0,
    };
}

export function loadSlot(n) {
    const base = freshSlot(n);
    try {
        const raw = localStorage.getItem(slotKey(n));
        if (raw) Object.assign(base, JSON.parse(raw));
    } catch (e) { /* a corrupt slot reads as fresh */ }
    base.slot = n;
    if (!base.upgrades) base.upgrades = { cap: 1, filter: 1, light: 1 };
    if (!base.fish) base.fish = [];
    if (!base.pets) base.pets = [];
    return base;
}

export function saveSlot(slot) {
    try { localStorage.setItem(slotKey(slot.slot), JSON.stringify(slot)); } catch (e) { /* ignore */ }
}

export function eraseSlot(n) {
    try { localStorage.removeItem(slotKey(n)); } catch (e) { /* ignore */ }
}

/** True once the slot has been played (saved). */
export function slotExists(n) {
    try { return localStorage.getItem(slotKey(n)) != null; } catch (e) { return false; }
}

// ── Upgrade levels ───────────────────────────────────────────────────────

function upgradeLevel(slot, id) {
    const up = tankUpgrade(id);
    return up.levels[Math.min(up.levels.length - 1, Math.max(0, (slot.upgrades[id] || 1) - 1))];
}

export const maxFishCap = (slot) => upgradeLevel(slot, "cap");
export const filterMult = (slot) => upgradeLevel(slot, "filter");
export const lightMult = (slot) => upgradeLevel(slot, "light");

export function upgradeMaxed(slot, id) {
    return (slot.upgrades[id] || 1) >= tankUpgrade(id).levels.length;
}

export function upgradeNextPrice(slot, id) {
    return upgradeMaxed(slot, id) ? -1 : tankUpgrade(id).prices[slot.upgrades[id] || 1];
}

// ── Purchases: each returns { ok, reason? } and mutates the slot ─────────

const broke = { ok: false, reason: "NOT ENOUGH COINS" };

export function buyPelletNext(slot) {
    if (slot.pelletTier >= PELLET_TIERS.length) return { ok: false, reason: "MAXED" };
    const next = PELLET_TIERS[slot.pelletTier];
    if (slot.coins < next.price) return broke;
    slot.coins -= next.price;
    slot.pelletTier = next.id;
    return { ok: true };
}

export function buyFish(slot, tierId) {
    const t = fishById(tierId);
    if (!t) return { ok: false, reason: "INVALID" };
    if (slot.fish.length >= maxFishCap(slot)) return { ok: false, reason: "TANK FULL" };
    if (slot.coins < t.price) return broke;
    slot.coins -= t.price;
    slot.fish.push({ tier: t.id });
    return { ok: true, tier: t.id };
}

export function buyUpgrade(slot, id) {
    if (!tankUpgrade(id)) return { ok: false, reason: "INVALID" };
    if (upgradeMaxed(slot, id)) return { ok: false, reason: "MAXED" };
    const price = upgradeNextPrice(slot, id);
    if (slot.coins < price) return broke;
    slot.coins -= price;
    slot.upgrades[id] = (slot.upgrades[id] || 1) + 1;
    return { ok: true };
}

export function buyPet(slot, petId) {
    const p = petById(petId);
    if (!p) return { ok: false, reason: "INVALID" };
    if (slot.pets.includes(petId)) return { ok: false, reason: "OWNED" };
    if (slot.coins < p.price) return broke;
    slot.coins -= p.price;
    slot.pets.push(petId);
    if (!slot.activePet) slot.activePet = petId;
    return { ok: true, pet: petId };
}

/** The shop menu for a slot: [{ kind, id?, label, price (-1 = n/a), disabled? }]. */
export function shopCatalog(slot) {
    const items = [];
    if (slot.pelletTier < PELLET_TIERS.length) {
        const next = PELLET_TIERS[slot.pelletTier];
        items.push({ kind: "pellet", label: "PELLET: " + next.name, price: next.price });
    }
    for (const f of FISH_TIERS) items.push({ kind: "fish", id: f.id, label: "FISH: " + f.name, price: f.price });
    for (const u of TANK_UPGRADES) {
        const lvl = slot.upgrades[u.id] || 1;
        items.push(upgradeMaxed(slot, u.id)
            ? { kind: "upgrade", id: u.id, label: u.name + " (MAX)", price: -1, disabled: true }
            : { kind: "upgrade", id: u.id, label: u.name + " LV " + lvl + " -> " + (lvl + 1), price: upgradeNextPrice(slot, u.id) });
    }
    for (const p of PETS) {
        items.push(slot.pets.includes(p.id)
            ? { kind: "pet", id: p.id, label: "PET: " + p.name + " (OWNED)", price: -1, disabled: true }
            : { kind: "pet", id: p.id, label: "PET EGG: " + p.name, price: p.price });
    }
    return items;
}

/** Buy a catalogue entry (from shopCatalog). */
export function buyItem(slot, item) {
    if (!item || item.disabled) return { ok: false };
    if (item.kind === "pellet") return buyPelletNext(slot);
    if (item.kind === "fish") return buyFish(slot, item.id);
    if (item.kind === "upgrade") return buyUpgrade(slot, item.id);
    if (item.kind === "pet") return buyPet(slot, item.id);
    return { ok: false };
}
