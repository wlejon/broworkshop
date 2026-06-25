// defs.js — static farm definitions. No state, no DOM, no canvas.
//
// This is the data the simulation (world.js) instantiates from and the
// renderer (render.js) reads for colors/labels. Tile coordinates are in
// grid space (0..GRID.cols, 0..GRID.rows); world entities live in the same
// continuous tile space so the renderer only needs one tile->pixel map.

export const GRID = { cols: 40, rows: 28 };

// Day length in milliseconds of simulated time. Short so a demo day passes
// in a couple of minutes of advanceTime.
export const DAY_LENGTH_MS = 120000;

// Tuning — all *Rise / *Rate / *Decay values are per simulated SECOND.
//
// METABOLISM RELAXED for the briefing protocol: workers now physically report to
// the Foreman (walk to the central command post + hear the full spoken order +
// reply, ~6 s of talking) before every assigned job. That round-trip roughly
// halves service throughput, so hunger/thirst accrual is slowed ~45% and
// healthDecay softened to keep all animals alive through a multi-day run with the
// briefing in place. Deliberate game-balance tuning to absorb the protocol's
// overhead — the upcoming MCTS Foreman pass (smarter BATCHED scheduling, fewer
// round-trips per unit of work) is expected to let these be tightened back
// toward their original values.
//   hungerRise 2.2->1.2   thirstRise 2.6->1.4   healthDecay 4.0->2.5
export const RATES = {
    hungerRise:   1.2,   // animal hunger climbs this fast when not eating (was 2.2)
    thirstRise:   1.4,   // (was 2.6)
    feedRate:     8.0,   // how fast a feeding animal pulls its need down
    troughDraw:   0.22,  // trough units consumed per need-point restored
                         // (low so a refill lasts long enough that 4 workers
                         //  keep all 6 troughs full AND have slack to collect)
    healthDecay:  2.5,   // health lost/s while a need is critical (>70) (was 4.0)
    healthRegen:  2.0,   // health gained/s while well-fed AND watered (<35)
    needCritical: 70,    // need level at which health starts to decline
    needComfort:  35,    // need level below which an animal recovers
    produceMin:   60,    // min health to keep producing goods
    produceInterval: 10, // seconds of healthy life per produced good
    moistureDecay: 1.5,  // crop soil drying per second
    growthRate:   3.0,   // crop growth/s while moisture > 0
    growGrowing:  20,    // growth at which 'seed' becomes 'growing'
    growRipe:     100,   // growth at which a crop is 'ripe'
};

// Buildings / static regions. type drives the render fill + label.
export const REGIONS = [
    { id: 'farmhouse', type: 'farmhouse', label: 'Farmhouse', x0: 1,  y0: 1,  x1: 7,  y1: 6  },
    { id: 'barn',      type: 'barn',      label: 'Barn',      x0: 9,  y0: 1,  x1: 15, y1: 6  },
    { id: 'well',      type: 'well',      label: 'Well',      x0: 17, y0: 2,  x1: 20, y1: 5  },
    { id: 'silo',      type: 'silo',      label: 'Silo',      x0: 33, y0: 1,  x1: 39, y1: 7  },
    { id: 'field',     type: 'field',     label: 'Fields',    x0: 2,  y0: 9,  x1: 21, y1: 26 },
    { id: 'coop',      type: 'pen',       label: 'Chicken Coop', penId: 'coop',    x0: 24, y0: 9,  x1: 31, y1: 16 },
    { id: 'meadow',    type: 'pen',       label: 'Sheep Meadow', penId: 'meadow',  x0: 33, y0: 9,  x1: 39, y1: 16 },
    { id: 'pasture',   type: 'pen',       label: 'Cow Pasture',  penId: 'pasture', x0: 24, y0: 18, x1: 39, y1: 26 },
];

