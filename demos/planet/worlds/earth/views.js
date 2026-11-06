// Earth's view ladder (core/views.js runs it): the sites the look rounds
// were judged at (seed 7), a river in hill country, the M4 river (where the
// white rivers showed at dusk), a lake and the sea, on a scale ladder from
// eye height to orbit. Coordinates: `lat`, `lon` in radians; `alt` in
// metres above the surface or the sea; `pitch`, `heading` in degrees;
// `hour` a number, 'noon' (the sun highest over the site) or 'low' (8
// degrees up after noon, the camera turned to face it, for glints).
const SITES = {
    river: { lat: 0.4488, lon: -3.0869, heading: 0 },
    m4: { lat: 0.218244, lon: 0.48744, heading: -36.5 },
    lake: { lat: 0.30386, lon: -3.01224, heading: 0 },
    sea: { lat: 0.46627, lon: -3.05927, heading: 0 },
};
const at = (site, rest) => ({ ...SITES[site], ...rest });
const WIDE = [{ name: 'middle', x: 560, y: 380, w: 800, h: 400 }];
const LOW = [{ name: 'near', x: 560, y: 560, w: 800, h: 400 }, { name: 'far', x: 560, y: 200, w: 800, h: 300 }];

export const EARTH_VIEWS = [
    { name: 'orbit', description: 'the globe from 18000 km', lat: 0.45, lon: 0.30, alt: 1.8e7, pitch: -90, heading: 0, hour: 12, crops: WIDE },
    { name: 'continent', description: 'the river site from 800 km', ...at('river', { alt: 8e5, pitch: -27, hour: 'noon' }), crops: WIDE },
    { name: 'hills', description: 'the M4 hill country from 40 km', ...at('m4', { alt: 4e4, pitch: -45, hour: 'noon' }), crops: WIDE },
    { name: 'river-high', description: 'the river and its valley from 1.5 km', ...at('river', { alt: 1500, pitch: -22, hour: 'noon' }), crops: LOW },
    { name: 'river', description: 'the river from 300 m at noon', ...at('river', { alt: 300, pitch: -20, hour: 'noon' }), crops: LOW },
    { name: 'river-near', description: 'the river bank from 50 m', ...at('river', { alt: 50, pitch: -12, hour: 'noon' }), crops: LOW },
    { name: 'm4-dusk', description: 'the M4 river from 300 m at dusk (the white-river view)', ...at('m4', { alt: 300, pitch: -20, hour: 17.88 }), crops: LOW },
    { name: 'lake', description: 'the lake from 300 m', ...at('lake', { alt: 300, pitch: -20, hour: 'noon' }), crops: LOW },
    { name: 'sea-glint', description: 'the sea from 300 m facing a low sun', ...at('sea', { alt: 300, pitch: -20, hour: 'low' }), crops: LOW },
    { name: 'ground', description: 'the river site from eye height', ...at('river', { alt: 2, pitch: -6, hour: 'noon' }), crops: LOW },
];

export const EARTH_QUICK_VIEWS = ['orbit', 'river', 'm4-dusk'];
