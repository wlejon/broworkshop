// lib/city/generate.js — the whole city from a site, deterministically:
// field -> streets -> road graph -> the roads' ground -> lots (on the graded
// ground) -> buildings -> the blocks' surfaces.

import { buildField } from "./field.js";
import { traceStreets } from "./streets.js";
import { buildGraph } from "./graph.js";
import { placeLots } from "./lots.js";
import { buildMasses } from "./buildings.js";
import { packRoads, packSurfaces, gradedHeight } from "./ground.js";
import { planLines, tramEdges } from "./transit.js";

export function generateCity(site, opts = {}) {
    const t = {};
    let t0 = perf.now();
    const field = buildField(site);
    t.field = perf.now() - t0; t0 = perf.now();
    const lines0 = traceStreets(field, { fixedRoads: site.shoreRoads ? site.shoreRoads(field) : [], ...opts.streets });
    t.streets = perf.now() - t0; t0 = perf.now();
    const graph = buildGraph(lines0, field, { waterY: site.waterY ?? 0, ...opts.graph });
    t.graph = perf.now() - t0; t0 = perf.now();
    // Tram lines between the centres, their rails in the roads.
    const lines = site.centers ? planLines(graph, site.centers, opts.lines) : [];
    const ground = packRoads(graph, { half: site.half, tramEdges: tramEdges(lines) });
    const graded = (x, z) => gradedHeight(ground, site.height, x, z);
    t.ground = perf.now() - t0; t0 = perf.now();
    const lots = placeLots(graph, field, { height: graded, isPark: site.isPark, isIndustrial: site.isIndustrial, ...opts.lots });
    t.lots = perf.now() - t0; t0 = perf.now();
    const masses = buildMasses(lots, field);
    packSurfaces(ground, graph);
    t.masses = perf.now() - t0;
    return { field, streetLines: lines0, graph, ground, graded, lots, masses, transit: lines, timings: t };
}