// Pen metadata: where each pen's two troughs sit, the good its animals produce,
// and the population cap breeding will not exceed.
export const PENS = {
    coop: {
        penId: 'coop', label: 'Chicken Coop', good: 'eggs', goodLabel: 'Eggs', goldPerGood: 3, cap: 8,
        feedTrough:  { x: 25.0, y: 10.0 },
        waterTrough: { x: 29.0, y: 10.0 },
    },
    meadow: {
        penId: 'meadow', label: 'Sheep Meadow', good: 'wool', goodLabel: 'Wool', goldPerGood: 8, cap: 6,
        feedTrough:  { x: 34.0, y: 10.0 },
        waterTrough: { x: 38.0, y: 10.0 },
    },
    pasture: {
        penId: 'pasture', label: 'Cow Pasture', good: 'milk', goodLabel: 'Milk', goldPerGood: 6, cap: 6,
        feedTrough:  { x: 25.5, y: 19.0 },
        waterTrough: { x: 37.0, y: 19.0 },
    },
};

// Per-species metabolism + production stats. hungerMul/thirstMul scale the base
// RATES.*Rise; produceMul/produceInterval govern the good output; radius/color
// drive render. The new species is the sheep (wool).
export const ANIMAL_KINDS = {
    chicken: { label: 'Chicken', good: 'eggs', hungerMul: 1.0, thirstMul: 1.0, produceMul: 1.0, produceInterval: 10, radius: 0.34, color: '#f0e3b0' },
    cow:     { label: 'Cow',     good: 'milk', hungerMul: 1.1, thirstMul: 1.2, produceMul: 1.4, produceInterval: 14, radius: 0.50, color: '#e8e8e8' },
    sheep:   { label: 'Sheep',   good: 'wool', hungerMul: 0.9, thirstMul: 0.8, produceMul: 1.0, produceInterval: 16, radius: 0.42, color: '#dcdcdc' },
};

// Animal roster. Positions are starting tile centers; needs start mid-range
// so the pressure is visible quickly in a demo.
export const ANIMAL_SPECS = [
    { id: 'hen-1', kind: 'chicken', penId: 'coop', x: 26.5, y: 13.0, hunger: 30, thirst: 35 },
    { id: 'hen-2', kind: 'chicken', penId: 'coop', x: 28.5, y: 14.0, hunger: 25, thirst: 30 },
    { id: 'hen-3', kind: 'chicken', penId: 'coop', x: 27.0, y: 12.0, hunger: 40, thirst: 28 },
    { id: 'hen-4', kind: 'chicken', penId: 'coop', x: 29.0, y: 13.5, hunger: 22, thirst: 38 },
    { id: 'ewe-1', kind: 'sheep', penId: 'meadow', x: 35.0, y: 12.0, hunger: 30, thirst: 25 },
    { id: 'ewe-2', kind: 'sheep', penId: 'meadow', x: 37.0, y: 13.0, hunger: 35, thirst: 28 },
    { id: 'ram-1', kind: 'sheep', penId: 'meadow', x: 36.0, y: 11.0, hunger: 28, thirst: 33 },
    { id: 'cow-1', kind: 'cow', penId: 'pasture', x: 28.0, y: 22.0, hunger: 35, thirst: 30 },
    { id: 'cow-2', kind: 'cow', penId: 'pasture', x: 33.0, y: 23.5, hunger: 45, thirst: 55 },
    { id: 'cow-3', kind: 'cow', penId: 'pasture', x: 31.0, y: 24.5, hunger: 28, thirst: 40 },
];

