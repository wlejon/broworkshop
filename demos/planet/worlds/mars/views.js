// Mars's view ladder (core/views.js runs it): the globe over Tharsis and
// the canyons, Valles Marineris, Olympus Mons, the cratered highlands, a
// canyon's wall from its floor, the dunes of Hellas's floor and of the
// polar erg, the north cap, and a rover's views of the ground, from orbit
// to eye height, most in the afternoon, when the sun's slant shows the
// relief. Coordinates: `lat`, `lon` in radians; `alt` in metres above the
// surface; `pitch`, `heading` in degrees; `hour` a number, 'noon', 'noon+h'
// or 'low' (core/views.js).
const D = Math.PI / 180;
const SITES = {
    tharsis: { lat: -5 * D, lon: -85 * D, heading: 0 },
    valles: { lat: -14.5 * D, lon: -78 * D, heading: 60 },
    olympus: { lat: 9 * D, lon: -134 * D, heading: 0 },
    highlands: { lat: -15 * D, lon: 45 * D, heading: 20 },
    melas: { lat: -9.6 * D, lon: -74 * D, heading: 0 },
    hellas: { lat: -42.4 * D, lon: 70.5 * D, heading: 30 },
    erg: { lat: 80.5 * D, lon: 160 * D, heading: 0 },
    north: { lat: 72 * D, lon: 10 * D, heading: 0 },
    rover: { lat: -4.6 * D, lon: 137.4 * D, heading: 150 },
};
const at = (site, rest) => ({ ...SITES[site], ...rest });
const WIDE = [{ name: 'middle', x: 560, y: 380, w: 800, h: 400 }];
const LOW = [{ name: 'near', x: 560, y: 560, w: 800, h: 400 }, { name: 'far', x: 560, y: 200, w: 800, h: 300 }];

export const MARS_VIEWS = [
    { name: 'orbit', description: 'the globe over Tharsis and the canyons from 9500 km', ...at('tharsis', { alt: 9.5e6, pitch: -90, hour: 'noon+1.5' }), crops: WIDE },
    { name: 'valles', description: 'Valles Marineris from 300 km', ...at('valles', { alt: 3e5, pitch: -30, hour: 'noon+3' }), crops: WIDE },
    { name: 'olympus', description: 'Olympus Mons from 400 km, south of it', ...at('olympus', { alt: 4e5, pitch: -30, hour: 'noon+3.5' }), crops: WIDE },
    { name: 'highlands', description: 'the cratered highlands of Terra Sabaea from 40 km', ...at('highlands', { alt: 4e4, pitch: -50, hour: 'noon+3' }), crops: WIDE },
    { name: 'canyon-wall', description: "Melas Chasma's north wall from 800 m over its floor", ...at('melas', { alt: 800, pitch: -6, hour: 'noon+2' }), crops: LOW },
    { name: 'hellas-dunes', description: "dunes on Hellas's floor from 1.5 km", ...at('hellas', { alt: 1500, pitch: -30, hour: 'noon+3' }), crops: LOW },
    { name: 'erg', description: 'the north polar erg from 2 km', ...at('erg', { alt: 2000, pitch: -25, hour: 'noon+3' }), crops: LOW },
    { name: 'north-cap', description: 'the north polar cap from 600 km', ...at('north', { alt: 6e5, pitch: -35, hour: 'noon+2' }), crops: WIDE },
    { name: 'rover-high', description: 'the rover site from 300 m', ...at('rover', { alt: 300, pitch: -18, hour: 'noon+2.5' }), crops: LOW },
    { name: 'rover-near', description: 'the rover site from 30 m', ...at('rover', { alt: 30, pitch: -12, hour: 'noon+2.5' }), crops: LOW },
    { name: 'rover', description: "a rover's panorama from eye height", ...at('rover', { alt: 2, pitch: -5, hour: 'noon+2.5' }), crops: LOW },
    { name: 'sunset', description: 'the rover site from eye height facing a low sun', ...at('rover', { alt: 2, pitch: 2, hour: 'low' }), crops: LOW },
];

export const MARS_QUICK_VIEWS = ['orbit', 'valles', 'rover'];
