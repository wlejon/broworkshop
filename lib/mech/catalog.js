// lib/mech/catalog.js — what a mech is made of, as scaling laws.
//
// Nothing here is an item with fixed numbers. A structural material, an armour
// material, an actuator and every module is a family: the designer gives it a
// size and a place, and what it does follows from its volume, the area of the
// face it shows through the hull, and how deep it runs behind that face.
// Units are SI except where a name says otherwise: power and heat in MW,
// stored energy in MJ, flows of fuel and ammunition in kg/s.

import { clamp } from "./vec.js";

/** Edge of a bay cell, metres. A module is a box of whole cells. */
export const CELL = 1.5;
/** How far the bay sits in from the hull's outer faces (frame and skin), metres. */
export const WALL = 0.4;
export const G = 9.81;

// --- what the frame is built from ----------------------------------------------

// rho kg/m3, sigma Pa (what a section yields at).
export const STRUCTURE = {
    steel:     { label: 'Steel',     rho: 7850, sigma: 620e6, note: 'cheap strength, heavy' },
    titanium:  { label: 'Titanium',  rho: 4500, sigma: 830e6, note: 'the same strength at 60% of the weight' },
    composite: { label: 'Composite', rho: 1750, sigma: 560e6, note: 'a third of the weight; shatters where steel bends' },
};
/** Skin thickness of a frame at gauge 1, metres, and what ribs and stringers add to it. */
export const FRAME_SKIN = 0.012;
export const FRAME_RIBS = 1.0;

// kinetic / energy: how many mm of steel one mm of it is worth against each.
export const ARMOR = {
    steel:    { label: 'Steel plate', rho: 7850, kinetic: 1.0, energy: 1.0, color: [0.62, 0.64, 0.66] },
    laminate: { label: 'Laminate',    rho: 3300, kinetic: 0.8, energy: 0.9, color: [0.55, 0.58, 0.62] },
    ceramic:  { label: 'Ceramic',     rho: 3700, kinetic: 1.7, energy: 0.7, color: [0.78, 0.76, 0.70] },
    ablative: { label: 'Ablative',    rho: 1500, kinetic: 0.3, energy: 2.2, color: [0.34, 0.33, 0.32] },
};

// mass kg per MN m of rated torque, rate rad/s at rated torque, eff: the share
// of the power drawn that becomes motion (the rest is heat).
export const ACTUATOR = {
    hydraulic: { label: 'Hydraulic ram',  mass: 120, rate: 1.0, eff: 0.70, note: 'most torque for the weight; slow' },
    electric:  { label: 'Electric drive', mass: 190, rate: 2.2, eff: 0.90, note: 'fast and cool; heavy' },
    myomer:    { label: 'Myomer bundle',  mass: 65,  rate: 3.4, eff: 0.50, note: 'light and very fast; half its power is heat' },
};
/** How much of rating x rate a working actuator averages. */
export const ACTUATOR_DUTY = 0.2;

// --- the lines that run through the frame --------------------------------------

// mass: kg per unit of capacity per metre of run.
export const LINES = {
    power:   { label: 'Power',   unit: 'MW',   mass: 0.6,  color: [1.0, 0.78, 0.18] },
    coolant: { label: 'Coolant', unit: 'MW',   mass: 1.0,  color: [0.25, 0.75, 1.0] },
    fuel:    { label: 'Fuel',    unit: 'kg/s', mass: 0.5,  color: [1.0, 0.42, 0.16] },
    ammo:    { label: 'Feed',    unit: 'kg/s', mass: 2.0,  color: [0.80, 0.80, 0.42] },
    data:    { label: 'Control', unit: 'ch',   mass: 6,    color: [0.55, 1.0, 0.55] },
};
export const LINE_KINDS = Object.keys(LINES);

/** What a hull sheds to the air through its own skin, MW per m2. */
export const HULL_COOLING = 0.004;

