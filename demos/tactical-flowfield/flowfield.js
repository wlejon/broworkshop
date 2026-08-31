// flowfield.js — High-performance grid-based Cost, Integration, and Vector Direction Fields.
// Supports multi-goal wavefront propagation (Dijkstra-Eikonal) with 8-directional smooth gradients.

export const TERRAIN = {
    OPEN: 1,
    ROUGH: 5,
    IMPASSABLE: 255
};

export class PriorityQueue {
    constructor() {
        this.heap = [];
    }

    push(val, priority) {
        this.heap.push({ val, priority });
        this._bubbleUp(this.heap.length - 1);
    }

    pop() {
        if (this.heap.length === 0) return null;
        const top = this.heap[0];
        const bottom = this.heap.pop();
        if (this.heap.length > 0) {
            this.heap[0] = bottom;
            this._sinkDown(0);
        }
        return top.val;
    }

    size() {
        return this.heap.length;
    }

    isEmpty() {
        return this.heap.length === 0;
    }

    _bubbleUp(index) {
        const item = this.heap[index];
        while (index > 0) {
            const parentIdx = (index - 1) >> 1;
            const parent = this.heap[parentIdx];
            if (item.priority >= parent.priority) break;
            this.heap[index] = parent;
            index = parentIdx;
        }
        this.heap[index] = item;
    }

    _sinkDown(index) {
        const len = this.heap.length;
        const item = this.heap[index];
        const halfLen = len >> 1;

        while (index < halfLen) {
            let leftIdx = (index << 1) + 1;
            let rightIdx = leftIdx + 1;
            let bestIdx = leftIdx;
            let bestPriority = this.heap[leftIdx].priority;

            if (rightIdx < len && this.heap[rightIdx].priority < bestPriority) {
                bestIdx = rightIdx;
                bestPriority = this.heap[rightIdx].priority;
            }

            if (item.priority <= bestPriority) break;
            this.heap[index] = this.heap[bestIdx];
            index = bestIdx;
        }
        this.heap[index] = item;
    }
}

export class FlowField {
    constructor(cols = 128, rows = 72, cellSize = 10) {
        this.cols = cols;
        this.rows = rows;
        this.cellSize = cellSize;
        this.width = cols * cellSize;
        this.height = rows * cellSize;
        this.cellCount = cols * rows;

        // Buffers
        this.cost = new Uint8Array(this.cellCount);
        this.integration = new Float32Array(this.cellCount);
        this.flowX = new Float32Array(this.cellCount);
        this.flowY = new Float32Array(this.cellCount);

        // State
        this.goals = []; // [{ gx, gy, weight }]
        this.needsUpdate = true;
        this.lastComputeTimeMs = 0;

        // Neighbor offsets: [dx, dy, distanceMultiplier]
        // 8-way navigation with diagonal cost factor sqrt(2) ≈ 1.4142
        const SQRT2 = Math.SQRT2;
        this.neighbors = [
            { dx: 1, dy: 0, cost: 1.0 },
            { dx: -1, dy: 0, cost: 1.0 },
            { dx: 0, dy: 1, cost: 1.0 },
            { dx: 0, dy: -1, cost: 1.0 },
            { dx: 1, dy: 1, cost: SQRT2 },
            { dx: -1, dy: 1, cost: SQRT2 },
            { dx: 1, dy: -1, cost: SQRT2 },
            { dx: -1, dy: -1, cost: SQRT2 }
        ];

        this.initDefaultCost();
    }

    initDefaultCost() {
        this.cost.fill(TERRAIN.OPEN);
        // Border boundaries as impassable
        for (let x = 0; x < this.cols; x++) {
            this.setCost(x, 0, TERRAIN.IMPASSABLE);
            this.setCost(x, this.rows - 1, TERRAIN.IMPASSABLE);
        }
        for (let y = 0; y < this.rows; y++) {
            this.setCost(0, y, TERRAIN.IMPASSABLE);
            this.setCost(this.cols - 1, y, TERRAIN.IMPASSABLE);
        }
        this.integration.fill(1e9);
        this.flowX.fill(0);
        this.flowY.fill(0);
    }

    index(x, y) {
        return y * this.cols + x;
    }

