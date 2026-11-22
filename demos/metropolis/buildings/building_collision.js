// 3D multi-story building collision extending smallworlds/forts/grid.js 8m XZ binning
// with Uint32Array tick stamping, swept/sub-stepped capsule movement, stair ramps, and elevators.
import { getBuildingBlueprint, localToWorld, worldToLocal } from '/app/buildings/building_gen.js';

const BIN = 8.0;
const MAX_COLLIDER_CACHE = 64;
const WALL_THICK = 0.24;

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

function buildBuildingIndex(bp) {
    const pad = 2.0;
    const minX = -bp.halfW - pad;
    const minZ = -bp.halfD - pad;
    const maxX = bp.halfW + pad;
    const maxZ = bp.halfD + pad;
    const bnx = Math.max(1, Math.ceil((maxX - minX) / BIN));
    const bnz = Math.max(1, Math.ceil((maxZ - minZ) / BIN));

    const floors = new Array(bp.totalFloors);
    for (let f = 0; f < bp.totalFloors; f++) {
        const fl = bp.floors[f];
        const boxes = [];
        const slabs = [];
        const stairs = [];

        for (let i = 0; i < fl.slabTiles.length; i++) {
            const s = fl.slabTiles[i];
            const sb = {
                kind: 'slab',
                x0: s.x0, x1: s.x1,
                y0: fl.yBase - s.thick, y1: fl.yBase,
                z0: s.z0, z1: s.z1,
            };
            slabs.push(sb);
            boxes.push(sb);
        }
        if (fl.terraceSlabs) {
            for (let i = 0; i < fl.terraceSlabs.length; i++) {
                const s = fl.terraceSlabs[i];
                const sb = {
                    kind: 'slab',
                    x0: s.x0, x1: s.x1,
                    y0: fl.yCeil - s.thick, y1: fl.yCeil,
                    z0: s.z0, z1: s.z1,
                };
                slabs.push(sb);
                boxes.push(sb);
            }
        }

        const hw = WALL_THICK * 0.5;
        for (let i = 0; i < fl.wallSegs.length; i++) {
            const w = fl.wallSegs[i];
            const alongZ = Math.abs(Math.sin(w.ry)) > 0.7;
            const len = w.length;
            const pushWallBox = (u0, u1, v0, v1, kindTag = 'wall', extra = null) => {
                const bx0 = alongZ ? (w.x - hw) : (w.x + u0);
                const bx1 = alongZ ? (w.x + hw) : (w.x + u1);
                const bz0 = alongZ ? (w.z + u0) : (w.z - hw);
                const bz1 = alongZ ? (w.z + u1) : (w.z + hw);
                boxes.push({
                    kind: kindTag,
                    x0: bx0, x1: bx1,
                    y0: fl.yBase + v0, y1: fl.yBase + v1,
                    z0: bz0, z1: bz1,
                    extra,
                });
            };

            if (w.type === 'solid') {
                pushWallBox(-len * 0.5, len * 0.5, 0, bp.floorHeight);
            } else if (w.type === 'window') {
                pushWallBox(-len * 0.5, len * 0.5, 0, bp.floorHeight * 0.28);
                pushWallBox(-len * 0.5, len * 0.5, bp.floorHeight * 0.80, bp.floorHeight);
                pushWallBox(-len * 0.5, -len * 0.24, bp.floorHeight * 0.26, bp.floorHeight * 0.82);
                pushWallBox(len * 0.24, len * 0.5, bp.floorHeight * 0.26, bp.floorHeight * 0.82);
            } else if (w.type === 'door') {
                pushWallBox(-len * 0.5, -len * 0.36, 0, bp.floorHeight, 'door_jamb', { alongZ, wx: w.x, wz: w.z, side: -1 });
                pushWallBox(len * 0.36, len * 0.5, 0, bp.floorHeight, 'door_jamb', { alongZ, wx: w.x, wz: w.z, side: 1 });
                pushWallBox(-len * 0.38, len * 0.38, bp.floorHeight * 0.78, bp.floorHeight);
                if (w.roomA === -3 || w.roomB === -3) {
                    pushWallBox(-len * 0.36, len * 0.36, 0, bp.floorHeight * 0.78, 'elev_door', { floorIndex: f });
                }
            }
        }

        for (let i = 0; i < fl.furniture.length; i++) {
            const fn = fl.furniture[i];
            boxes.push({
                kind: 'furniture',
                x0: fn.x - fn.hx, x1: fn.x + fn.hx,
                y0: fl.yBase, y1: fl.yBase + fn.h,
                z0: fn.z - fn.hz, z1: fn.z + fn.hz,
            });
        }

        for (let i = 0; i < fl.stairs.length; i++) {
            const st = fl.stairs[i];
            stairs.push({
                x0: st.x0, x1: st.x1,
                z0: st.z0, z1: st.z1,
                y0: fl.yBase, y1: fl.yCeil,
                runLen: st.runLen,
            });
        }

        const bins = Array.from({ length: bnx * bnz }, () => []);
        for (let bi = 0; bi < boxes.length; bi++) {
            const b = boxes[bi];
            const ix0 = clamp(Math.floor((b.x0 - minX) / BIN), 0, bnx - 1);
            const ix1 = clamp(Math.floor((b.x1 - minX) / BIN), 0, bnx - 1);
            const iz0 = clamp(Math.floor((b.z0 - minZ) / BIN), 0, bnz - 1);
            const iz1 = clamp(Math.floor((b.z1 - minZ) / BIN), 0, bnz - 1);
            for (let iz = iz0; iz <= iz1; iz++) {
                const rowOff = iz * bnx;
                for (let ix = ix0; ix <= ix1; ix++) {
                    bins[rowOff + ix].push(bi);
                }
            }
        }

        floors[f] = {
            boxes,
            slabs,
            stairs,
            bins,
            stamp: new Uint32Array(boxes.length),
            tick: 1,
        };
    }

    const topFl = bp.floors[bp.totalFloors - 1];
    const roofBox = {
        kind: 'roof',
        x0: topFl.footCX - topFl.footW * 0.5 - 0.12,
        x1: topFl.footCX + topFl.footW * 0.5 + 0.12,
        y0: topFl.yCeil,
        y1: topFl.yCeil + 0.68,
        z0: topFl.footCZ - topFl.footD * 0.5 - 0.12,
        z1: topFl.footCZ + topFl.footD * 0.5 + 0.12,
    };

    return { bp, minX, minZ, bnx, bnz, floors, roofBox };
}