// --- how hard each system works, by what the mech is doing ----------------------

// jets: null is the throttle setting that holds the machine in the air, 1 is
// every engine open, and a fraction is that much of the hover setting.
export const REGIMES = {
    stand:  { label: 'Stand',   legs: 0.05, arms: 0.05, jets: 0,    weapons: 0 },
    walk:   { label: 'Walk',    legs: 0.35, arms: 0.10, jets: 0,    weapons: 0 },
    sprint: { label: 'Sprint',  legs: 1.00, arms: 0.20, jets: 0,    weapons: 0 },
    hover:  { label: 'Hover',   legs: 0.05, arms: 0.10, jets: null, weapons: 0 },
    burn:   { label: 'Full burn', legs: 0.05, arms: 0.10, jets: 1,  weapons: 0 },
    fire:   { label: 'All guns', legs: 0.05, arms: 0.30, jets: 0,   weapons: 1 },
    combat: { label: 'Combat',  legs: 0.60, arms: 0.50, jets: 0.5,  weapons: 0.60 },
};
export const REGIME_KEYS = Object.keys(REGIMES);

// --- modules -------------------------------------------------------------------

const t = (kg) => (kg >= 1000 ? (kg / 1000).toFixed(kg >= 100000 ? 0 : 1) + ' t' : kg.toFixed(0) + ' kg');
const mw = (v) => (v >= 1000 ? (v / 1000).toFixed(2) + ' GW' : v.toFixed(v >= 100 ? 0 : 1) + ' MW');
const mn = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + ' MN' : (n / 1e3).toFixed(0) + ' kN');
export const fmt = { t, mw, mn };

// How much of its rated thrust a jet of length L behind a nozzle of area A
// makes: a short engine behind a wide mouth is a poor one.
const slender = (g) => clamp(g.L / (1.4 * Math.sqrt(g.A)), 0.45, 1.2);

