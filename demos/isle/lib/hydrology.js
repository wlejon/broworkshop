// hydrology.js — flow-accumulation and distance transform functions.

export function computeHydrology(elev, W, H) {
    const len = W * H;
    const flow = new Float32Array(len);
    flow.fill(1.0); // each cell starts with 1 unit of rainfall

    // Sort cells by elevation descending
    const indices = new Int32Array(len);
    for (let i = 0; i < len; i++) indices[i] = i;
    indices.sort((a, b) => elev[b] - elev[a]);

    // D8 directions
    const dx = [0, 1, 1, 1, 0, -1, -1, -1];
    const dy = [-1, -1, 0, 1, 1, 1, 0, -1];

    for (let idx = 0; idx < len; idx++) {
        const p = indices[idx];
        const px = p % W;
        const pz = Math.floor(p / W);
        const h = elev[p];

        // Find steepest descent neighbor
        let bestDir = -1;
        let maxSlope = 0;
        for (let dir = 0; dir < 8; dir++) {
            const nx = px + dx[dir];
            const nz = pz + dy[dir];
            if (nx >= 0 && nx < W && nz >= 0 && nz < H) {
                const np = nz * W + nx;
                const nh = elev[np];
                const dist = (dir % 2 === 0) ? 1.0 : 1.414;
                const slope = (h - nh) / dist;
                if (slope > maxSlope) {
                    maxSlope = slope;
                    bestDir = dir;
                }
            }
        }

        if (bestDir !== -1) {
            const nx = px + dx[bestDir];
            const nz = pz + dy[bestDir];
            const np = nz * W + nx;
            flow[np] += flow[p];
        }
    }

    return flow;
}

export function computeCoastDistance(elev, W, H, mpc) {
    const dist = new Float32Array(W * H);
    dist.fill(Infinity);
    const queue = [];
    
    // Enqueue all sea cells (elevation < 0)
    for (let i = 0; i < W * H; i++) {
        if (elev[i] < 0) {
            dist[i] = 0;
            queue.push(i);
        }
    }
    
    const dx = [0, 1, 0, -1];
    const dy = [-1, 0, 1, 0];
    let head = 0;
    while (head < queue.length) {
        const p = queue[head++];
        const px = p % W;
        const pz = Math.floor(p / W);
        const d = dist[p];
        
        for (let i = 0; i < 4; i++) {
            const nx = px + dx[i];
            const nz = pz + dy[i];
            if (nx >= 0 && nx < W && nz >= 0 && nz < H) {
                const np = nz * W + nx;
                if (dist[np] === Infinity) {
                    dist[np] = d + mpc;
                    queue.push(np);
                }
            }
        }
    }
    
    // For cells that never reached (e.g. completely landlocked high-res bakes without sea),
    // fill with max distance
    for (let i = 0; i < W * H; i++) {
        if (dist[i] === Infinity) {
            dist[i] = W * mpc;
        }
    }
    
    return dist;
}
