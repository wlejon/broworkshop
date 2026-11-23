// lib/city/transit.js — tram lines: each through a sequence of the city's
// centres, along the shortest way over arterials and bridges (streets at a
// penalty), with stops about every STOP_EVERY metres along it.
//
// planLines(graph, centers, lines) -> [{ name, colour, steps: [{ edge, dir }],
//   stops: [{ step, s }], length }]
//   lines: [{ name, colour, via: [centre name, ...] }]
// A step is an edge travelled a -> b (dir 0) or b -> a (dir 1); a stop is at
// arc length s along its step's edge in that direction. The line runs out
// along its steps and back along them reversed (stops both ways).

const STOP_EVERY = 420;

export const LINES = [
    { name: '1', colour: [0.55, 0.06, 0.05], via: ['westgate', 'downtown', 'oldtown'] },
    { name: '2', colour: [0.05, 0.16, 0.42], via: ['northfield', 'midtown', 'downtown', 'harbor'] },
    { name: '3', colour: [0.06, 0.30, 0.12], via: ['eastside', 'oldtown', 'southeast'] },
    { name: '4', colour: [0.62, 0.44, 0.05], via: ['midtown', 'eastside'] },
];

function nearestNode(graph, x, z) {
    let best = -1, bd = Infinity;
    graph.nodes.forEach((n, i) => {
        if (!n.edges.some((ei) => graph.edges[ei].level === 0)) return;
        const d = Math.hypot(n.x - x, n.z - z);
        if (d < bd) { bd = d; best = i; }
    });
    return best;
}

/** Shortest path from node a to b: [{ edge, dir }], arterials preferred. */
function path(graph, a, b) {
    const N = graph.nodes.length;
    const dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
    dist[a] = 0;
    // A binary heap of [d, node].
    const heap = [[0, a]];
    const push = (it) => { heap.push(it); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => {
        const top = heap[0], last = heap.pop();
        if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } }
        return top;
    };
    while (heap.length) {
        const [d, u] = pop();
        if (d > dist[u]) continue;
        if (u === b) break;
        for (const ei of graph.nodes[u].edges) {
            const e = graph.edges[ei];
            const v = e.a === u ? e.b : e.a;
            const w = e.len * (e.level === 0 ? 1 : 3);
            if (d + w < dist[v]) { dist[v] = d + w; prev[v] = ei; push([d + w, v]); }
        }
    }
    if (!Number.isFinite(dist[b])) return null;
    const steps = [];
    for (let v = b; v !== a;) {
        const ei = prev[v], e = graph.edges[ei];
        const u = e.a === v ? e.b : e.a;
        steps.push({ edge: ei, dir: e.a === u ? 0 : 1 });
        v = u;
    }
    return steps.reverse();
}

export function planLines(graph, centers, lines = LINES) {
    const byName = new Map(centers.map((c) => [c.name, c]));
    const out = [];
    for (const L of lines) {
        const nodes = L.via.map((n) => { const c = byName.get(n); return nearestNode(graph, c.x, c.z); });
        let steps = [];
        let ok = true;
        for (let i = 0; i + 1 < nodes.length; i++) {
            const p = path(graph, nodes[i], nodes[i + 1]);
            if (!p) { ok = false; break; }
            steps = steps.concat(p);
        }
        if (!ok || !steps.length) continue;
        // Stops: every STOP_EVERY metres along, kept clear of the junctions.
        const stops = [];
        let run = STOP_EVERY * 0.5, length = 0;
        steps.forEach((st, si) => {
            const len = graph.edges[st.edge].len;
            length += len;
            if (graph.edges[st.edge].kind === 'bridge') { run += len; return; }
            for (let s = 25; s < len - 30; s += 5) {
                if (run + s >= STOP_EVERY) { stops.push({ step: si, s }); run = -s; break; }
            }
            run += len;
        });
        out.push({ name: L.name, colour: L.colour, steps, stops, length });
    }
    return out;
}

/** The set of edges any line runs on. */
export function tramEdges(lines) {
    const set = new Set();
    for (const l of lines) for (const st of l.steps) set.add(st.edge);
    return set;
}