function pushCircleOutAABB2D(cx, cz, r, b) {
    const nearX = clamp(cx, b.x0, b.x1);
    const nearZ = clamp(cz, b.z0, b.z1);
    let dx = cx - nearX;
    let dz = cz - nearZ;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) return null;

    if (d2 > 1e-10) {
        const d = Math.sqrt(d2);
        const pen = r - d;
        return [dx / d * pen, dz / d * pen, dx / d, dz / d];
    }
    // Center inside AABB: push out toward closest edge
    const penL = cx - b.x0;
    const penR = b.x1 - cx;
    const penN = cz - b.z0;
    const penS = b.z1 - cz;
    const m = Math.min(penL, penR, penN, penS);
    if (m === penL) return [-(penL + r), 0, -1, 0];
    if (m === penR) return [penR + r, 0, 1, 0];
    if (m === penN) return [0, -(penN + r), 0, -1];
    return [0, penS + r, 0, 1];
}

export function createBuildingCollision(streamer, layout, elevators) {
    const indexCache = new Map();
    const nearbyBuildings = [];

    function getIndex(bp) {
        let idx = indexCache.get(bp.id);
        if (idx) {
            indexCache.delete(bp.id);
            indexCache.set(bp.id, idx);
            return idx;
        }
        idx = buildBuildingIndex(bp);
        if (indexCache.size >= MAX_COLLIDER_CACHE) {
            indexCache.delete(indexCache.keys().next().value);
        }
        indexCache.set(bp.id, idx);
        return idx;
    }

    function gatherNearby(wx, wz, radius = 48) {
        nearbyBuildings.length = 0;
        const pad = radius + (layout.MAX_WARP || 42);
        const [gu, gv] = layout.worldToGrid(wx, wz);
        const bx0 = Math.floor((gu - pad) / layout.BLOCK_SIZE);
        const bx1 = Math.floor((gu + pad) / layout.BLOCK_SIZE);
        const bz0 = Math.floor((gv - pad) / layout.BLOCK_SIZE);
        const bz1 = Math.floor((gv + pad) / layout.BLOCK_SIZE);
        for (let bz = bz0; bz <= bz1; bz++) {
            for (let bx = bx0; bx <= bx1; bx++) {
                const parcels = layout.getParcelsInBlock(bx, bz);
                for (let i = 0; i < parcels.length; i++) {
                    const p = parcels[i];
                    if (p.kind === 'park') continue;
                    const maxR = Math.max(p.width, p.depth) * 0.5 + 6;
                    if (Math.hypot(p.cx - wx, p.cz - wz) > maxR + radius) continue;
                    nearbyBuildings.push(getBuildingBlueprint(p));
                }
            }
        }
        return nearbyBuildings;
    }

    function resolveBuildingLocal(idx, lx, ly, lz, radius, height, stepUp, lvx, lvz) {
        const bp = idx.bp;
        const fEst = clamp(Math.floor((ly - bp.baseY + 0.5) / bp.floorHeight), 0, bp.totalFloors - 1);
        const fLo = Math.max(0, fEst - 1);
        const fHi = Math.min(bp.totalFloors - 1, fEst + 1);

        const ix0 = clamp(Math.floor((lx - radius - idx.minX) / BIN), 0, idx.bnx - 1);
        const ix1 = clamp(Math.floor((lx + radius - idx.minX) / BIN), 0, idx.bnx - 1);
        const iz0 = clamp(Math.floor((lz - radius - idx.minZ) / BIN), 0, idx.bnz - 1);
        const iz1 = clamp(Math.floor((lz + radius - idx.minZ) / BIN), 0, idx.bnz - 1);

        const headTop = ly + height - 0.04;
        const shinBot = ly + stepUp + 0.02;

        // Iterative circle-vs-AABB push-out
        for (let iter = 0; iter < 2; iter++) {
            for (let f = fLo; f <= fHi; f++) {
                const flIdx = idx.floors[f];
                flIdx.tick = (flIdx.tick + 1) >>> 0;
                if (flIdx.tick === 0) { flIdx.stamp.fill(0); flIdx.tick = 1; }
                const tick = flIdx.tick;

                for (let iz = iz0; iz <= iz1; iz++) {
                    const rowOff = iz * idx.bnx;
                    for (let ix = ix0; ix <= ix1; ix++) {
                        const cell = flIdx.bins[rowOff + ix];
                        for (let ci = 0; ci < cell.length; ci++) {
                            const bi = cell[ci];
                            if (flIdx.stamp[bi] === tick) continue;
                            flIdx.stamp[bi] = tick;
                            const b = flIdx.boxes[bi];
                            if (b.y1 <= shinBot || b.y0 >= headTop) continue;
                            if (b.kind === 'elev_door' && elevators?.isDoorOpenAt(bp.id, b.extra.floorIndex)) {
                                continue;
                            }
                            const push = pushCircleOutAABB2D(lx, lz, radius, b);
                            if (push) {
                                lx += push[0];
                                lz += push[1];
                                let nx = push[2];
                                let nz = push[3];
                                // Chamfered doorway jamb funnel: gently deflect toward the doorway opening when sliding along a jamb
                                if (b.kind === 'door_jamb' && b.extra) {
                                    const tx = b.extra.alongZ ? 0 : -b.extra.side;
                                    const tz = b.extra.alongZ ? -b.extra.side : 0;
                                    const nux = nx + tx * 0.65;
                                    const nuz = nz + tz * 0.65;
                                    const nl = Math.hypot(nux, nuz) || 1;
                                    nx = nux / nl;
                                    nz = nuz / nl;
                                }
                                const vn = lvx * nx + lvz * nz;
                                if (vn < 0) {
                                    lvx -= vn * nx;
                                    lvz -= vn * nz;
                                }
                            }
                        }
                    }
                }
            }

            // Roof cornice horizontal check if near roof height
            const rb = idx.roofBox;
            if (rb.y1 > shinBot && rb.y0 < headTop) {
                const push = pushCircleOutAABB2D(lx, lz, radius, rb);
                if (push) {
                    lx += push[0];
                    lz += push[1];
                }
            }
        }

        // Compute vertical floor support & overhead ceiling
        let supportY = -1e9;
        let ceilY = 1e9;
        for (let f = fLo; f <= fHi; f++) {
            const flIdx = idx.floors[f];
            for (let si = 0; si < flIdx.slabs.length; si++) {
                const s = flIdx.slabs[si];
                if (lx >= s.x0 - 0.12 && lx <= s.x1 + 0.12 && lz >= s.z0 - 0.12 && lz <= s.z1 + 0.12) {
                    if (s.y1 <= ly + stepUp + 0.08 && s.y1 > supportY) {
                        supportY = s.y1;
                    }
                    if (s.y0 >= ly + 0.45 && s.y0 < ceilY) {
                        ceilY = s.y0;
                    }
                }
            }
            for (let si = 0; si < flIdx.stairs.length; si++) {
                const st = flIdx.stairs[si];
                const zMin = Math.min(st.z0, st.z1);
                const zMax = Math.max(st.z0, st.z1);
                if (lx >= st.x0 - 0.15 && lx <= st.x1 + 0.15 && lz >= zMin - 0.18 && lz <= zMax + 0.18) {
                    const dz = st.z1 - st.z0;
                    const t = Math.abs(dz) > 1e-4 ? clamp((lz - st.z0) / dz, 0, 1) : 0;
                    const sy = st.y0 + t * (st.y1 - st.y0);
                    if (sy <= ly + stepUp + 0.18 && sy > supportY) {
                        supportY = sy;
                    }
                }
            }
        }

        // Roof top walkable
        const rb = idx.roofBox;
        if (lx >= rb.x0 - 0.1 && lx <= rb.x1 + 0.1 && lz >= rb.z0 - 0.1 && lz <= rb.z1 + 0.1) {
            if (rb.y1 <= ly + stepUp + 0.08 && rb.y1 > supportY) supportY = rb.y1;
            if (rb.y0 >= ly + 0.45 && rb.y0 < ceilY) ceilY = rb.y0;
        }

        // Active elevator cab floor & cab inner walls
        let inElev = false;
        if (bp.elevatorShaft && elevators) {
            const est = elevators.getState(bp.id);
            const sh = bp.elevatorShaft;
            if (est && lx >= sh.x0 - 0.15 && lx <= sh.x1 + 0.15 && lz >= sh.z0 - 0.15 && lz <= sh.z1 + 0.15) {
                const elevTol = Math.max(0.45, Math.abs(est.deltaY) + 0.15);
                if (est.currentY <= ly + stepUp + elevTol && est.currentY > supportY) {
                    supportY = est.currentY;
                }
                const insideCabXZ = lx >= sh.x0 + 0.25 && lx <= sh.x1 - 0.25
                    && lz >= sh.z0 + 0.25 && lz <= sh.z1 - 0.14 - radius;
                if (insideCabXZ && Math.abs(ly - est.currentY) <= elevTol) {
                    inElev = true;
                    const cabCeil = est.currentY + sh.cabH - 0.18;
                    if (cabCeil < ceilY) ceilY = cabCeil;
                    // Contain inside cab sides & back
                    const inHX = sh.cabW * 0.5 - 0.12 - radius;
                    const inHZ = sh.cabD * 0.5 - 0.12 - radius;
                    lx = clamp(lx, sh.cx - inHX, sh.cx + inHX);
                    lz = Math.max(lz, sh.cz - inHZ);
                    if (!est.doorOpen) {
                        lz = Math.min(lz, sh.cz + inHZ);
                    }
                }
            }
        }

        return { lx, lz, lvx, lvz, supportY, ceilY, inElev };
    }

    function moveCharacter(pos, vel, dt, opts = {}) {
        const radius = opts.radius ?? 0.35;
        const height = opts.height ?? 1.80;
        const stepUp = opts.stepUp ?? 0.40;
        const gravity = opts.gravity ?? 22.0;
        const jumpSpeed = opts.jumpSpeed ?? 7.4;

        let wx = pos[0];
        let wy = pos[1];
        let wz = pos[2];
        let vx = vel[0] || 0;
        let vy = vel[1] || 0;
        let vz = vel[2] || 0;

        if (opts.wishDir && (opts.speed ?? 0) >= 0) {
            vx = opts.wishDir[0] * (opts.speed ?? 0);
            vz = opts.wishDir[1] * (opts.speed ?? 0);
        }

        const cands = gatherNearby(wx, wz, 24);

        // Elevator deltaY carryover before gravity/step resolution
        let elevCarry = false;
        for (let i = 0; i < cands.length; i++) {
            const bp = cands[i];
            if (!bp.elevatorShaft || !elevators) continue;
            const est = elevators.getState(bp.id);
            if (!est) continue;
            const [lx, , lz] = worldToLocal(bp, wx, wy, wz);
            const sh = bp.elevatorShaft;
            const elevCarryTol = Math.max(0.55, Math.abs(est.deltaY) + 0.15);
            if (lx >= sh.x0 + 0.25 && lx <= sh.x1 - 0.25 && lz >= sh.z0 + 0.25 && lz <= sh.z1 - 0.14 - radius && Math.abs(wy - est.prevY) <= elevCarryTol) {
                wy += est.deltaY;
                elevCarry = true;
                break;
            }
        }

        const wasGrounded = opts.wasGrounded ?? (elevCarry || Math.abs(vy) < 0.25);
        if (opts.jump && wasGrounded) {
            vy = jumpSpeed;
        }

        const stepDt = clamp(dt, 0, 0.05);
        const horizDist = Math.hypot(vx * stepDt, vz * stepDt);
        const subSteps = clamp(Math.ceil(horizDist / (radius * 0.40)), 1, 8);
        const subDt = stepDt / subSteps;

        let bestSupportY = layout.sampleGroundHeight(wx, wz);
        let bestCeilY = 1e9;
        let inElevator = elevCarry;

        for (let s = 0; s < subSteps; s++) {
            wx = clamp(wx + vx * subDt, layout.WORLD_MIN + 2, layout.WORLD_MAX - 2);
            wz = clamp(wz + vz * subDt, layout.WORLD_MIN + 2, layout.WORLD_MAX - 2);
            bestSupportY = layout.sampleGroundHeight(wx, wz);
            bestCeilY = 1e9;

            for (let i = 0; i < cands.length; i++) {
                const bp = cands[i];
                const [lx0, ly0, lz0] = worldToLocal(bp, wx, wy, wz);
                if (lx0 < -bp.halfW - 3 || lx0 > bp.halfW + 3 || lz0 < -bp.halfD - 3 || lz0 > bp.halfD + 3) {
                    continue;
                }
                const c = Math.cos(bp.rot), sn = Math.sin(bp.rot);
                const lvx0 = c * vx - sn * vz;
                const lvz0 = sn * vx + c * vz;

                const idx = getIndex(bp);
                const res = resolveBuildingLocal(idx, lx0, ly0, lz0, radius, height, stepUp, lvx0, lvz0);
                const [nwx, , nwz] = localToWorld(bp, res.lx, ly0, res.lz);
                wx = nwx;
                wz = nwz;
                vx = c * res.lvx + sn * res.lvz;
                vz = -sn * res.lvx + c * res.lvz;
                if (res.supportY > bestSupportY) bestSupportY = res.supportY;
                if (res.ceilY < bestCeilY) bestCeilY = res.ceilY;
                if (res.inElev) inElevator = true;
            }
        }

        vy -= gravity * stepDt;
        wy += vy * stepDt;

        let grounded = false;
        if (wy <= bestSupportY + 0.02 && vy <= 0.15) {
            wy = bestSupportY;
            vy = 0;
            grounded = true;
        } else if (wasGrounded && !opts.jump && vy <= 0 && wy > bestSupportY && (wy - bestSupportY) <= stepUp + 0.06) {
            // Smooth stair descent & floor-to-curb snap
            wy = bestSupportY;
            vy = 0;
            grounded = true;
        }

        if (wy + height > bestCeilY) {
            wy = Math.max(bestSupportY, bestCeilY - height);
            if (vy > 0) vy = 0;
        }

        const act = streamer?.getActiveBuilding([wx, wy + 0.25, wz]) || null;
        return {
            pos: [wx, wy, wz],
            vel: [vx, vy, vz],
            grounded,
            floorIndex: act ? act.floorIndex : 0,
            buildingId: act && act.inside ? act.buildingId : null,
            roomId: act && act.inside ? act.roomId : null,
            inElevator,
        };
    }

    function resolveBox2D(x, z, y, halfX, halfZ, halfY, opts = {}) {
        let cx = x;
        let cz = z;
        let collided = false;
        let hitKind = null;
        let buildingId = null;

        const cands = gatherNearby(cx, cz, Math.max(halfX, halfZ) + 12);
        for (let i = 0; i < cands.length; i++) {
            const bp = cands[i];
            const eb = bp.exteriorBox;
            if (y + halfY <= eb.minY || y - halfY >= eb.maxY) continue;

            const [lx, , lz] = worldToLocal(bp, cx, y, cz);
            const c = Math.abs(Math.cos(bp.rot));
            const s = Math.abs(Math.sin(bp.rot));
            const effHX = c * halfX + s * halfZ;
            const effHZ = s * halfX + c * halfZ;

            const ox = (bp.halfW + effHX) - Math.abs(lx);
            const oz = (bp.halfD + effHZ) - Math.abs(lz);
            if (ox > 0 && oz > 0) {
                collided = true;
                hitKind = 'building';
                buildingId = bp.id;
                let nlx = lx;
                let nlz = lz;
                if (ox < oz) nlx += lx >= 0 ? ox : -ox;
                else nlz += lz >= 0 ? oz : -oz;
                const [nwx, , nwz] = localToWorld(bp, nlx, y, nlz);
                cx = nwx;
                cz = nwz;
            }
        }

        if (opts.collideCurbs) {
            const sr = layout.sampleRoad(cx, cz);
            const gy = layout.sampleGroundHeight(cx, cz);
            if (!sr.onRoad && y - halfY < gy + layout.CURB_HEIGHT && sr.onSidewalk) {
                hitKind = hitKind || 'curb';
            }
        }

        return {
            x: cx,
            z: cz,
            pushX: cx - x,
            pushZ: cz - z,
            collided,
            hitKind,
            buildingId,
        };
    }

    function callOrRideElevator(buildingId, targetFloor) {
        return elevators.callOrRide(buildingId, targetFloor);
    }

    return {
        moveCharacter,
        resolveBox2D,
        callOrRideElevator,
    };
}