// Crop plots — fixed tile slots inside the 'field' region. Each is a soil bed
// that may hold one crop. Initial stage/growth/moisture vary to show variety.
export const CROP_PLOTS = [
    { id: 'plot-0', plotIndex: 0, x: 4.5,  y: 11.0, kind: 'wheat',   stage: 'ripe',    growth: 100, moisture: 40 },
    { id: 'plot-1', plotIndex: 1, x: 10.0, y: 11.0, kind: 'pumpkin', stage: 'growing', growth: 60,  moisture: 55 },
    { id: 'plot-2', plotIndex: 2, x: 15.5, y: 11.0, kind: 'corn',    stage: 'seed',    growth: 8,   moisture: 70 },
    { id: 'plot-3', plotIndex: 3, x: 4.5,  y: 17.5, kind: 'carrot',  stage: 'growing', growth: 35,  moisture: 20 },
    { id: 'plot-4', plotIndex: 4, x: 10.0, y: 17.5, kind: null,      stage: 'empty',   growth: 0,   moisture: 0  },
    { id: 'plot-5', plotIndex: 5, x: 15.5, y: 17.5, kind: 'tomato',  stage: 'ripe',    growth: 100, moisture: 60 },
    { id: 'plot-6', plotIndex: 6, x: 4.5,  y: 24.0, kind: 'tomato',  stage: 'growing', growth: 75,  moisture: 50 },
    { id: 'plot-7', plotIndex: 7, x: 10.0, y: 24.0, kind: null,      stage: 'empty',   growth: 0,   moisture: 0  },
    { id: 'plot-8', plotIndex: 8, x: 15.5, y: 24.0, kind: 'wheat',   stage: 'seed',    growth: 3,   moisture: 80 },
];

// NPC workers. role/voice are carried now but UNUSED in this pass — the agent
// layer (Pass 2) reads them. home is the tile they gently wander around.
//
// stats: each worker's starting STAT LEVELS (1..STAT_MAX_LEVEL). world.js turns
// these into a full sheet ({ level, xp }) the work they do grows over time, and
// the levels DRIVE the dynamic need meters + movement (see the coupling helpers
// below + world.js / tasks.js). Roster is seeded distinctly so each worker feels
// like a specialist: the ranchers (Mara/Sam) start strong in Husbandry, the
// gardener (Lily) in Farming, the farmhand (Tom) is a balanced hauler.
export const NPC_SPECS = [
    { id: 'npc-mara', name: 'Mara', role: 'rancher',  voice: 'warm',   home: { x: 20, y: 20 },
      stats: { strength: 3, endurance: 3, vitality: 3, agility: 3, husbandry: 5, farming: 2 } },
    { id: 'npc-tom',  name: 'Tom',  role: 'farmhand', voice: 'gruff',  home: { x: 12, y: 8  },
      stats: { strength: 5, endurance: 4, vitality: 3, agility: 3, husbandry: 3, farming: 3 } },
    { id: 'npc-lily', name: 'Lily', role: 'gardener', voice: 'bright', home: { x: 6,  y: 16 },
      stats: { strength: 2, endurance: 3, vitality: 3, agility: 4, husbandry: 2, farming: 5 } },
    // A second rancher — the farm now runs three pens, so animal care needs
    // more hands to keep every trough topped and tend the sick.
    { id: 'npc-sam',  name: 'Sam',  role: 'rancher',  voice: 'calm',   home: { x: 30, y: 17 },
      stats: { strength: 3, endurance: 4, vitality: 3, agility: 2, husbandry: 4, farming: 2 } },
];

// The Foreman's stat sheet (he's stationary and never tasked, so these are
// static) — surfaced so the player can inspect him too. A seasoned supervisor:
// strong endurance/strength, broad domain knowledge, unremarkable agility.
export const FOREMAN_STATS = { strength: 5, endurance: 6, vitality: 5, agility: 2, husbandry: 5, farming: 5 };

// ---- worker stat sheet --------------------------------------------------------
// Six attributes. Each grows from the work a worker does (XP awarded in the task
// executor, tasks.js) and feeds back into the simulation:
//   strength   hauling/refilling heavy loads (grows from draw/load/refill)
//   endurance  stamina capacity + fatigue resistance (drives stamina cap/drain)
//   vitality   reserved to drive HEALTH in the later needs pass — defined now,
//              grown lightly (daily trickle), but it couples to nothing yet
//   agility    movement speed (drives walk speed)
//   husbandry  animal-work proficiency (speeds animal tasks)
//   farming    crop-work proficiency (speeds crop tasks)
export const STAT_KEYS = ['strength', 'endurance', 'vitality', 'agility', 'husbandry', 'farming'];
export const STAT_LABEL = {
    strength: 'Strength', endurance: 'Endurance', vitality: 'Vitality',
    agility: 'Agility', husbandry: 'Husbandry', farming: 'Farming',
};
export const STAT_MAX_LEVEL = 10;

