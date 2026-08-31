// influence.js — Tactical Influence Maps, Threat Diffusion, Tactical Cover & Choke Point Detection.
// Used for military terrain assessment and tactical threat avoidance.

import { TERRAIN } from "./flowfield.js";

export class InfluenceMap {
    constructor(cols = 128, rows = 72, cellSize = 10) {
        this.cols = cols;
        this.rows = rows;
        this.cellSize = cellSize;
        this.cellCount = cols * rows;

        // Influence layers: positive = friendly influence, negative = enemy/threat influence
        this.influence = new Float32Array(this.cellCount);
        this.threat = new Float32Array(this.cellCount);
        this.chokePoints = new Float32Array(this.cellCount);
        this.coverScore = new Float32Array(this.cellCount);

        // Sources
        this.threatSources = []; // [{ x, y, radius, strength }]
        this.friendlySources = [];

        // Analysis state
        this.chokePointList = [];
    }

    addThreat(wx, wy, radius = 120, strength = 1.0) {
        this.threatSources.push({ wx, wy, radius, strength });
    }

    clearThreats() {
        this.threatSources = [];
    }

    update(units = [], flowField) {
        this.influence.fill(0);
        this.threat.fill(0);
        this.coverScore.fill(0);

        const cols = this.cols;
        const rows = this.rows;
        const cs = this.cellSize;

        // 1. Project Friendly Units onto Influence Layer
        // To keep 5000 units fast, sample units with stride or spatial accumulation
        const stride = units.length > 1000 ? Math.ceil(units.length / 800) : 1;
        for (let i = 0; i < units.length; i += stride) {
            const u = units[i];
            const gx = Math.floor(u.x / cs);
            const gy = Math.floor(u.y / cs);
            if (gx >= 0 && gx < cols && gy >= 0 && gy < rows) {
                this.influence[gy * cols + gx] += 0.4 * stride;
            }
        }

        // 2. Diffuse and Decay Friendly Influence (2 iterations)
        this.diffuseInfluence(this.influence, flowField.cost, 0.4, 2);

        // 3. Project Threat Sources
        for (const ts of this.threatSources) {
            const rCells = Math.ceil(ts.radius / cs);
            const cx = Math.floor(ts.wx / cs);
            const cy = Math.floor(ts.wy / cs);

            for (let dy = -rCells; dy <= rCells; dy++) {
                for (let dx = -rCells; dx <= rCells; dx++) {
                    const gx = cx + dx;
                    const gy = cy + dy;
                    if (gx < 0 || gx >= cols || gy < 0 || gy >= rows) continue;
                    const idx = gy * cols + gx;
                    if (flowField.cost[idx] >= TERRAIN.IMPASSABLE) continue;

                    const d = Math.hypot(dx * cs, dy * cs);
                    if (d < ts.radius) {
                        const falloff = 1 - d / ts.radius;
                        const val = ts.strength * falloff * falloff;
                        this.threat[idx] = Math.max(this.threat[idx], val);
                        this.influence[idx] -= val * 1.5; // Threat depresses friendly influence
                    }
                }
            }
        }

        // 4. Analyze Choke Points & Tactical Cover
        this.analyzeTactics(flowField);
    }

    diffuseInfluence(buffer, costField, diffusionRate = 0.25, iterations = 2) {
        const cols = this.cols;
        const rows = this.rows;
        const temp = new Float32Array(this.cellCount);

        for (let it = 0; it < iterations; it++) {
            temp.set(buffer);
            for (let y = 1; y < rows - 1; y++) {
                for (let x = 1; x < cols - 1; x++) {
                    const idx = y * cols + x;
                    if (costField[idx] >= TERRAIN.IMPASSABLE) continue;

                    let sum = temp[idx] * (1 - diffusionRate);
                    let neighbors = 0;
                    const share = (diffusionRate / 4);

                    const up = (y - 1) * cols + x;
                    const down = (y + 1) * cols + x;
                    const left = y * cols + (x - 1);
                    const right = y * cols + (x + 1);

                    if (costField[up] < TERRAIN.IMPASSABLE) { sum += temp[up] * share; neighbors++; }
                    if (costField[down] < TERRAIN.IMPASSABLE) { sum += temp[down] * share; neighbors++; }
                    if (costField[left] < TERRAIN.IMPASSABLE) { sum += temp[left] * share; neighbors++; }
                    if (costField[right] < TERRAIN.IMPASSABLE) { sum += temp[right] * share; neighbors++; }

                    buffer[idx] = Math.max(-2, Math.min(2, sum * 0.95)); // mild decay
                }
            }
        }
    }