// spec(g, opts): g = { size: [a, b, c] m, V m3, A m2 of the shown face, L m behind it }.
export const MODULES = {
    'reactor.fusion': {
        label: 'Fusion core', group: 'Power', color: [0.30, 0.85, 1.0], min: [2, 2, 2], volatile: true,
        note: 'Power for no fuel, and the bigger the core the more each cubic metre makes. A breached core is a bomb.',
        spec(g) {
            const p = 5 * g.V * Math.pow(g.V / 60, 0.2);
            return {
                mass: 2400 * g.V, supply: { power: p }, drive: 'gen',
                demand: { coolant: [0.04 * p, 0.18 * p], data: [2, 0] },
                stats: [['output', mw(p)], ['waste heat', mw(0.22 * p)]],
            };
        },
    },
    'reactor.fission': {
        label: 'Fission pile', group: 'Power', color: [0.45, 0.95, 0.45], min: [2, 2, 2],
        note: 'Less than half a fusion core\'s power for its size and half again the weight, but it fails safe.',
        spec(g) {
            const p = 2.2 * g.V;
            return {
                mass: 3600 * g.V, supply: { power: p }, drive: 'gen',
                demand: { coolant: [0.10 * p, 0.12 * p], data: [1, 0] },
                stats: [['output', mw(p)], ['waste heat', mw(0.22 * p)]],
            };
        },
    },
    'gen.turbine': {
        label: 'Gas turbine', group: 'Power', color: [0.95, 0.62, 0.25], min: [1, 2, 1], surface: 'exhaust',
        note: 'Light power that drinks from the same tanks as the jets. Needs a face to breathe through.',
        spec(g) {
            const p = 3.5 * g.V;
            return {
                mass: 700 * g.V, supply: { power: p }, drive: 'gen',
                demand: { fuel: [0, 0.055 * p], coolant: [0, 0.08 * p], data: [1, 0] },
                stats: [['output', mw(p)], ['burns', (0.055 * p).toFixed(1) + ' kg/s at full load']],
            };
        },
    },
    'cap': {
        label: 'Capacitor bank', group: 'Power', color: [0.95, 0.90, 0.30], min: [1, 1, 1], volatile: true,
        note: 'Stored power for what the generators cannot hold up: a salvo, a burn.',
        spec(g) {
            return { mass: 1100 * g.V, store: { power: 60 * g.V }, stats: [['stores', (60 * g.V).toFixed(0) + ' MJ']] };
        },
    },
    'tank': {
        label: 'Propellant tank', group: 'Propellant', color: [0.95, 0.45, 0.20], min: [1, 1, 1], volatile: true,
        note: 'Fuel for jets and turbines. Counted full: this is weight you carry into the fight.',
        spec(g) {
            const kg = 720 * g.V;
            return { mass: 60 * g.V + kg, store: { fuel: kg }, stats: [['holds', t(kg)]] };
        },
    },
    'radiator': {
        label: 'Radiator', group: 'Thermal', color: [0.20, 0.55, 0.95], min: [1, 1, 1], surface: 'panel',
        note: 'Sheds heat by the area it shows. No plate covers it: every radiator is a hole in the armour.',
        spec(g) {
            const c = 4 * g.A;
            return { mass: 250 * g.A + 120 * g.V, supply: { coolant: c }, stats: [['sheds', mw(c)], ['face', g.A.toFixed(0) + ' m2']] };
        },
    },
    'sink': {
        label: 'Heat sink', group: 'Thermal', color: [0.35, 0.42, 0.85], min: [1, 1, 1],
        note: 'Soaks up what the radiators cannot shed, until it is full.',
        spec(g) {
            return { mass: 1900 * g.V, store: { coolant: 300 * g.V }, stats: [['soaks', (300 * g.V).toFixed(0) + ' MJ']] };
        },
    },
    'cockpit': {
        label: 'Cockpit', group: 'Control', color: [1.0, 0.95, 0.75], min: [2, 2, 2], unique: true,
        note: 'The pilot. Lose it and the fight is over, so where it sits is the first decision.',
        spec(g) {
            return {
                mass: 900 * g.V, supply: { data: 6 + Math.floor(g.V / 4) }, drive: 'always',
                demand: { power: [0.5, 0], coolant: [0.3, 0] },
                stats: [['control', (6 + Math.floor(g.V / 4)) + ' ch']],
            };
        },
    },
    'computer': {
        label: 'Control core', group: 'Control', color: [0.55, 0.95, 0.60], min: [1, 1, 1],
        note: 'Channels for joints, jets and weapons to be commanded through.',
        spec(g) {
            const ch = Math.floor(3 * g.V);
            return {
                mass: 500 * g.V, supply: { data: ch }, drive: 'always',
                demand: { power: [0.15 * g.V, 0], coolant: [0.15 * g.V, 0] },
                stats: [['control', ch + ' ch']],
            };
        },
    },
    'gyro': {
        label: 'Gyro', group: 'Control', color: [0.80, 0.55, 0.95], min: [1, 1, 1],
        note: 'Torque with nothing to push against: holds the machine level when thrust does not pass through its centre.',
        spec(g) {
            const tq = 1.5e6 * g.V;
            return {
                mass: 2800 * g.V, gyro: tq, drive: 'jets',
                demand: { power: [0.02 * g.V, 0.3 * g.V], data: [1, 0] },
                stats: [['torque', (tq / 1e6).toFixed(0) + ' MN m']],
            };
        },
    },
    'sensor': {
        label: 'Sensor array', group: 'Control', color: [0.95, 0.95, 0.95], min: [1, 1, 1], surface: 'sensor',
        note: 'Sees as far as its aperture is wide.',
        spec(g) {
            const km = 4 * Math.sqrt(g.A);
            return {
                mass: 300 * g.V, sensor: km, drive: 'always',
                demand: { power: [0.05 * g.A, 0], data: [1, 0] },
                stats: [['range', km.toFixed(1) + ' km']],
            };
        },
    },
    'jet.turbofan': {
        label: 'Turbofan', group: 'Propulsion', color: [0.75, 0.80, 0.86], min: [2, 2, 2], surface: 'nozzle',
        opts: { gimbal: { label: 'gimbal', min: 0, max: 30, step: 1, def: 8, unit: '°' } },
        note: 'The standard lift engine: modest thrust for its mouth, but it sips fuel. Slow to spool.',
        spec(g, o) {
            const f = 1150e3 * g.A * slender(g);
            return {
                mass: 800 * g.V * (1 + (o.gimbal || 0) / 60), thrust: f, gimbal: o.gimbal || 0, spool: 2.2, drive: 'jets',
                demand: { fuel: [0, 0.011 * f / 1e3], coolant: [0, 0.001 * f / 1e3], power: [0, 0.0006 * f / 1e3], data: [2, 0] },
                stats: [['thrust', mn(f)], ['burns', (0.011 * f / 1e3).toFixed(0) + ' kg/s']],
            };
        },
    },
    'jet.rocket': {
        label: 'Rocket', group: 'Propulsion', color: [0.95, 0.35, 0.25], min: [1, 1, 1], surface: 'nozzle',
        opts: { gimbal: { label: 'gimbal', min: 0, max: 30, step: 1, def: 5, unit: '°' } },
        note: 'Three times a turbofan\'s thrust from the same mouth, at once, for thirty times the fuel.',
        spec(g, o) {
            const f = 3000e3 * g.A * slender(g);
            return {
                mass: 450 * g.V * (1 + (o.gimbal || 0) / 60), thrust: f, gimbal: o.gimbal || 0, spool: 0.1, drive: 'jets',
                demand: { fuel: [0, 0.30 * f / 1e3], coolant: [0, 0.0005 * f / 1e3], data: [2, 0] },
                stats: [['thrust', mn(f)], ['burns', (0.30 * f / 1e3).toFixed(0) + ' kg/s']],
            };
        },
    },
    'jet.plasma': {
        label: 'Plasma thruster', group: 'Propulsion', color: [0.65, 0.45, 1.0], min: [1, 2, 1], surface: 'nozzle',
        opts: { gimbal: { label: 'gimbal', min: 0, max: 30, step: 1, def: 12, unit: '°' } },
        note: 'Thrust from the reactor instead of the tanks. It never runs dry, and it never stops heating you.',
        spec(g, o) {
            const f = 1700e3 * g.A * slender(g);
            return {
                mass: 1500 * g.V * (1 + (o.gimbal || 0) / 60), thrust: f, gimbal: o.gimbal || 0, spool: 0.4, drive: 'jets',
                demand: { power: [0, 0.055 * f / 1e3], coolant: [0, 0.006 * f / 1e3], data: [2, 0] },
                stats: [['thrust', mn(f)], ['draws', mw(0.055 * f / 1e3)]],
            };
        },
    },
    'gun.autocannon': {
        label: 'Autocannon', group: 'Weapons', color: [0.70, 0.66, 0.55], min: [1, 2, 1], surface: 'muzzle',
        note: 'Bore from the face, velocity from the length. Eats ammunition and kicks.',
        spec(g) {
            const d = 0.22 * Math.sqrt(g.A);                    // bore, m
            const shell = 5200 * d * d * d;                     // kg
            const v = Math.min(1900, 520 + 85 * g.L);
            const rof = 0.25 / Math.pow(d, 1.2);
            const ke = 0.5 * shell * v * v / 1e6;               // MJ
            return {
                mass: 1300 * g.V, drive: 'weapons',
                demand: { ammo: [0, shell * 1.5 * rof], coolant: [0, 0.04 * ke * rof], power: [0, 0.3], data: [2, 0] },
                weapon: { kind: 'kinetic', damage: ke, rof, velocity: v, recoil: shell * v * rof },
                stats: [['bore', (d * 1000).toFixed(0) + ' mm'], ['shell', shell.toFixed(0) + ' kg at ' + v.toFixed(0) + ' m/s'],
                        ['rate', (rof * 60).toFixed(0) + ' /min'], ['on target', mw(ke * rof)]],
            };
        },
    },
    'gun.rail': {
        label: 'Railgun', group: 'Weapons', color: [0.45, 0.70, 0.95], min: [1, 3, 1], surface: 'muzzle',
        note: 'One slug at a time, as hard as its volume of capacitors and as fast as its rails are long. Needs no magazine, only power.',
        spec(g) {
            const e = 25 * g.V * clamp(g.L / 9, 0.5, 1.6);       // MJ a shot
            const rof = 0.25;
            const v = Math.min(6500, 950 * Math.sqrt(g.L));
            const draw = e * rof / 0.4;
            return {
                mass: 1700 * g.V, drive: 'weapons',
                demand: { power: [0, draw], coolant: [0, 0.6 * draw], data: [3, 0] },
                weapon: { kind: 'kinetic', damage: e, rof, velocity: v, recoil: 2 * e * 1e6 / v * rof },
                stats: [['shot', e.toFixed(0) + ' MJ at ' + (v / 1000).toFixed(1) + ' km/s'], ['draws', mw(draw)], ['on target', mw(e * rof)]],
            };
        },
    },
    'beam.laser': {
        label: 'Laser', group: 'Weapons', color: [1.0, 0.35, 0.45], min: [1, 1, 1], surface: 'lens',
        note: 'No ammunition, no recoil, no travel time. Seven tenths of what it draws stays in the machine as heat.',
        spec(g) {
            const draw = 16 * g.V;
            return {
                mass: 1000 * g.V, drive: 'weapons',
                demand: { power: [0, draw], coolant: [0, 0.7 * draw], data: [2, 0] },
                weapon: { kind: 'energy', damage: 0.3 * draw, rof: 1, velocity: Infinity, recoil: 0, range: 600 * Math.sqrt(g.A) },
                stats: [['beam', mw(0.3 * draw)], ['draws', mw(draw)], ['focus to', (600 * Math.sqrt(g.A)).toFixed(0) + ' m']],
            };
        },
    },
    'rack.missile': {
        label: 'Missile rack', group: 'Weapons', color: [0.85, 0.80, 0.70], min: [1, 2, 1], surface: 'tubes',
        note: 'A tube for every 1.2 m2 of face. Fires its whole face at once, then waits on the feed.',
        spec(g) {
            const tubes = Math.max(1, Math.floor(g.A / 1.2));
            const reload = 8;
            return {
                mass: 400 * g.V + tubes * 250, drive: 'weapons',
                demand: { ammo: [0, tubes * 250 / reload], power: [0, 0.2], data: [2 + Math.ceil(tubes / 8), 0] },
                weapon: { kind: 'explosive', damage: tubes * 250, rof: 1 / reload, velocity: 400, recoil: 0, salvo: tubes },
                stats: [['tubes', String(tubes)], ['salvo', (tubes * 0.25).toFixed(1) + ' t of missiles every ' + reload + ' s']],
            };
        },
    },
    'ammo': {
        label: 'Magazine', group: 'Weapons', color: [0.75, 0.70, 0.35], min: [1, 1, 1], volatile: true,
        note: 'Shells and missiles for whatever the feed lines reach. It burns if it is hit.',
        spec(g) {
            const kg = 1500 * g.V;
            return { mass: 150 * g.V + kg, store: { ammo: kg }, stats: [['holds', t(kg)]] };
        },
    },
};

export const MODULE_GROUPS = ['Power', 'Propellant', 'Thermal', 'Control', 'Propulsion', 'Weapons'];
