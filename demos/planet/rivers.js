// Planet rivers: the drainage network (rivers.bk) built once at start on the
// GPU (riverbuild.bk): every lattice point's height; the fill, one step a
// dispatch, until the level water stands at has settled from the sea to the
// farthest point inland; each point's downstream neighbour; then the
// catchments, one step a dispatch, until the longest chain has settled, and
// the breach the same way, the levels falling along every chain. The
// ground's kernels read the network's buffer; the CPU's (the camera's
// height) a copy of it.

const N = 512;               // rivers.bk RIV_N
const REC = 8;               // rivers.bk RIV_REC
const POINTS = 6 * N * N;
// Steps of the fill and of the catchments: past the longest chain on a
// continent.
const STEPS = 1024;
// Steps of a lake's fall to its outlet: past the longest chain across a lake.
const LAKE_STEPS = 256;

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
    let a = dst, b = bro.kernel.createBuffer(POINTS * 4);
    module.kernel('k_river_breach_start').dispatch(grid, net, a);
    const breach = module.kernel('k_river_breach');
    for (let i = 0; i < STEPS; i++) { breach.dispatch(grid, net, a, b); [a, b] = [b, a]; }
    const lake = module.kernel('k_river_lake');
    for (let i = 0; i < LAKE_STEPS; i++) { lake.dispatch(grid, net, a, b); [a, b] = [b, a]; }
    module.kernel('k_river_store').dispatch(grid, net, catchment, a);
    const cpu = net.read(new Float32Array(POINTS * REC));
    return { net, cpu };
}