    analyzeTactics(flowField) {
        const cols = this.cols;
        const rows = this.rows;
        const cost = flowField.cost;
        this.chokePoints.fill(0);
        this.chokePointList = [];

        // Choke point detection: find open cells with high obstacle constriction in opposite directions
        for (let y = 2; y < rows - 2; y++) {
            for (let x = 2; x < cols - 2; x++) {
                const idx = y * cols + x;
                if (cost[idx] >= TERRAIN.IMPASSABLE) continue;

                // Check Horizontal Constriction (blocked left & right, open up & down)
                const wallLeft = cost[y * cols + (x - 1)] >= TERRAIN.IMPASSABLE || cost[y * cols + (x - 2)] >= TERRAIN.IMPASSABLE;
                const wallRight = cost[y * cols + (x + 1)] >= TERRAIN.IMPASSABLE || cost[y * cols + (x + 2)] >= TERRAIN.IMPASSABLE;
                const openVert = cost[(y - 1) * cols + x] < TERRAIN.IMPASSABLE && cost[(y + 1) * cols + x] < TERRAIN.IMPASSABLE;

                // Check Vertical Constriction (blocked up & down, open left & right)
                const wallUp = cost[(y - 1) * cols + x] >= TERRAIN.IMPASSABLE || cost[(y - 2) * cols + x] >= TERRAIN.IMPASSABLE;
                const wallDown = cost[(y + 1) * cols + x] >= TERRAIN.IMPASSABLE || cost[(y + 2) * cols + x] >= TERRAIN.IMPASSABLE;
                const openHoriz = cost[y * cols + (x - 1)] < TERRAIN.IMPASSABLE && cost[y * cols + (x + 1)] < TERRAIN.IMPASSABLE;

                if ((wallLeft && wallRight && openVert) || (wallUp && wallDown && openHoriz)) {
                    this.chokePoints[idx] = 1.0;
                    if (this.chokePointList.length < 50 && (x % 3 === 0) && (y % 3 === 0)) {
                        this.chokePointList.push({
                            wx: (x + 0.5) * this.cellSize,
                            wy: (y + 0.5) * this.cellSize
                        });
                    }
                }

                // Tactical Cover Score: cell is open, but immediately adjacent to an impassable wall
                let adjacentWalls = 0;
                if (cost[y * cols + (x - 1)] >= TERRAIN.IMPASSABLE) adjacentWalls++;
                if (cost[y * cols + (x + 1)] >= TERRAIN.IMPASSABLE) adjacentWalls++;
                if (cost[(y - 1) * cols + x] >= TERRAIN.IMPASSABLE) adjacentWalls++;
                if (cost[(y + 1) * cols + x] >= TERRAIN.IMPASSABLE) adjacentWalls++;
                if (adjacentWalls >= 1 && adjacentWalls <= 2) {
                    this.coverScore[idx] = adjacentWalls * 0.5;
                }
            }
        }
    }

    sampleThreat(wx, wy) {
        const gx = Math.max(0, Math.min(this.cols - 1, Math.floor(wx / this.cellSize)));
        const gy = Math.max(0, Math.min(this.rows - 1, Math.floor(wy / this.cellSize)));
        return this.threat[gy * this.cols + gx];
    }
}