    inBounds(x, y) {
        return x >= 0 && x < this.cols && y >= 0 && y < this.rows;
    }

    setCost(x, y, value) {
        if (!this.inBounds(x, y)) return;
        this.cost[this.index(x, y)] = value;
        this.needsUpdate = true;
    }

    getCost(x, y) {
        if (!this.inBounds(x, y)) return TERRAIN.IMPASSABLE;
        return this.cost[this.index(x, y)];
    }

    setBrush(worldX, worldY, radius, value) {
        const cx = Math.floor(worldX / this.cellSize);
        const cy = Math.floor(worldY / this.cellSize);
        const rCells = Math.max(1, Math.round(radius / this.cellSize));

        for (let dy = -rCells; dy <= rCells; dy++) {
            for (let dx = -rCells; dx <= rCells; dx++) {
                if (dx * dx + dy * dy <= rCells * rCells) {
                    const gx = cx + dx;
                    const gy = cy + dy;
                    if (gx > 0 && gx < this.cols - 1 && gy > 0 && gy < this.rows - 1) {
                        this.cost[this.index(gx, gy)] = value;
                    }
                }
            }
        }
        this.needsUpdate = true;
    }

    setGoals(goals) {
        this.goals = goals.map(g => ({
            gx: Math.max(1, Math.min(this.cols - 2, Math.floor(g.x / this.cellSize))),
            gy: Math.max(1, Math.min(this.rows - 2, Math.floor(g.y / this.cellSize))),
            weight: g.weight ?? 0.0
        }));
        this.needsUpdate = true;
    }

    addGoal(worldX, worldY) {
        const gx = Math.max(1, Math.min(this.cols - 2, Math.floor(worldX / this.cellSize)));
        const gy = Math.max(1, Math.min(this.rows - 2, Math.floor(worldY / this.cellSize)));
        this.goals.push({ gx, gy, weight: 0.0 });
        this.needsUpdate = true;
    }

    clearGoals() {
        this.goals = [];
        this.needsUpdate = true;
    }

    // --- Wavefront Propagation (Dijkstra-Eikonal Integration Field) ---
    recompute() {
        const t0 = performance.now();
        const INF = 1e9;
        this.integration.fill(INF);
        this.flowX.fill(0);
        this.flowY.fill(0);

        if (this.goals.length === 0) {
            this.needsUpdate = false;
            this.lastComputeTimeMs = performance.now() - t0;
            return;
        }

        const pq = new PriorityQueue();

        // Seed goals
        for (const goal of this.goals) {
            if (!this.inBounds(goal.gx, goal.gy)) continue;
            const idx = this.index(goal.gx, goal.gy);
            if (this.cost[idx] < TERRAIN.IMPASSABLE) {
                this.integration[idx] = goal.weight;
                pq.push(idx, goal.weight);
            }
        }

        // Expand wave
        while (!pq.isEmpty()) {
            const currIdx = pq.pop();
            const currDist = this.integration[currIdx];
            const cx = currIdx % this.cols;
            const cy = (currIdx / this.cols) | 0;

            for (let i = 0; i < 8; i++) {
                const n = this.neighbors[i];
                const nx = cx + n.dx;
                const ny = cy + n.dy;

                if (nx < 0 || nx >= this.cols || ny < 0 || ny >= this.rows) continue;
                const nIdx = ny * this.cols + nx;
                const cellCost = this.cost[nIdx];
                if (cellCost >= TERRAIN.IMPASSABLE) continue;

                // Corner-cutting check for diagonals
                if (i >= 4) {
                    const c1 = this.cost[this.index(cx + n.dx, cy)];
                    const c2 = this.cost[this.index(cx, cy + n.dy)];
                    if (c1 >= TERRAIN.IMPASSABLE || c2 >= TERRAIN.IMPASSABLE) {
                        continue; // Do not cut sharp impassable corners
                    }
                }

                const newDist = currDist + cellCost * n.cost;
                if (newDist < this.integration[nIdx]) {
                    this.integration[nIdx] = newDist;
                    pq.push(nIdx, newDist);
                }
            }
        }

        // Compute Vector Direction Field
        this.generateVectorField();

        this.needsUpdate = false;
        this.lastComputeTimeMs = performance.now() - t0;
    }

