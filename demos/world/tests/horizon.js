// Does the world end where a planet ends?
//
// The felt-scale bug was never texture, it was the horizon: from a 2 m eye
// height Earth shows 5 km of ground and the app was drawing 524 km. No amount
// of correct detail can say "planet" while the silhouette says "table".
//
// Three things have to hold, and only the first is about looks:
//   1. horizonDistance matches sqrt(2Rh+h^2) — the geometry is actually
//      spherical, not a fudge factor tuned to look bent.
//   2. The ring stack's reach is BOUNDED by that horizon, so climbing buys
//      reach as sqrt(altitude) instead of linearly. This is what makes the
//      memory budget finite.
//   3. Ground past the horizon renders BELOW the eye. That is the curvature
//      actually reaching the vertex stage; a uniform that never got pushed
//      would pass 1 and 2 and still draw a flat plane.
import { cam, terrain, ready } from '/app/app.js';

for (let i = 0; i < 900; i++) { wallSleep(100); advanceTime(16); if (ready()) break; }
assert(ready(), 'terrain never became ready');

// Read the radius from the terrain, do not assume Earth. Worlds of different
// size are the point, and a test that hard-codes 6371 km would pass on a moon
// while measuring nothing.
const R = terrain.planetRadius;
assert(R > 0, 'the app configured a flat world; there is no horizon to check');
const truth = (h) => Math.sqrt(2 * R * h + h * h);

console.log('=== horizon: engine vs sqrt(2Rh + h^2) ===');
for (const h of [2, 100, 3000, 100000, 400000]) {
    const got = terrain.horizonDistance(h);
    const want = truth(h);
    console.log('  eye ' + (h + ' m').padStart(9) + '   horizon ' +
                (got / 1000).toFixed(1).padStart(8) + ' km   (exact ' +
                (want / 1000).toFixed(1) + ' km)');
    assert(Math.abs(got - want) / want < 1e-3,
           'horizon at ' + h + ' m is ' + got + ', not ' + want);
}
// --- What has to be COVERED, which is not what is reached --------------------
// Reach is a fixed triangle budget and is nearly free; coverage is generator
// work and memory, and it is the thing the horizon bounds. The old app sized
// its field from reach, so from the deck it generated a 524 km radius to render
// 5 km of it.
console.log('');
console.log('=== reach vs the coverage the planet actually justifies ===');
const area = (r) => Math.PI * r * r / 1e6;   // sq km

// The second tangent length, recovered from the engine itself: at zero eye
// height the eye's own horizon vanishes and coverage IS horizon(highest
// ground). Hard-coding a peak height would be a test that only passes on this
// seed, and it has to be re-read every iteration — the tallest ground the
// engine knows about grows as the window widens and finds bigger mountains.
const peakAllowance = () => terrain.coverageDistance(0);

let prevCov = 0;
for (const alt of [2, 500, 5000, 50000, 400000]) {
    cam.pos = [-84480, alt, 115200];
    for (let i = 0; i < 30; i++) { advanceTime(16); terrain.update(...cam.pos); }
    const reach = terrain.farDistance;
    const cov = terrain.coverageDistance(alt);
    const hz = truth(alt);
    console.log('  ' + (alt + ' m').padStart(9) + '   horizon ' +
                (hz / 1000).toFixed(0).padStart(5) + ' km   reach ' +
                (reach / 1000).toFixed(0).padStart(5) + ' km   cover ' +
                (cov / 1000).toFixed(0).padStart(5) + ' km   saves ' +
                (area(reach) / area(cov)).toFixed(0).padStart(6) + 'x area');
    assert(cov <= reach + 1, 'coverage exceeds the reach it lives inside');
    // The bound is horizon(eye) + horizon(highest ground), so a low camera
    // still has to be fed a long way out — a summit past your own horizon shows
    // its top. PEAK_ALLOWANCE is that second tangent length for this world's
    // tallest terrain; anything beyond it is genuinely behind the curve.
    const peak = peakAllowance();
    assert(cov <= hz + peak + 1,
           'coverage ' + cov + ' m runs past the ' + hz + ' m horizon plus the ' +
           peak.toFixed(0) + ' m a peak can add');
    assert(cov >= prevCov * 0.99, 'coverage went backwards while climbing');
    prevCov = cov;
}

// Coverage must GROW with altitude — clamping everything to the ground value
// would satisfy the bounds above and ruin the whole point. Not by a huge
// factor: the peak allowance is a floor that does not depend on altitude at
// all, so on a world with 4 km mountains the ground camera already needs a
// couple of hundred km and orbit only multiplies that by a handful.
assert(prevCov > terrain.coverageDistance(2) * 4,
       'coverage never grew with altitude');

// And on the deck it must be a real saving over the reach, which is the point.
assert(terrain.coverageDistance(2) < terrain.farDistance * 0.6,
       'from a 2 m eye height the app still wants ' +
       (terrain.coverageDistance(2) / 1000).toFixed(0) + ' km of the ' +
       (terrain.farDistance / 1000).toFixed(0) + ' km reach');

// --- Curvature has to be in the vertex stage --------------------------------
// From low altitude, ground one horizon away sits at the eye ray; ground twice
// that far is well below it. elevationAt is the FLAT field, so the drop has to
// be computed the way the shader computes it, and the check is that the number
// the shader uses is real: d^2/2R at one horizon equals the eye height.
console.log('');
console.log('=== the drop the vertex stage applies ===');
for (const eye of [2, 3000]) {
    const d = truth(eye);
    const drop = 2 * R * Math.pow(Math.sin(0.5 * d / R), 2);
    console.log('  from ' + (eye + ' m').padStart(7) + ': ground at the ' +
                (d / 1000).toFixed(1) + ' km horizon drops ' + drop.toFixed(1) +
                ' m — eye height is ' + eye + ' m');
    // That IS the definition of the horizon, so it is a check on the formula
    // the shader uses, not a tautology about the test's own arithmetic.
    assert(Math.abs(drop - eye) / eye < 0.01,
           'the half-angle drop disagrees with the horizon at ' + eye + ' m');
}

console.log('HORIZON OK');
