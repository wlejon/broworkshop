// Planet rivers: the drainage network (rivers.bk) built once at start on the
// GPU (riverbuild.bk): every lattice point's height; the fill, one step a
// dispatch, until the level water stands at has settled from the sea to the
// farthest point inland; each point's downstream neighbour; then the
// catchments, one step a dispatch, until the longest chain has settled; then
// each point's floor (the full ground's lowest along its reach), the water
// filled over the floors up every chain and breached the same way, the
// water falling along every chain, and each point's tangent, the way its
// water runs through it. The ground's kernels read the network's
// buffer; the CPU's (the camera's height) a copy of it.

const N = 512;               // rivers.bk RIV_N
const REC = 11;              // rivers.bk RIV_REC
const POINTS = 6 * N * N;
// Steps of the fills, the catchments and the breach: past the longest chain
// on a continent.
const STEPS = 1024;

export function createRivers(module, radius, seed) {
    const grid = [N, N, 6];
    const net = bro.kernel.createBuffer(POINTS * REC * 4);
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
    const floor = bro.kernel.createBuffer(POINTS * 4);
    module.kernel('k_river_floor').dispatch(grid, net, floor, radius, seed);
    let a = dst, b = bro.kernel.createBuffer(POINTS * 4);
    const rise = module.kernel('k_river_rise');
    rise.dispatch(grid, net, floor, floor, a);
    for (let i = 1; i < STEPS; i++) { rise.dispatch(grid, net, floor, a, b); [a, b] = [b, a]; }
    module.kernel('k_river_breach_start').dispatch(grid, floor, a, b);
    [a, b] = [b, a];
    const breach = module.kernel('k_river_breach');
    for (let i = 0; i < STEPS; i++) { breach.dispatch(grid, net, a, b); [a, b] = [b, a]; }
    module.kernel('k_river_store').dispatch(grid, net, catchment, a, floor);
    module.kernel('k_river_tangent').dispatch(grid, net);
    const cpu = net.read(new Float32Array(POINTS * REC));
    return { net, cpu };
}