// XP needed to advance FROM `level` to level+1 — a gentle escalating curve so
// early levels come quickly and later ones take sustained work.
export function statXpToNext(level) { return 40 + (level - 1) * 25; }

// XP granted per unit of completed work, by stat. Tuned so a worker on their
// own domain visibly levels within a couple of in-game days (~10 acts/level).
export const STAT_XP = {
    husbandry: 10,   // per animal-domain act (refill/tend/collect)
    farming:   10,   // per crop-domain act (plant/water/harvest)
    strength:  7,    // per haul act (draw/load/refill)
    agility:   0.7,  // per tile walked (accumulated over move steps)
    endurance: 6,    // per completed job (a unit of sustained effort)
    vitality:  3,    // daily trickle for staying active
};

// Build a live stat sheet ({ level, xp }) from a spec's starting LEVELS map.
export function makeStatSheet(levels) {
    const out = {};
    for (const k of STAT_KEYS) out[k] = { level: (levels && levels[k]) || 1, xp: 0 };
    return out;
}

// Current level of a stat on an entity (defaults to 1 if it has no sheet).
export function statLevel(n, key) {
    const s = n && n.stats && n.stats[key];
    return s ? s.level : 1;
}

// Add XP to a stat, rolling over level-ups against the curve. Returns the stat
// key if it leveled up (for a notice), else null. Caps at STAT_MAX_LEVEL.
export function awardStatXp(n, key, amount) {
    const s = n && n.stats && n.stats[key];
    if (!s || amount <= 0) return null;
    if (s.level >= STAT_MAX_LEVEL) { s.xp = 0; return null; }
    s.xp += amount;
    let leveled = null;
    while (s.level < STAT_MAX_LEVEL && s.xp >= statXpToNext(s.level)) {
        s.xp -= statXpToNext(s.level);
        s.level += 1;
        leveled = key;
    }
    if (s.level >= STAT_MAX_LEVEL) s.xp = 0;
    return leveled;
}

// ---- the coupling: stats -> dynamic meters + movement -------------------------
// Tunables for how strongly each stat bends the sim. Kept modest so the farm
// stays self-sustaining (animals must still survive) while the differences read.
export const STAT_COUPLING = {
    staminaPerEndurance: 8,     // +max stamina per Endurance level above 1
    staminaDrainPerEnd:  0.06,  // drain SLOWS this much per Endurance level
    speedPerAgility:     0.05,  // move-speed gain per Agility level above 1
    proficiencyPerSkill: 0.075, // task-speed gain per relevant skill level
    proficiencyFloor:    0.75,  // novice task-speed floor (never unusably slow)
    // --- the health/hydration needs pass ---
    healthPerVitality:   10,    // +max health per Vitality level above 1 (lvl 1 = 100)
    healthRegenPerVit:   0.18,  // health-regen rate gain per Vitality level above 1
    hydrationDrainPerEnd: 0.04, // hydration drains SLOWER per Endurance level (lighter than stamina)
};

