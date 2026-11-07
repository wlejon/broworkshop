// What a world is: the folder worlds/<name>/ and its entry worlds/<name>.js,
// whose default export is the world's definition. The core (core/planet.js)
// draws whatever world it is given; app.js picks it (--world=<name>, Earth
// by default).
//
// The definition:
//   name          the folder's name
//   radius        metres
//   minHeight, maxHeight
//                 metres about the radius the drawn surface keeps within
//                 (the tile cache's culling bounds; the core's kernels clamp
//                 a tile's heights at minHeight, so a world whose sea stands
//                 at its floor gives the sea's level)
//   sunIntensity  the sun's lux above the air
//   atmosphere    scene.setAtmosphere's settings, less the planet's radius
//                 and centre (the core's)
//   noon          optional: the direction the sun's light travels at hour
//                 12, its tilt off the equator the season (core/hour.js)
//   exposure      optional: the auto exposure's compensation, stops (-0.6)
//   horizonReach  optional: metres the far plane reaches past the horizon
//                 of the lowest ground (else as far as the highest ground
//                 can stand up from behind it)
//   maxAltitude   optional: the camera's highest, metres (4.7 radii)
//   start         optional { lat, lon (radians), alt (m), heading, pitch
//                 (degrees) }: where the camera starts
//   views, quickViews
//                 its view ladder (core/views.js) and the names of its quick
//                 subset, the globe first
//   modules       { 'planet::world': source, ... }: its brokernel modules by
//                 name, which the core's kernels import (core/tiles.bk reads
//                 planet::world's octaves_for, range_margin, detail_ratio and
//                 surface_height; core/anchor.bk reads planet::world_lattice's
//                 LATTICES, lattice_skewed (simplex or grid), and
//                 lattice_point and lattice_point_near, where each of its
//                 lattices lies at a direction). The core's own modules
//                 (planet::noise, planet::anchor, planet::layers) are the
//                 world's to import, and its ground hook's planet::periodic
//                 (periodic noise at the hook's periodic coordinates).
//   create(core)  makes the world's half of the planet. `core` is
//                 { scene, modules (the core's and the world's, by name),
//                 kAnchors (the f64 anchor kernel), tile (the cache's layout,
//                 core/planet.js TILE_LAYOUT) }. It returns:
//     layers        the tile layers it adds, { name: bytes a cell }
//     ground        its part of the ground's hook (core/ground_mesh.bk):
//                   { layout: constants for planet::ground_layout (it must
//                   give DETAIL_PERIOD and FAR_PERIOD, the periods, powers
//                   of two, of the hook's periodic coordinates),
//                   params: its fields of the hook's uniform block,
//                   [[name, type]] after the core's cam_hi, cam_lo, to_sun,
//                   modules: the hook's modules by name, planet::world_ground
//                   among them: ground_sky (what stands between a vertex and
//                   the sun and sky), ground_vertex (its four varyings and
//                   a pair, planet::ground_core GroundVarying) and
//                   ground_fragment (the pixel's surface, calling
//                   planet::ground_core lit for the vertex's light) }
//     produce(batch, { cache, anchors, span, horizonHeights })
//                   fills a batch's tiles (core/layers.bk's formats): the
//                   position and detail layers, its own layers, the span
//                   and the horizon heights; the core runs the horizons,
//                   ranges and split errors after it
//     bindGround(ground, cache)
//                   binds its layers and buffers to the ground's hook, at
//                   each new cache
//     attach(ground)
//                   makes its systems, once the ground exists
//     surfaceHeight(dir)
//                   the drawn surface's height (m over the radius) under a
//                   unit direction, on the CPU
//     update(frame) per frame, after the core's camera and uniforms: frame
//                   is { pos, alt, surface, toSun, camHi, camLo, fwd, cone,
//                   view }
//     reload(changed, { redone, ms, refreshGround, coreChanged })
//                   after a hot reload: `changed` the kernels changed by
//                   root file name (brokernel keeps a module's file name
//                   alone, so a world's .bk files are named apart from the
//                   core's); it makes again what they feed
//     api           optional property descriptors' source: its handles
//                   on globalThis.planet (Earth's clouds, grass, trees,
//                   rivers)

const REQUIRED = ['name', 'radius', 'minHeight', 'maxHeight', 'sunIntensity', 'atmosphere', 'views', 'quickViews', 'modules', 'create'];

export function checkWorld(world) {
    for (const k of REQUIRED) {
        if (world[k] === undefined) throw new Error(`planet: the world ${world.name ?? '?'} has no ${k}`);
    }
    for (const m of ['planet::world', 'planet::world_lattice']) {
        if (!world.modules[m]) throw new Error(`planet: the world ${world.name} has no ${m} module`);
    }
}

// What create(core) returns must hold these.
export const WORLD_PARTS = ['layers', 'ground', 'produce', 'bindGround', 'attach', 'surfaceHeight', 'update', 'reload'];
