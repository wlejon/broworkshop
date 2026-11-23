// lib/city/generate.js — the whole city from a site, deterministically:
// field -> streets -> road graph (-> lots -> buildings, see lots.js / buildings.js).

import { buildField } from "./field.js";
import { traceStreets } from "./streets.js";
import { buildGraph } from "./graph.js";
import { placeLots } from "./lots.js";
import { buildMasses } from "./buildings.js";

export function generateCity(site, opts = {}) {
    const t = {};
    let t0 = perf.now();
    const field = buildField(site);
    t.field = perf.now() - t0; t0 = perf.now();
    const lines = traceStreets(field, { fixedRoads: site.shoreRoads ? site.shoreRoads(field) : [], ...opts.streets });
    t.streets = perf.now() - t0; t0 = perf.now();
    const graph = buildGraph(lines, field, { waterY: site.waterY ?? 0, ...opts.graph });
    t.graph = perf.now() - t0; t0 = perf.now();
    const lots = placeLots(graph, field, { isPark: site.isPark, isIndustrial: site.isIndustrial, ...opts.lots });
    t.lots = perf.now() - t0; t0 = perf.now();
    const masses = buildMasses(lots, field);
    t.masses = perf.now() - t0;
    return { field, lines, graph, lots, masses, timings: t };
}