// Max stamina capacity grows with Endurance (level 1 = 100).
export function staminaMaxFor(n) {
    return 100 + (statLevel(n, 'endurance') - 1) * STAT_COUPLING.staminaPerEndurance;
}
// Stamina drains slower at higher Endurance (multiplier <= 1).
export function staminaDrainMul(n) {
    return 1 / (1 + (statLevel(n, 'endurance') - 1) * STAT_COUPLING.staminaDrainPerEnd);
}
// Max HEALTH capacity grows with Vitality (level 1 = 100). The reserved
// vitality stat from the prior pass now drives the worker's health ceiling.
export function healthMaxFor(n) {
    return 100 + (statLevel(n, 'vitality') - 1) * STAT_COUPLING.healthPerVitality;
}
// Health recovers FASTER at higher Vitality (multiplier >= 1).
export function healthRegenMul(n) {
    return 1 + (statLevel(n, 'vitality') - 1) * STAT_COUPLING.healthRegenPerVit;
}
// Hydration drains slower at higher Endurance (multiplier <= 1) — fit workers
// thirst more slowly. Lighter coupling than stamina so the effect stays subtle.
export function hydrationDrainMul(n) {
    return 1 / (1 + (statLevel(n, 'endurance') - 1) * STAT_COUPLING.hydrationDrainPerEnd);
}
// Walk-speed multiplier from Agility (>= 1), bent DOWN when health is low: a
// weakened (run-down) worker moves slower until they recover. Entities without
// a health field (the Foreman) are unaffected.
export function moveSpeedMul(n) {
    let m = 1 + (statLevel(n, 'agility') - 1) * STAT_COUPLING.speedPerAgility;
    if (n && n.health != null && n.health < WORKER.weakened) m *= WORKER.weakenedSpeedMul;
    return m;
}
// A worker whose health has fallen into the weakened band (moves slower, reads
// as "run down" in the HUD/alerts).
export function isWeakened(n) {
    return n && n.health != null && n.health < WORKER.weakened;
}
// Task-proficiency multiplier for a work domain ('husbandry' | 'farming' | null).
// Higher relevant skill works faster; a floor keeps a novice from crawling.
export function proficiencyMul(n, domain) {
    if (!domain) return 1;
    const lvl = statLevel(n, domain);
    return Math.max(STAT_COUPLING.proficiencyFloor, 1 + (lvl - 1) * STAT_COUPLING.proficiencyPerSkill);
}

// Worker labor tuning (Pass D). Stamina/energy are gentle so workers spend most
// of their time working — the constraint adds allocation decisions without
// crippling labor. NOTE: the stamina CAP/drain are now further bent per-worker
// by Endurance (see staminaMaxFor / staminaDrainMul) — these are the level-1
// baselines.
export const WORKER = {
    staminaDrain: 1.3,   // /s while walking or working
    restRecover:  12,    // /s while resting at the farmhouse
    sleepRecover: 16,    // /s while sleeping (stamina AND energy)
    idleRecover:  3,     // /s while idle in the field
    eatStamina:   6,     // /s stamina regained while eating
    energyDrain:  0.22,  // /s while active
    energyIdle:   0.08,  // /s while idle
    eatEnergy:    30,    // /s energy regained while eating
    staminaRest:  25,    // below this -> must rest
    staminaOk:    80,    // rest until at least this
    energyEat:    30,    // below this -> must eat
    energyOk:     90,    // eat until at least this
    exhausted:    15,    // stamina alert threshold
    hungry:       20,    // energy alert threshold

    // ---- hydration (water) need -------------------------------------------
    // Drains while active (and slowly while idle), FASTER in heat (see heat* and
    // the temperature coupling in world.js). Restored by drinking during a home
    // recover visit. Drain is bent lighter per-Endurance (hydrationDrainMul).
    hydrationDrain: 0.9,   // /s while walking or working (gentle: co-times ~ with stamina)
    hydrationIdle:  0.3,   // /s while idle in the field
    drinkRecover:   22,    // /s hydration regained while drinking (recover visit)
    heatBaseTemp:   20,    // °C above which heat starts accelerating thirst
    heatThirstPerDeg: 0.04,// thirst-drain gain per °C over heatBaseTemp (summer/drought bite)
    thirstDrink:    35,    // below this -> must drink (a home recover visit)
    hydrationOk:    85,    // drink until at least this
    thirsty:        22,    // hydration alert threshold (also the CRITICAL care trigger)

    // ---- health need (driven by Vitality) ---------------------------------
    // Health decays slowly while a CORE need is held critical and the worker
    // isn't being cared for; recovers (faster at home) while needs are okay, at a
    // rate scaled by Vitality (healthRegenMul). FLOORED — a worker can never die
    // or be lost; low health forces a recovery visit instead.
    healthDecay:    1.0,   // /s while a core need is critical and uncared-for
    healthRegen:    2.0,   // /s base recovery while no core need is critical
    healthCareBonus: 1.6,  // recovery multiplier while at a home recover visit
    healthCritHydration: 12, // hydration at/below this counts as a core-need crisis
    healthCritEnergy:    12, // energy at/below this counts as a core-need crisis
    healthCritStamina:   4,  // stamina pinned at/below this counts as a crisis
    healthFloor:    5,     // health is clamped here — NEVER lethal
    weakened:       50,    // below this health -> "run down" (slower, alert)
    weakenedSpeedMul: 0.7, // move-speed penalty while weakened
    healthForce:    30,    // below this -> a forced recovery visit (always critical)
    healthOk:       65,    // recover visit heals to at least this
    recoverMaxMs:   12000, // safety cap on a recover visit's dwell (never wedge)
};
// Specialist task-speed is now driven by the worker's Husbandry/Farming skill
// (proficiencyMul), superseding this flat per-role bonus. Kept for reference.
export const ROLE_SPEED_BONUS = 1.30;