    generateVectorField() {
        const cols = this.cols;
        const rows = this.rows;
        const intField = this.integration;
        const costField = this.cost;
        const INF = 1e9;

        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const idx = y * cols + x;
                if (costField[idx] >= TERRAIN.IMPASSABLE || intField[idx] >= INF) {
                    this.flowX[idx] = 0;
                    this.flowY[idx] = 0;
                    continue;
                }

                // Find neighbor with lowest integration value (8-way descent)
                let bestVal = intField[idx];
                let bestDx = 0;
                let bestDy = 0;

                for (let i = 0; i < 8; i++) {
                    const n = this.neighbors[i];
                    const nx = x + n.dx;
                    const ny = y + n.dy;
                    if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;

                    const nIdx = ny * cols + nx;
                    const nVal = intField[nIdx];

                    // Check corner cuts
                    if (i >= 4) {
                        if (costField[y * cols + (x + n.dx)] >= TERRAIN.IMPASSABLE ||
                            costField[(y + n.dy) * cols + x] >= TERRAIN.IMPASSABLE) {
                            continue;
                        }
                    }

                    if (nVal < bestVal) {
                        bestVal = nVal;
                        bestDx = n.dx;
                        bestDy = n.dy;
                    }
                }

                // Also calculate continuous central differences gradient
                const left = x > 0 ? intField[idx - 1] : intField[idx];
                const right = x < cols - 1 ? intField[idx + 1] : intField[idx];
                const up = y > 0 ? intField[idx - cols] : intField[idx];
                const down = y < rows - 1 ? intField[idx + cols] : intField[idx];

                let gradX = (right < INF && left < INF) ? (left - right) : -bestDx;
                let gradY = (down < INF && up < INF) ? (up - down) : -bestDy;

                // Blend discrete lowest neighbor with gradient
                let fx = bestDx * 0.6 + gradX * 0.4;
                let fy = bestDy * 0.6 + gradY * 0.4;

                const len = Math.hypot(fx, fy);
                if (len > 1e-4) {
                    this.flowX[idx] = fx / len;
                    this.flowY[idx] = fy / len;
                } else {
                    this.flowX[idx] = 0;
                    this.flowY[idx] = 0;
                }
            }
        }
    }

    /**
     * Continuous bilinear sample of the flow vector field at world coordinate (wx, wy)
     */
    sampleFlow(wx, wy, out = { x: 0, y: 0 }) {
        const gx = wx / this.cellSize - 0.5;
        const gy = wy / this.cellSize - 0.5;

        const x0 = Math.max(0, Math.min(this.cols - 2, Math.floor(gx)));
        const y0 = Math.max(0, Math.min(this.rows - 2, Math.floor(gy)));
        const x1 = x0 + 1;
        const y1 = y0 + 1;

        const tx = Math.max(0, Math.min(1, gx - x0));
        const ty = Math.max(0, Math.min(1, gy - y0));

        const i00 = y0 * this.cols + x0;
        const i10 = y0 * this.cols + x1;
        const i01 = y1 * this.cols + x0;
        const i11 = y1 * this.cols + x1;

        // Bilinear interpolation of direction vectors
        const fx0 = this.flowX[i00] * (1 - tx) + this.flowX[i10] * tx;
        const fx1 = this.flowX[i01] * (1 - tx) + this.flowX[i11] * tx;
        const vx = fx0 * (1 - ty) + fx1 * ty;

        const fy0 = this.flowY[i00] * (1 - tx) + this.flowY[i10] * tx;
        const fy1 = this.flowY[i01] * (1 - tx) + this.flowY[i11] * tx;
        const vy = fy0 * (1 - ty) + fy1 * ty;

        const len = Math.hypot(vx, vy);
        if (len > 1e-4) {
            out.x = vx / len;
            out.y = vy / len;
        } else {
            out.x = 0;
            out.y = 0;
        }
        return out;
    }

    getDistanceAt(wx, wy) {
        const gx = Math.max(0, Math.min(this.cols - 1, Math.floor(wx / this.cellSize)));
        const gy = Math.max(0, Math.min(this.rows - 1, Math.floor(wy / this.cellSize)));
        return this.integration[this.index(gx, gy)];
    }
}
