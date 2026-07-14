// economy.js — fintank storage, save slots, shop catalogue, high-scores.
// Uses localStorage directly (no /lib/storage dependency).
'use strict';

export const Economy = (function () {
    var defaults = {
        sfxVol: 80,
        musicVol: 60,
        difficulty: 1,   // 0=easy, 1=normal, 2=hard
        activeSlot: 1
    };
    var settings = loadSettings();
    var hsKey = "fintank:days";

    function loadSettings() {
        var data = Object.assign({}, defaults);
        try {
            var raw = localStorage.getItem("fintank:settings");
            if (raw) {
                var parsed = JSON.parse(raw);
                for (var k in parsed) if (Object.prototype.hasOwnProperty.call(parsed, k)) data[k] = parsed[k];
            }
        } catch (e) {}
        return data;
    }
    function saveSettings() {
        try { localStorage.setItem("fintank:settings", JSON.stringify(settings)); } catch (e) {}
    }

    function listHS() {
        try {
            var raw = localStorage.getItem(hsKey);
            if (!raw) return [];
            var list = JSON.parse(raw);
            return Array.isArray(list) ? list : [];
        } catch (e) { return []; }
    }
    function addHS(entry) {
        var list = listHS();
        list.push(entry);
        list.sort(function (a, b) { return (b.day || 0) - (a.day || 0); });
        list = list.slice(0, 10);
        try { localStorage.setItem(hsKey, JSON.stringify(list)); } catch (e) {}
        return list;
    }

    // ---- Fish tier catalogue (original breeds) ----
    var FISH_TIERS = [
        { id: 1, name: 'GLIMFIN',    price: 100,  coinTier: 1, feedMs: 5500,  color: '#f8c85a', size: 14, speed: 50 },
        { id: 2, name: 'BLUEWISP',   price: 250,  coinTier: 2, feedMs: 7200,  color: '#5ecdf5', size: 17, speed: 44 },
        { id: 3, name: 'ROSEFIN',    price: 600,  coinTier: 3, feedMs: 9500,  color: '#ff7aa8', size: 20, speed: 40 },
        { id: 4, name: 'EGGLAYER',   price: 1400, coinTier: 3, feedMs: 10500, color: '#a8f06c', size: 22, speed: 36, eggLayer: true },
        { id: 5, name: 'GILDJAW',    price: 3000, coinTier: 5, feedMs: 12500, color: '#ffd060', size: 26, speed: 32 },
        { id: 6, name: 'PEARLSCALE', price: 7000, coinTier: 6, feedMs: 15500, color: '#e8e0ff', size: 30, speed: 28, diamondDrop: true }
    ];

    var COIN_VALUES = { 1: 5, 2: 12, 3: 30, 4: 60, 5: 120, 6: 500 };

    var PELLET_TIERS = [
        { id: 1, name: 'BASIC PELLET', price: 0,    coinBoost: 1.0,  restore: 60 },
        { id: 2, name: 'RICH PELLET',  price: 400,  coinBoost: 1.25, restore: 75 },
        { id: 3, name: 'GOURMET',      price: 1500, coinBoost: 1.5,  restore: 95 },
        { id: 4, name: 'AMBROSIA',     price: 5000, coinBoost: 2.0,  restore: 110 }
    ];

    var TANK_UPGRADES = [
        { id: 'cap',   name: 'FISH CAPACITY', levels: [10, 14, 18, 22, 26], prices: [0, 300, 800, 2000, 5000] },
        { id: 'filter',name: 'FILTER (SLOW HUNGER)', levels: [1.0, 0.85, 0.72, 0.6, 0.5], prices: [0, 500, 1400, 3500, 8000] },
        { id: 'light', name: 'TANK LIGHTING',        levels: [1.0, 1.1, 1.2, 1.35, 1.5], prices: [0, 250, 700, 1800, 4000] }
    ];

    var PETS = [
        { id: 'bubbler',    name: 'BUBBLER',    price: 800,  desc: 'AUTO-FEEDS HUNGRY FISH' },
        { id: 'coinkeeper', name: 'COINKEEPER', price: 1200, desc: 'AUTO-COLLECTS OLD COINS' },
        { id: 'pufferguard',name: 'PUFFERGUARD',price: 1800, desc: 'ATTACKS INTRUDERS' },
        { id: 'alchem',     name: 'ALCHEM',     price: 2600, desc: 'UPGRADES COINS' },
        { id: 'sprout',     name: 'SPROUT',     price: 1500, desc: 'DROPS FREE PELLETS' }
    ];

    function freshSlot(n) {
        return {
            slot: n,
            day: 1,
            coins: 200,
            fish: [],
            pets: [],
            activePet: null,
            pelletTier: 1,
            upgrades: { cap: 1, filter: 1, light: 1 },
            bestDay: 1,
            totalCoins: 0
        };
    }

    function slotKey(n) { return 'fintank:slot' + n; }
    function loadSlot(n) {
        try {
            var raw = localStorage.getItem(slotKey(n));
            if (!raw) return freshSlot(n);
            var parsed = JSON.parse(raw);
            var base = freshSlot(n);
            for (var k in parsed) if (parsed.hasOwnProperty(k)) base[k] = parsed[k];
            if (!base.upgrades) base.upgrades = { cap: 1, filter: 1, light: 1 };
            if (!base.fish) base.fish = [];
            if (!base.pets) base.pets = [];
            return base;
        } catch (e) { return freshSlot(n); }
    }
    function saveSlot(slot) {
        try { localStorage.setItem(slotKey(slot.slot), JSON.stringify(slot)); } catch (e) {}
    }
    function eraseSlot(n) {
        try { localStorage.removeItem(slotKey(n)); } catch (e) {}
    }

    function fishById(id)   { for (var i=0;i<FISH_TIERS.length;i++) if (FISH_TIERS[i].id===id) return FISH_TIERS[i]; return null; }
    function pelletById(id) { for (var i=0;i<PELLET_TIERS.length;i++) if (PELLET_TIERS[i].id===id) return PELLET_TIERS[i]; return null; }
    function petById(id)    { for (var i=0;i<PETS.length;i++) if (PETS[i].id===id) return PETS[i]; return null; }
    function tankUpgrade(id){ for (var i=0;i<TANK_UPGRADES.length;i++) if (TANK_UPGRADES[i].id===id) return TANK_UPGRADES[i]; return null; }

    function coinValue(tier) { return COIN_VALUES[tier] || 5; }

    function difficultyLabel() {
        return ['EASY', 'NORMAL', 'HARD'][settings.difficulty] || 'NORMAL';
    }

    function maxFishCap(slot) {
        var cap = tankUpgrade('cap');
        return cap.levels[Math.min(cap.levels.length - 1, Math.max(0, (slot.upgrades.cap||1) - 1))];
    }
    function filterMult(slot) {
        var f = tankUpgrade('filter');
        return f.levels[Math.min(f.levels.length - 1, Math.max(0, (slot.upgrades.filter||1) - 1))];
    }
    function lightMult(slot) {
        var f = tankUpgrade('light');
        return f.levels[Math.min(f.levels.length - 1, Math.max(0, (slot.upgrades.light||1) - 1))];
    }

    function upgradeNextPrice(slot, id) {
        var up = tankUpgrade(id);
        var lvl = slot.upgrades[id] || 1;
        if (lvl >= up.levels.length) return -1;
        return up.prices[lvl];
    }
    function upgradeMaxed(slot, id) {
        var up = tankUpgrade(id);
        return (slot.upgrades[id] || 1) >= up.levels.length;
    }

    function buyPelletNext(slot) {
        if (slot.pelletTier >= PELLET_TIERS.length) return { ok: false, reason: 'MAXED' };
        var next = PELLET_TIERS[slot.pelletTier];
        if (slot.coins < next.price) return { ok: false, reason: 'NOT ENOUGH COINS' };
        slot.coins -= next.price;
        slot.pelletTier = next.id;
        return { ok: true };
    }

    function buyFish(slot, tierId) {
        var t = fishById(tierId);
        if (!t) return { ok: false, reason: 'INVALID' };
        if (slot.fish.length >= maxFishCap(slot)) return { ok: false, reason: 'TANK FULL' };
        if (slot.coins < t.price) return { ok: false, reason: 'NOT ENOUGH COINS' };
        slot.coins -= t.price;
        slot.fish.push({ tier: t.id });
        return { ok: true, tier: t.id };
    }

    function buyUpgrade(slot, id) {
        if (upgradeMaxed(slot, id)) return { ok: false, reason: 'MAXED' };
        var price = upgradeNextPrice(slot, id);
        if (slot.coins < price) return { ok: false, reason: 'NOT ENOUGH COINS' };
        slot.coins -= price;
        slot.upgrades[id] = (slot.upgrades[id] || 1) + 1;
        return { ok: true };
    }

    function buyPet(slot, petId) {
        var p = petById(petId);
        if (!p) return { ok: false, reason: 'INVALID' };
        if (slot.pets.indexOf(petId) !== -1) return { ok: false, reason: 'OWNED' };
        if (slot.coins < p.price) return { ok: false, reason: 'NOT ENOUGH COINS' };
        slot.coins -= p.price;
        slot.pets.push(petId);
        if (!slot.activePet) slot.activePet = petId;
        return { ok: true, pet: petId };
    }

    function shopCatalog(slot) {
        var items = [];
        if (slot.pelletTier < PELLET_TIERS.length) {
            var next = PELLET_TIERS[slot.pelletTier];
            items.push({ kind: 'pellet', label: 'PELLET: ' + next.name, price: next.price });
        }
        for (var i = 0; i < FISH_TIERS.length; i++) {
            var f = FISH_TIERS[i];
            items.push({ kind: 'fish', id: f.id, label: 'FISH: ' + f.name, price: f.price });
        }
        for (var j = 0; j < TANK_UPGRADES.length; j++) {
            var u = TANK_UPGRADES[j];
            if (upgradeMaxed(slot, u.id)) {
                items.push({ kind: 'upgrade', id: u.id, label: u.name + ' (MAX)', price: -1, disabled: true });
            } else {
                items.push({ kind: 'upgrade', id: u.id, label: u.name + ' LV ' + (slot.upgrades[u.id]||1) + ' -> ' + ((slot.upgrades[u.id]||1)+1),
                             price: upgradeNextPrice(slot, u.id) });
            }
        }
        for (var k = 0; k < PETS.length; k++) {
            var p = PETS[k];
            if (slot.pets.indexOf(p.id) !== -1) {
                items.push({ kind: 'pet', id: p.id, label: 'PET: ' + p.name + ' (OWNED)', price: -1, disabled: true });
            } else {
                items.push({ kind: 'pet', id: p.id, label: 'PET EGG: ' + p.name, price: p.price });
            }
        }
        return items;
    }

    return {
        FISH_TIERS: FISH_TIERS,
        PELLET_TIERS: PELLET_TIERS,
        TANK_UPGRADES: TANK_UPGRADES,
        PETS: PETS,
        COIN_VALUES: COIN_VALUES,

        settings: settings,
        saveSettings: saveSettings,
        difficultyLabel: difficultyLabel,

        addHS: addHS,
        listHS: listHS,

        freshSlot: freshSlot,
        loadSlot: loadSlot,
        saveSlot: saveSlot,
        eraseSlot: eraseSlot,

        fishById: fishById,
        pelletById: pelletById,
        petById: petById,
        tankUpgrade: tankUpgrade,

        coinValue: coinValue,
        maxFishCap: maxFishCap,
        filterMult: filterMult,
        lightMult: lightMult,
        upgradeNextPrice: upgradeNextPrice,
        upgradeMaxed: upgradeMaxed,

        buyPelletNext: buyPelletNext,
        buyFish: buyFish,
        buyUpgrade: buyUpgrade,
        buyPet: buyPet,
        shopCatalog: shopCatalog
    };
})();
