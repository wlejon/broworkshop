// =============================================================================
// THE PLANET DESCRIPTOR
//
// Everything that makes this world THIS world, in one object. Not a set of
// scattered constants: a planet is a thing you author, and worlds of different
// size and composition are the point — a moon is not a small Earth, it is a
// different radius, a different sea level and no snow line at all.
//
// It lives in its own module because it now has more than one consumer. The
// runtime app draws from it and tools/bake-planet.js generates from it, and the
// two MUST agree: a field baked for one radius describes a different planet than
// the one being drawn, and the mismatch is silent — the terrain simply stops
// lining up with the horizon. One definition, imported twice.
//
// This is also the object the world builder will edit and serialise. The app was
// written as its consumer first so the builder has something real to drive
// rather than a parallel implementation to keep in sync.
//
// RADIUS IS THE LOAD-BEARING FIELD. It sets the horizon, sqrt(2Rh+h^2), and
// therefore how far the world must be generated, held and drawn at every
// altitude. Earth's 6371 km shows 5 km of ground from a 2 m eye height; a
// 600 km moon shows 1.5 km and feels correspondingly small to stand on, which
// is the effect rather than a limitation. 0 means a flat, endless world.
//
// The elevation model was trained on Earth, so its landforms carry an implied
// scale. Putting them on a smaller planet is a deliberate choice (they read as
// oversized, which is what a small dense world SHOULD look like), not an
// accident to be corrected — but it is the reason radius and the generator's
// cell size are separate knobs.
// =============================================================================
export const PLANET = {
    name:   'earthlike',
    seed:   42,
    radius: 6371000,      // metres; 0 = flat world

    seaLevel:    0,       // metres; the model already puts sea level at 0
    heightScale: 1,       // sampled metres -> world metres; >1 exaggerates relief
    snowLine:    1700,    // metres; Infinity for a world with no snow

    // Structure below the data floor. detailRelief is a SLOPE, so it needs no
    // retuning when heightScale changes — see ClipmapConfig.
    detailWavelength: 48,
    detailRelief:     0.35,
    detailOctaves:    7,
};

// -----------------------------------------------------------------------------
// The global data chart.
//
// The generator is an infinite FLAT plane, and a sphere is not flat, so every
// possible atlas has seams. The question is only how many and how visible.
//
// Giving each cube-sphere face its own patch of the plane is the obvious
// arrangement and the worst one: six uncorrelated patches meet along 12 edges
// and 8 corners, and no blend repairs that, because the two sides are unrelated
// continents. Cross-fading them averages two coastlines into neither.
//
// So the DATA chart and the GEOMETRY chart are separated. Data is one connected
// equirectangular field — a single contiguous region of the generator, so it has
// no interior seams AT ALL. The cube-sphere's faces own no data; they sample
// this field by direction. The blending problem then exists exactly once instead
// of at every face boundary.
//
// Two edges remain, and both are closed at continental scale rather than hidden:
//
//   LONGITUDE. Column 0 and column W meet. A cross-fade WRAP_BAND cells wide
//   blends one into the other, the same construction setDetailExemplar uses to
//   make its patch periodic. At 7.68 km per cell a 200-cell band is 1500 km, so
//   the transition is the width of a continent and reads as geography.
//
//   POLES. An equirectangular chart collapses each polar row to a point, so a
//   row of varying terrain cannot be consistent there. Over POLE_BAND rows the
//   field converges to its own row mean, which makes the pole single-valued by
//   construction. 72 rows is 550 km of latitude.
//
// Cells get denser in longitude toward the poles, by cos(lat). That is wasted
// samples, not missing ones, so the poles are over-resolved rather than starved.
// -----------------------------------------------------------------------------
export const CHART = {
    wrapBand: 200,   // cells of longitude cross-fade
    poleBand: 72,    // rows over which each pole converges to its row mean
};

/// Equirectangular grid size for `radius`, at the generator's coarse cell.
/// Width spans a full circumference so the wrap is a true 360 degrees; height is
/// half of it, which is what makes a cell square at the equator.
export function chartSize(radius, cellSize) {
    const w = Math.max(8, Math.round((2 * Math.PI * radius) / cellSize));
    return { width: w, height: Math.max(4, Math.round(w / 2)) };
}
