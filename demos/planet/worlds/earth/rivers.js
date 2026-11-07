// Planet rivers: the drainage network (rivers.bk) built once at start on the
// GPU (riverbuild.bk): every lattice point's height; the fill, one step a
// dispatch, until the level water stands at has settled from the sea to the
// farthest point inland; each point's downstream neighbour; then the
// catchments, one step a dispatch, until the longest chain has settled; then
// each point's floor (the full ground's lowest along its reach), the water
// filled over the floors up every chain and breached the same way (no deeper
// than a gorge the land's relief allows, and filled again where a hollow
// needed more), the water falling along every chain, each point's tangent, the way its
// water runs through it, and each reach's lake level, its water lowered to
// the drained ground about its shore. The ground's kernels read the network's
// buffer; the CPU's (the camera's height) a copy of it.

const N = 512;               // rivers.bk RIV_N
const REC = 12;              // rivers.bk RIV_REC
const POINTS = 6 * N * N;
// Steps of the fills, the catchments and the breach: past the longest chain
// on a continent.
const STEPS = 1024;

// The network in `net` (a KernelBuffer the ground's kernels and hooks bind)
// and its copy in `cpu`, built in a background job (bro.kernel.background:
// between the frames, which go on meanwhile); the promise settles once it
// is done. rebuild() builds it again into both, in place and at once, for a
// module whose kernels changed (bro.kernel.reload).
export async function createRivers(module, radius, seed) {
    const net = bro.kernel.createBuffer(POINTS * REC * 4);
    const cpu = new Float32Array(POINTS * REC);
    const job = bro.kernel.background(() => buildInto(module, net, radius, seed));
    while (!job.done) await new Promise((resolve) => requestAnimationFrame(resolve));
    net.read(cpu);
    const rebuild = () => {
        buildInto(module, net, radius, seed);
        net.read(cpu);
    };
    return { net, cpu, rebuild };
}

function buildInto(module, net, radius, seed) {
    const grid = [N, N, 6];
    let src = bro.kernel.createBuffer(POINTS * 4), dst = bro.kernel.createBuffer(POINTS * 4);
    const swap = () => { [src, dst] = [dst, src]; };
    module.kernel('k_river_height').dispatch(grid, net, src, radius, seed);
    const fill = module.kernel('k_river_fill');
    for (let i = 0; i < STEPS; i++) { fill.dispatch(grid, net, src, dst); swap(); }
    module.kernel('k_river_down').dispatch(grid, net, src, seed);
    const step = module.kernel('k_river_catchment');
    src.write(new Float32Array(POINTS));
    for (let i = 0; i < STEPS; i++) { step.dispatch(grid, net, src, dst); swap(); }
    const catchment = src;
    const floor = bro.kernel.createBuffer(POINTS * 4), least = bro.kernel.createBuffer(POINTS * 4);
    module.kernel('k_river_floor').dispatch(grid, net, floor, least, radius, seed);
    let a = dst, b = bro.kernel.createBuffer(POINTS * 4);
    const rise = module.kernel('k_river_rise');
    rise.dispatch(grid, net, floor, floor, a);
    for (let i = 1; i < STEPS; i++) { rise.dispatch(grid, net, floor, a, b); [a, b] = [b, a]; }
    module.kernel('k_river_breach_start').dispatch(grid, floor, a, b);
    [a, b] = [b, a];
    const breach = module.kernel('k_river_breach');
    for (let i = 0; i < STEPS; i++) { breach.dispatch(grid, net, least, a, b); [a, b] = [b, a]; }
    // A hollow the breach could not drain (riverbuild.bk GORGE_MIN) fills
    // to its outlet: the water rises again up every chain over the
    // breached water, so it never climbs on its way down.
    const breached = a;
    a = least;
    rise.dispatch(grid, net, breached, breached, a);
    for (let i = 1; i < STEPS; i++) { rise.dispatch(grid, net, breached, a, b); [a, b] = [b, a]; }
    module.kernel('k_river_store').dispatch(grid, net, catchment, a, floor);
    module.kernel('k_river_tangent').dispatch(grid, net);
    module.kernel('k_river_lake').dispatch(grid, net, b, radius, seed);
    module.kernel('k_river_lake_store').dispatch(grid, net, b);
}
