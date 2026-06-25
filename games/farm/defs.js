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
export const RATES = {
    hungerRise:   2.2,   // animal hunger climbs this fast when not eating
    thirstRise:   2.6,
    feedRate:     8.0,   // how fast a feeding animal pulls its need down
    troughDraw:   0.5,   // trough units consumed per need-point restored
    healthDecay:  4.0,   // health lost/s while a need is critical (>70)
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
    { id: 'pasture',   type: 'pen',       label: 'Cow Pasture',  penId: 'pasture', x0: 24, y0: 18, x1: 39, y1: 26 },
];

// Pen metadata: where each pen's two troughs sit, and which animals live there.
export const PENS = {
    coop: {
        penId: 'coop', label: 'Chicken Coop', good: 'eggs', goodLabel: 'Eggs', goldPerGood: 3,
        feedTrough:  { x: 25.0, y: 10.0 },
        waterTrough: { x: 29.0, y: 10.0 },
    },
    pasture: {
        penId: 'pasture', label: 'Cow Pasture', good: 'milk', goodLabel: 'Milk', goldPerGood: 6,
        feedTrough:  { x: 25.5, y: 19.0 },
        waterTrough: { x: 37.0, y: 19.0 },
    },
};

// Animal roster. Positions are starting tile centers; needs start mid-range
// so the pressure is visible quickly in a demo.
export const ANIMAL_SPECS = [
    { id: 'hen-1', kind: 'chicken', penId: 'coop', x: 26.5, y: 13.0, hunger: 30, thirst: 35 },
    { id: 'hen-2', kind: 'chicken', penId: 'coop', x: 28.5, y: 14.0, hunger: 25, thirst: 30 },
    { id: 'hen-3', kind: 'chicken', penId: 'coop', x: 27.0, y: 12.0, hunger: 40, thirst: 28 },
    { id: 'hen-4', kind: 'chicken', penId: 'coop', x: 29.0, y: 13.5, hunger: 22, thirst: 38 },
    { id: 'cow-1', kind: 'cow', penId: 'pasture', x: 28.0, y: 22.0, hunger: 35, thirst: 30 },
    { id: 'cow-2', kind: 'cow', penId: 'pasture', x: 33.0, y: 23.5, hunger: 45, thirst: 55 },
    { id: 'cow-3', kind: 'cow', penId: 'pasture', x: 31.0, y: 24.5, hunger: 28, thirst: 40 },
];

// Crop plots — fixed tile slots inside the 'field' region. Each is a soil bed
// that may hold one crop. Initial stage/growth/moisture vary to show variety.
export const CROP_PLOTS = [
    { id: 'plot-0', plotIndex: 0, x: 4.5,  y: 11.0, kind: 'wheat',  stage: 'ripe',    growth: 100, moisture: 40 },
    { id: 'plot-1', plotIndex: 1, x: 10.0, y: 11.0, kind: 'wheat',  stage: 'growing', growth: 60,  moisture: 55 },
    { id: 'plot-2', plotIndex: 2, x: 15.5, y: 11.0, kind: 'corn',   stage: 'seed',    growth: 8,   moisture: 70 },
    { id: 'plot-3', plotIndex: 3, x: 4.5,  y: 17.5, kind: 'corn',   stage: 'growing', growth: 35,  moisture: 20 },
    { id: 'plot-4', plotIndex: 4, x: 10.0, y: 17.5, kind: null,     stage: 'empty',   growth: 0,   moisture: 0  },
    { id: 'plot-5', plotIndex: 5, x: 15.5, y: 17.5, kind: 'tomato', stage: 'ripe',    growth: 100, moisture: 60 },
    { id: 'plot-6', plotIndex: 6, x: 4.5,  y: 24.0, kind: 'tomato', stage: 'growing', growth: 75,  moisture: 50 },
    { id: 'plot-7', plotIndex: 7, x: 10.0, y: 24.0, kind: null,     stage: 'empty',   growth: 0,   moisture: 0  },
    { id: 'plot-8', plotIndex: 8, x: 15.5, y: 24.0, kind: 'wheat',  stage: 'seed',    growth: 3,   moisture: 80 },
];

// NPC workers. role/voice are carried now but UNUSED in this pass — the agent
// layer (Pass 2) reads them. home is the tile they gently wander around.
export const NPC_SPECS = [
    { id: 'npc-mara', name: 'Mara', role: 'rancher',  voice: 'warm',   home: { x: 20, y: 20 } },
    { id: 'npc-tom',  name: 'Tom',  role: 'farmhand', voice: 'gruff',  home: { x: 12, y: 8  } },
    { id: 'npc-lily', name: 'Lily', role: 'gardener', voice: 'bright', home: { x: 6,  y: 16 } },
];

// Starting resource pools.
export const START_RESOURCES = { feed: 200, water: 200, gold: 50, eggs: 0, milk: 0, crops: 0 };

// Starting trough fill levels (0..100). Some start low so alerts/pressure
// appear within the first demo seconds.
export const START_TROUGHS = {
    'coop-feed': 75, 'coop-water': 40,
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
    needHigh:  '#d6453a',  // tint target as a need approaches critical
    npc:       '#ffd76a',
    cropWheat: '#d8c25a',
    cropCorn:  '#e0b94a',
    cropTomato:'#e0533a',
    cropSprout:'#7fc24a',
};

// Crop kind -> harvested-good color/label, for the silo storage tally.
export const CROP_KINDS = {
    wheat:  { color: '#d8c25a', label: 'Wheat',  gold: 4 },
    corn:   { color: '#e0b94a', label: 'Corn',   gold: 5 },
    tomato: { color: '#e0533a', label: 'Tomato', gold: 6 },
};