// Per-role tint for render + HUD.
export const ROLE_COLOR = { rancher: '#e89a4a', gardener: '#6fc24a', farmhand: '#5aa6e0' };

// Starting resource pools. `feed`/`water` are the working pools troughs draw
// from; `barnFeed` is the finite, must-be-bought feed stock loadFeed pulls from.
export const START_RESOURCES = { feed: 180, barnFeed: 600, water: 150, gold: 200, eggs: 0, milk: 0, wool: 0, crops: 0 };

// Starting trough fill levels (0..100). Some start low so alerts/pressure
// appear within the first demo seconds.
export const START_TROUGHS = {
    'coop-feed': 75, 'coop-water': 40,
    'meadow-feed': 65, 'meadow-water': 55,
    'pasture-feed': 60, 'pasture-water': 70,
};

export const COLORS = {
    grass:     '#2e5d34',
    grassAlt:  '#346a3b',
    path:      '#7a6a4f',
    farmhouse: '#8a5a3c',
    barn:      '#a8423a',
    well:      '#46708a',
    silo:      '#9aa0a8',
    field:     '#5a4630',
    soil:      '#473524',
    penFill:   '#3c6e44',
    penFence:  '#caa86a',
    troughFeed:  '#caa05a',
    troughWater: '#3f86c4',
    chicken:   '#f0e3b0',
    cow:       '#e8e8e8',
    sheep:     '#dcdcdc',
    needHigh:  '#d6453a',  // tint target as a need approaches critical
    sick:      '#c24ad0',  // sick-animal marker
    npc:       '#ffd76a',
    cropWheat: '#d8c25a',
    cropCorn:  '#e0b94a',
    cropTomato:'#e0533a',
    cropSprout:'#7fc24a',
};

// Crop kind -> growth/water/value/spoilage stats, surfaced to render + sim.
//   growMul   growth-rate multiplier (lower = longer to mature)
//   dryMul    moisture-decay multiplier (higher = thirstier crop)
//   gold      sell value per harvested unit
//   spoilMs   once ripe, ms before it rots if left unharvested
export const CROP_KINDS = {
    wheat:   { color: '#d8c25a', label: 'Wheat',   gold: 4, growMul: 1.0, dryMul: 0.9, spoilMs: 28000 },
    corn:    { color: '#e0b94a', label: 'Corn',    gold: 5, growMul: 0.8, dryMul: 1.0, spoilMs: 25000 },
    tomato:  { color: '#e0533a', label: 'Tomato',  gold: 6, growMul: 0.9, dryMul: 1.3, spoilMs: 15000 },
    pumpkin: { color: '#e08a2a', label: 'Pumpkin', gold: 9, growMul: 0.6, dryMul: 1.1, spoilMs: 40000 },
    carrot:  { color: '#e0772a', label: 'Carrot',  gold: 5, growMul: 1.2, dryMul: 0.8, spoilMs: 20000 },
};
