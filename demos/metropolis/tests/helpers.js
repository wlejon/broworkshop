// Shared opaque-box E2E test helpers for broworkshop/demos/metropolis.
// Interacts strictly through globalThis.__metropolis, DOM/input, bro.eye.*, perf.*, and /lib/kit/test.js.
import { check, eq, frames, waitFor, press, clickOn, QUICK, tier } from "/lib/kit/test.js";

export function getApi() {
    const api = globalThis.__metropolis;
    check(Boolean(api), "globalThis.__metropolis is exposed");
    return api;
}

export function getScene() {
    const api = globalThis.__metropolis;
    const canvas = document.querySelector("canvas");
    const scene = (api && api.scene) || globalThis.scene || (canvas && canvas.getContext && canvas.getContext("scene"));
    check(Boolean(scene), "live SceneGraph is exposed via __metropolis.scene or canvas");
    return scene;
}

export async function settle(opts = {}) {
    if (typeof perf !== "undefined" && typeof perf.settle === "function") {
        const res = perf.settle({
            maxFrames: opts.maxFrames != null ? opts.maxFrames : tier(400, 2000),
            held: opts.held !== undefined ? opts.held : true,
            exposure: opts.exposure !== undefined ? opts.exposure : true,
            ...(opts.kinds ? { kinds: opts.kinds } : {}),
            ...(opts.stallFrames ? { stallFrames: opts.stallFrames } : {}),
        });
        check(!res.stalled, "perf.settle did not stall: " + JSON.stringify(res));
        return res;
    }
    frames(tier(4, 12));
    return { settled: true, stalled: false, frames: 0, pending: [] };
}

export async function waitReady() {
    waitFor(() => Boolean(globalThis.__metropolis), "globalThis.__metropolis defined", 30000, 20);
    const api = getApi();
    if (typeof api.whenReady === "function") {
        await api.whenReady();
    } else {
        waitFor(() => api.ready === true, "__metropolis.ready === true", 60000, 20);
    }
    check(api.ready === true, "__metropolis.ready is true");
    await settle({ maxFrames: tier(400, 2000) });
    frames(2);
    return api;
}

export function clearWalkInput() {
    const api = getApi();
    api.setWalkInput({ forward: 0, right: 0, jump: false, sprint: false, yawDelta: 0, pitchDelta: 0 });
}

export function walkSteps(input, count = 10, dtMs = 16) {
    const api = getApi();
    api.setWalkInput({ forward: 0, right: 0, jump: false, sprint: false, yawDelta: 0, pitchDelta: 0, ...input });
    for (let i = 0; i < count; i++) advanceTime(dtMs);
    if (!input.hold) clearWalkInput();
    flush();
    return api.getState();
}

export function clearDriveInput() {
    const api = getApi();
    api.setDriveInput({ forward: 0, right: 0, brake: 0 });
}

export function driveSteps(input, count = 10, dtMs = 16) {
    const api = getApi();
    api.setDriveInput({ forward: 0, right: 0, brake: 0, ...input });
    for (let i = 0; i < count; i++) advanceTime(dtMs);
    if (!input.hold) clearDriveInput();
    flush();
    return api.getState();
}

export async function teleportAndSettle(x, y, z, yaw, pitch, settleOpts) {
    const api = getApi();
    if (yaw !== undefined && pitch !== undefined) api.teleport(x, y, z, yaw, pitch);
    else if (yaw !== undefined) api.teleport(x, y, z, yaw);
    else api.teleport(x, y, z);
    await settle(settleOpts);
    frames(2);
    return api.getState();
}

export async function flyTo(x, y, z, yaw = 0, pitch = -0.15) {
    const api = getApi();
    api.setMode("fly");
    return await teleportAndSettle(x, y, z, yaw, pitch);
}

export function dist2D(a, b) {
    const dx = a[0] - b[0];
    const dz = a[2] - b[2];
    return Math.hypot(dx, dz);
}

export function dist3D(a, b) {
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    const dz = a[2] - b[2];
    return Math.hypot(dx, dy, dz);
}

export function toVec3(v) {
    if (!v) return null;
    if (Array.isArray(v) || ArrayBuffer.isView(v)) {
        return [Number(v[0]), Number(v[1] ?? 0), Number(v[2] ?? 0)];
    }
    if (typeof v === "object" && v.x != null) {
        return [Number(v.x), Number(v.y ?? 0), Number(v.z ?? 0)];
    }
    return null;
}

export function getDoorwayPos(bld) {
    if (!bld) return null;
    return toVec3(bld.doorway || bld.doorPos || bld.entrance || bld.entry || bld.door);
}

export function getBuildingCenter(bld) {
    if (!bld) return null;
    return toVec3(bld.center || bld.pos || bld.origin || (bld.cx != null ? [bld.cx, bld.baseY ?? 0, bld.cz] : null));
}

export function getStairPos(bld) {
    if (!bld) return null;
    const s = bld.stairs && bld.stairs[0];
    return toVec3(bld.stairPos || bld.stairsPos || bld.stair || (s && (s.pos || s.entry || s)));
}

export function getElevatorPos(bld) {
    if (!bld) return null;
    const e = bld.elevators && bld.elevators[0];
    return toVec3(bld.elevatorPos || bld.elevator || (e && (e.pos || e.entry || e)));
}

let cachedBasis = null;
let cachedYawSign = 0;

export function resolveYawToward(fromPos, targetPos) {
    const api = getApi();
    const dx = targetPos[0] - fromPos[0];
    const dz = targetPos[2] - fromPos[2];
    const d = Math.hypot(dx, dz) || 1;
    const tx = dx / d;
    const tz = dz / d;

    const probe = (yaw) => {
        api.teleport(fromPos[0], fromPos[1], fromPos[2], yaw, 0);
        const st = walkSteps({ forward: 1 }, 2, 16);
        const fx = st.pos[0] - fromPos[0];
        const fz = st.pos[2] - fromPos[2];
        return { fx, fz, len: Math.hypot(fx, fz) };
    };

    const p0 = probe(0);
    const p1 = probe(Math.PI * 0.5);
    let bestYaw = Math.atan2(-dx, -dz);
    if (p0.len > 1e-4 && p1.len > 1e-4) {
        const f0x = p0.fx / p0.len, f0z = p0.fz / p0.len;
        const f1x = p1.fx / p1.len, f1z = p1.fz / p1.len;
        bestYaw = Math.atan2(tx * f1x + tz * f1z, tx * f0x + tz * f0z);
        const dot01 = f0x * f1x + f0z * f1z;
        const cross01 = f0x * f1z - f0z * f1x;
        if (p0.len > 0.05 && p1.len > 0.05 && Math.abs(dot01) < 0.25 && Math.abs(cross01) > 0.75) {
            cachedYawSign = cross01 >= 0 ? 1 : -1;
            cachedBasis = { f0x, f0z, f1x, f1z, yawSign: cachedYawSign };
        }
    } else {
        let bestDot = -Infinity;
        for (const cand of [Math.atan2(-dx, -dz), Math.atan2(dx, dz), Math.atan2(dx, -dz), Math.atan2(-dx, dz)]) {
            const pr = probe(cand);
            const dot = pr.len > 1e-4 ? (pr.fx * tx + pr.fz * tz) / pr.len : -1;
            if (dot > bestDot) {
                bestDot = dot;
                bestYaw = cand;
            }
        }
    }
    api.teleport(fromPos[0], fromPos[1], fromPos[2], bestYaw, 0);
    frames(1);
    return bestYaw;
}

/**
 * Steers and walks toward targetPos using setWalkInput({ forward, yawDelta })
 * without bypassing 3D physics or wall/doorway collision.
 */
export function walkToPoint(targetPos, opts = {}) {
    const api = getApi();
    const tol = opts.tol != null ? opts.tol : 1.0;
    const maxSteps = opts.maxSteps != null ? opts.maxSteps : 240;
    const sprint = Boolean(opts.sprint);
    const stopPred = opts.stopWhen || null;

    let yawSign = cachedBasis ? cachedBasis.yawSign : cachedYawSign;
    let turnLock = 0;
    let lastDot = null;
    let blockedTurns = 0;
    let ux = null;
    let uz = null;
    let state = api.getState();
    let stuckAnchor = state.pos.slice();
    let stuckAge = 0;
    let stuckSide = 1;
    let bypassSteps = 0;

    const rotateU = (delta) => {
        if (ux === null) return;
        const a = (yawSign || cachedYawSign || 1) * delta;
        const c = Math.cos(a), s = Math.sin(a);
        const nx = ux * c - uz * s;
        const nz = ux * s + uz * c;
        const nl = Math.hypot(nx, nz) || 1;
        ux = nx / nl;
        uz = nz / nl;
    };

    for (let iter = 0; iter < maxSteps; iter++) {
        if (stopPred && stopPred(state)) break;
        const curDx = targetPos[0] - state.pos[0];
        const curDz = targetPos[2] - state.pos[2];
        const curD = Math.hypot(curDx, curDz);
        if (curD <= tol) break;

        if (dist2D(state.pos, stuckAnchor) >= 0.45) {
            stuckAnchor = state.pos.slice();
            stuckAge = 0;
        } else {
            stuckAge++;
            if (stuckAge >= 6) {
                stuckSide = -stuckSide;
                stuckAge = 0;
                bypassSteps = 3;
            }
        }

        const useBasis = Boolean(cachedBasis && typeof state.yaw === "number" && Number.isFinite(state.yaw));
        if (useBasis) {
            const cy = Math.cos(state.yaw), sy = Math.sin(state.yaw);
            const bx = cy * cachedBasis.f0x + sy * cachedBasis.f1x;
            const bz = cy * cachedBasis.f0z + sy * cachedBasis.f1z;
            const bLen = Math.hypot(bx, bz) || 1;
            ux = bx / bLen;
            uz = bz / bLen;
            yawSign = cachedBasis.yawSign;
        } else if (ux === null) {
            const p0 = state.pos.slice();
            state = walkSteps({ forward: 0.25, sprint: false, hold: true }, 1, 16);
            if (stopPred && stopPred(state)) break;
            const fx = state.pos[0] - p0[0];
            const fz = state.pos[2] - p0[2];
            const fLen = Math.hypot(fx, fz);
            if (fLen > 0.015) {
                ux = fx / fLen;
                uz = fz / fLen;
                if (yawSign === 0) {
                    const testYaw = 0.25;
                    state = walkSteps({ forward: 0, sprint: false, yawDelta: testYaw, hold: true }, 1, 16);
                    const p2 = state.pos.slice();
                    state = walkSteps({ forward: 0.25, sprint: false, hold: true }, 1, 16);
                    const fx2 = state.pos[0] - p2[0];
                    const fz2 = state.pos[2] - p2[2];
                    const fLen2 = Math.hypot(fx2, fz2);
                    if (fLen2 > 0.015) {
                        const ux2 = fx2 / fLen2;
                        const uz2 = fz2 / fLen2;
                        const turnCross = ux * uz2 - uz * ux2;
                        if (Math.abs(turnCross) > 0.05) {
                            yawSign = turnCross >= 0 ? 1 : -1;
                            cachedYawSign = yawSign;
                        }
                    }
                    state = walkSteps({ forward: 0, sprint: false, yawDelta: -testYaw, hold: true }, 1, 16);
                    if (stopPred && stopPred(state)) break;
                }
            } else {
                lastDot = null;
                turnLock = 0;
                blockedTurns++;
                const sy = yawSign || cachedYawSign || -1;
                const side = blockedTurns >= 3 ? (blockedTurns % 2 === 0 ? 0.5 : -0.5) : 0;
                state = walkSteps({ forward: 0, right: side, sprint: false, yawDelta: 0.35 * sy, hold: true }, 3, 16);
                continue;
            }
        }

        const rDx = targetPos[0] - state.pos[0];
        const rDz = targetPos[2] - state.pos[2];
        const rD = Math.hypot(rDx, rDz);
        if (rD <= tol) break;

        const tx = rDx / rD;
        const tz = rDz / rD;
        const dot = Math.max(-1, Math.min(1, ux * tx + uz * tz));
        const cross = ux * tz - uz * tx;
        const curSign = yawSign || cachedYawSign || 1;

        if (yawSign === 0 && turnLock === 0 && lastDot !== null && dot < lastDot - 0.03) {
            yawSign = -curSign;
            cachedYawSign = yawSign;
        }
        const activeSign = yawSign || cachedYawSign || 1;

        if (dot < -0.4 && turnLock === 0) {
            turnLock = (cross >= 0 ? 1 : -1) * activeSign;
        } else if (dot >= -0.2) {
            turnLock = 0;
        }

        let yawDelta;
        if (turnLock !== 0) {
            yawDelta = 0.35 * turnLock;
        } else {
            const angle = Math.atan2(cross, dot);
            yawDelta = Math.max(-0.35, Math.min(0.35, activeSign * angle * 0.55));
        }
        lastDot = dot;

        if (dot < 0.3) {
            state = walkSteps({ forward: 0, sprint: false, yawDelta, hold: true }, 2, 16);
            if (!useBasis) rotateU(yawDelta);
        } else if (bypassSteps > 0) {
            bypassSteps--;
            state = walkSteps({ forward: 0.15, right: 0.85 * stuckSide, sprint: false, yawDelta: 0, hold: true }, 3, 16);
        } else {
            const p0 = state.pos.slice();
            state = walkSteps({ forward: 1, sprint, yawDelta, hold: true }, 3, 16);
            if (!useBasis) rotateU(yawDelta);
            if (stopPred && stopPred(state)) break;
            const fx = state.pos[0] - p0[0];
            const fz = state.pos[2] - p0[2];
            const fLen = Math.hypot(fx, fz);
            if (fLen > 0.015) {
                blockedTurns = 0;
                if (!useBasis) {
                    const mx = fx / fLen;
                    const mz = fz / fLen;
                    if (ux * mx + uz * mz > 0.85) {
                        ux = mx;
                        uz = mz;
                    }
                }
            } else {
                lastDot = null;
                turnLock = 0;
                blockedTurns++;
                state = walkSteps({ forward: -0.15, right: 0.85 * stuckSide, sprint: false, yawDelta: 0, hold: true }, 3, 16);
            }
        }
    }
    clearWalkInput();
    flush();
    return api.getState();
}

export async function enterBuilding(kind = "home", opts = {}) {
    const api = getApi();
    api.setMode("walk");
    const bld = api.getNearestBuilding(kind);
    check(Boolean(bld), `getNearestBuilding('${kind}') returned descriptor`);
    const door = getDoorwayPos(bld);
    check(Boolean(door), `building '${kind}' exposes doorway coordinates`);

    const center = getBuildingCenter(bld) || [door[0] + 6, door[1], door[2]];
    let outX = door[0] - center[0];
    let outZ = door[2] - center[2];
    const len = Math.hypot(outX, outZ) || 1;
    outX /= len;
    outZ /= len;

    const approach = toVec3(bld.outsidePos || bld.approachPos) || [
        door[0] + outX * 4.0,
        door[1],
        door[2] + outZ * 4.0,
    ];
    const insideTarget = [
        door[0] - outX * 2.5,
        door[1],
        door[2] - outZ * 2.5,
    ];

    await teleportAndSettle(approach[0], approach[1], approach[2]);
    resolveYawToward(approach, insideTarget);

    let st = walkToPoint(door, {
        tol: 0.9,
        maxSteps: 90,
        stopWhen: (s) => s.buildingId != null && dist2D(s.pos, door) >= 0.75,
    });
    if (st.buildingId == null || dist2D(st.pos, door) < 0.75) {
        st = walkToPoint(insideTarget, {
            tol: 0.7,
            maxSteps: 90,
            stopWhen: (s) => s.buildingId != null && dist2D(s.pos, door) >= 0.75,
        });
    }
    if (st.buildingId == null) {
        st = walkToPoint(insideTarget, { tol: 0.7, maxSteps: 90, stopWhen: (s) => s.buildingId != null });
    }

    if (!opts.allowOutside) {
        check(st.buildingId != null, `entered '${kind}' building via doorway walk (buildingId=${st.buildingId})`);
    }
    const info = typeof api.getCurrentBuildingInfo === "function" ? api.getCurrentBuildingInfo() : null;
    return { bld, door, approach, insideTarget, outDir: [outX, outZ], state: st, info };
}

const FORBIDDEN_DIAGNOSE_KINDS = new Set([
    "translucent_striation",
    "bright_outlier",
    "flat_plastic",
    "bloom_hotspot",
    "tint_mismatch",
    "axis_grid",
    "no_shadow_caster",
]);

export function assertDiagnoseClean(scene, label, opts = {}) {
    const diag = bro.eye.diagnose(scene, {
        minPixels: opts.minPixels != null ? opts.minPixels : 16,
        alwaysRender: false,
    });
    eq(diag.ok, true, `${label}: bro.eye.diagnose ok === true`);
    check(diag.visibleMeshes > 0, `${label}: visibleMeshes > 0 (${diag.visibleMeshes})`);
    eq(diag.anomalyCount, 0, `${label}: anomalyCount === 0 (${JSON.stringify(diag.anomalies)})`);
    eq(diag.bloomHotspotCount, 0, `${label}: bloomHotspotCount === 0`);
    const bad = (diag.anomalies || []).filter((a) => FORBIDDEN_DIAGNOSE_KINDS.has(a.kind));
    eq(bad.length, 0, `${label}: zero critical diagnose anomalies`);
    if (opts.expectTranslucent) {
        const hasGlass = Array.isArray(diag.meshes) && diag.meshes.some((m) => m.translucent);
        check(hasGlass, `${label}: id_translucent detected translucent glazing mesh/instance`);
    }
    return diag;
}

export function buildInteriorStructureOpts(entry, stateOverride) {
    const api = getApi();
    const st = stateOverride || api.getState();
    const info = (typeof api.getCurrentBuildingInfo === "function" ? api.getCurrentBuildingInfo() : null) || entry?.info || null;
    const bld = entry?.bld || null;
    const camPos = st.pos || [0, 0, 0];
    const camY = camPos[1];

    const baseWorldY = (info && info.baseY != null) ? Number(info.baseY)
        : (bld && bld.baseY != null) ? Number(bld.baseY)
        : (st.groundY != null && Number.isFinite(st.groundY)) ? Number(st.groundY)
        : (camY - 1.65);
    const floorHeight = (info && info.floorHeight != null) ? Number(info.floorHeight)
        : (bld && bld.floorHeight != null) ? Number(bld.floorHeight)
        : 3.2;
    const curFloorIdx = Number(st.floorIndex || 0);
    const curFloorWorldY = (info && info.floorY != null) ? Number(info.floorY)
        : (Array.isArray(info?.floors) && info.floors[curFloorIdx]?.yBase != null) ? Number(info.floors[curFloorIdx].yBase)
        : (baseWorldY + curFloorIdx * floorHeight);

    const toLocal = (p, fallbackY = curFloorWorldY) => [
        Number(p[0]) - camPos[0],
        Number(p[1] != null ? p[1] : fallbackY) - camY,
        Number(p[2]) - camPos[2],
    ];

    let floors = [];
    const rawFloors = (Array.isArray(info?.floors) && info.floors.length > 0)
        ? info.floors
        : (Array.isArray(bld?.floors) && bld.floors.length > 0 ? bld.floors : null);
    if (rawFloors) {
        if (rawFloors.length === 1) {
            const f = rawFloors[0];
            const fy = typeof f === "number" ? f : (f?.yBase ?? f?.y ?? baseWorldY);
            floors.push({ y: fy - camY, tolerance: 0.2, name: f?.name || "floor_0" });
        } else {
            const lo = Math.max(0, Math.min(curFloorIdx - 1, rawFloors.length - 2));
            const hi = Math.min(rawFloors.length - 1, Math.max(lo + 1, curFloorIdx + 1));
            for (let idx = lo; idx <= hi; idx++) {
                const f = rawFloors[idx];
                const fy = typeof f === "number" ? f : (f?.yBase ?? f?.y ?? (baseWorldY + idx * floorHeight));
                floors.push({ y: fy - camY, tolerance: 0.2, name: f?.name || `floor_${idx}` });
            }
        }
    } else {
        const totalFloorCount = Number(info?.totalFloors ?? bld?.totalFloors ?? (typeof bld?.floors === "number" ? bld.floors : 0));
        const f0 = Math.max(0, curFloorIdx > 0 ? curFloorIdx - 1 : 0);
        const fHi = totalFloorCount >= 1
            ? Math.min(totalFloorCount - 1, Math.max(f0, curFloorIdx + 1))
            : curFloorIdx;
        for (let idx = f0; idx <= fHi; idx++) {
            floors.push({ y: (baseWorldY + idx * floorHeight) - camY, tolerance: 0.2, name: `floor_${idx}` });
        }
    }

    const doorways = [];
    const rawDoors = (info && (info.doorways || info.doors)) || (bld && (bld.doorways || bld.doors));
    if (Array.isArray(rawDoors) && rawDoors.length > 0) {
        for (let i = 0; i < Math.min(8, rawDoors.length); i++) {
            const d = rawDoors[i];
            const p = toVec3(d.position || d.pos || d);
            if (!p) continue;
            const n = toVec3(d.normal) || (entry?.outDir ? [entry.outDir[0], 0, entry.outDir[1]] : [0, 0, 1]);
            doorways.push({
                name: d.name || `door_${i}`,
                position: toLocal(p, curFloorWorldY),
                normal: [n[0], 0, n[2]],
                width: d.width != null ? Number(d.width) : 0.9,
                height: d.height != null ? Number(d.height) : 2.1,
                depth: d.depth != null ? Number(d.depth) : 0.8,
            });
        }
    } else if (entry?.door && curFloorIdx <= 1) {
        const n = entry.outDir ? [entry.outDir[0], 0, entry.outDir[1]] : [0, 0, 1];
        doorways.push({
            name: "entrance_door",
            position: toLocal([entry.door[0], baseWorldY, entry.door[2]], baseWorldY),
            normal: n,
            width: 0.9,
            height: 2.1,
            depth: 0.8,
        });
    }

    const stairs = [];
    const rawStairs = (info && info.stairs) || (bld && bld.stairs);
    if (Array.isArray(rawStairs)) {
        for (let i = 0; i < Math.min(8, rawStairs.length); i++) {
            const s = rawStairs[i];
            const p0 = toVec3(s?.start || s?.bottom);
            const p1 = toVec3(s?.end || s?.top);
            if (p0 && p1) {
                stairs.push({
                    name: s.name || `stair_${i}`,
                    start: toLocal(p0, baseWorldY),
                    end: toLocal(p1, baseWorldY + floorHeight),
                    width: s.width != null ? Number(s.width) : 1.0,
                    headroom: s.headroom != null ? Number(s.headroom) : 2.1,
                });
            }
        }
    }

    const bCenter = getBuildingCenter(bld) || getBuildingCenter(info);
    const bWidth = Number(info?.width ?? bld?.width ?? 0);
    const bDepth = Number(info?.depth ?? bld?.depth ?? 0);
    let spatialFilter;
    if (bCenter && bWidth > 0 && bDepth > 0) {
        const halfSpan = Math.max(bWidth, bDepth) * 0.5 + 1.6;
        const cx = bCenter[0] - camPos[0];
        const cz = bCenter[2] - camPos[2];
        spatialFilter = {
            bounds: {
                min: [cx - halfSpan, -200, cz - halfSpan],
                max: [cx + halfSpan, 500, cz + halfSpan],
            },
        };
    } else {
        spatialFilter = { near: { center: [0, 0, 0], radius: 20 } };
    }

    return {
        groundY: baseWorldY - camY,
        ...spatialFilter,
        autoDetectFloors: floors.length === 0,
        ignoreFloating: ["metropolis_ground"],
        floors,
        interiorWalk: {
            enabled: true,
            agentRadius: 0.35,
            agentHeight: 1.75,
            stepUp: 0.35,
            ignoreNodes: ["metropolis_ground"],
            ...(doorways.length > 0 ? { doorways } : {}),
            ...(stairs.length > 0 ? { stairs } : {}),
        },
    };
}

export function assertStructureClean(scene, label, opts = {}) {
    const api = globalThis.__metropolis;
    let defaultGroundY = 0.0;
    let curAlt = 0;
    if (api && typeof api.getState === "function") {
        const cur = api.getState();
        if (cur && Array.isArray(cur.pos)) {
            if (cur.altitude != null && Number.isFinite(cur.altitude)) curAlt = cur.altitude;
            if (cur.groundY != null && Number.isFinite(cur.groundY)) {
                defaultGroundY = cur.groundY - cur.pos[1];
            } else if (cur.altitude != null && Number.isFinite(cur.altitude)) {
                defaultGroundY = -cur.altitude;
            }
        }
    }
    const resolvedGroundY = opts.groundY != null ? opts.groundY : defaultGroundY;
    const autoRadius = Math.max(120, Math.abs(resolvedGroundY) + 150, curAlt + 150);
    let resolvedGroundGrid = opts.groundGrid;
    if (!resolvedGroundGrid && !opts.floors && api && typeof api.getState === "function") {
        const cur = api.getState();
        const layout = api._subsystems && api._subsystems.layout;
        if (cur && Array.isArray(cur.pos) && layout && typeof layout.sampleGroundHeight === "function") {
            const gridR = Math.min(autoRadius + 12, 420);
            const step = gridR > 220 ? 5.0 : 2.0;
            const cols = Math.ceil((2 * gridR) / step) + 1;
            const rows = cols;
            const originX = -gridR;
            const originZ = -gridR;
            const camX = cur.pos[0];
            const camY = cur.pos[1];
            const camZ = cur.pos[2];
            const qx = Math.round(camX / 4);
            const qz = Math.round(camZ / 4);
            const cacheKey = `${qx}_${qz}_${gridR}_${step}`;
            if (!assertStructureClean._gridCache) assertStructureClean._gridCache = new Map();
            let worldH = assertStructureClean._gridCache.get(cacheKey);
            if (!worldH) {
                worldH = new Float32Array(cols * rows);
                const snapX = qx * 4;
                const snapZ = qz * 4;
                for (let r = 0; r < rows; r++) {
                    const wz = snapZ + originZ + r * step;
                    for (let c = 0; c < cols; c++) {
                        const wx = snapX + originX + c * step;
                        worldH[r * cols + c] = layout.sampleGroundHeight(wx, wz);
                    }
                }
                if (assertStructureClean._gridCache.size >= 16) {
                    assertStructureClean._gridCache.delete(assertStructureClean._gridCache.keys().next().value);
                }
                assertStructureClean._gridCache.set(cacheKey, worldH);
            }
            const heights = assertStructureClean._scratchH && assertStructureClean._scratchH.length === cols * rows
                ? assertStructureClean._scratchH
                : (assertStructureClean._scratchH = new Float32Array(cols * rows));
            for (let i = 0; i < heights.length; i++) heights[i] = worldH[i] - camY;
            resolvedGroundGrid = {
                originX: (qx * 4 - camX) + originX,
                originZ: (qz * 4 - camZ) + originZ,
                step, cols, rows, heights,
            };
        }
    }
    const ignoreFloating = Array.from(new Set(["metropolis_ground", ...(opts.ignoreFloating || [])]));
    const interiorWalk = opts.interiorWalk && typeof opts.interiorWalk === "object"
        ? {
            ...opts.interiorWalk,
            ignoreNodes: Array.from(new Set(["metropolis_ground", ...(opts.interiorWalk.ignoreNodes || [])])),
        }
        : opts.interiorWalk;
    const sOpts = {
        groundY: resolvedGroundY,
        ...(resolvedGroundGrid ? { groundGrid: resolvedGroundGrid } : {}),
        contactTol: opts.contactTol != null ? opts.contactTol : 0.05,
        overhangTol: opts.overhangTol != null ? opts.overhangTol : 0.35,
        checkIslands: opts.checkIslands !== undefined ? opts.checkIslands : true,
        autoDetectFloors: opts.autoDetectFloors !== undefined ? opts.autoDetectFloors : Boolean(opts.floors || opts.interiorWalk),
        ...(opts.near !== undefined
            ? (opts.near ? { near: opts.near } : {})
            : (!opts.bounds ? { near: { center: [0, 0, 0], radius: opts.nearRadius != null ? opts.nearRadius : autoRadius } } : {})),
        ignoreFloating,
        ...(opts.watchPairs ? { watchPairs: opts.watchPairs } : {}),
        ...(opts.bounds ? { bounds: opts.bounds } : {}),
        ...(opts.floors ? { floors: opts.floors } : {}),
        ...(interiorWalk !== undefined ? { interiorWalk } : {}),
    };
    const st = bro.eye.structure(scene, sOpts);
    const errMsgs = (st.issues || []).filter((i) => i.severity === "error").map((i) => i.message).slice(0, 6);
    eq(st.ok, true, `${label}: bro.eye.structure ok === true (${JSON.stringify(errMsgs)})`);
    eq(st.invertedCount, 0, `${label}: invertedCount === 0`);
    eq(st.floatingCount, 0, `${label}: floatingCount === 0`);
    eq(st.overhangCount, 0, `${label}: overhangCount === 0`);
    eq(st.gapCount, 0, `${label}: gapCount === 0`);
    const errors = (st.issues || []).filter((i) => i.severity === "error");
    eq(errors.length, 0, `${label}: zero structure error issues`);
    return st;
}

export function captureMotionFrames(count = 5, stepFn = null, motionOpts = {}) {
    const scene = getScene();
    const seq = [];
    for (let i = 0; i < count; i++) {
        if (i > 0) {
            if (stepFn) stepFn(i);
            else frames(2);
        }
        const snap = bro.eye.visualize([scene], { mode: "sheet", maxPanelDim: 360 });
        seq.push(new ImageData(snap.data, snap.width, snap.height));
    }
    return bro.eye.motion(seq, { threshold: motionOpts.threshold != null ? motionOpts.threshold : 2.5, ...motionOpts });
}

export async function runPerfMeasure(label, opts = {}) {
    if (opts.settle !== false) {
        await settle({ maxFrames: tier(400, 2000) });
    }
    if (typeof perf !== "undefined" && typeof perf.measure === "function") {
        perf.measure({ frames: tier(10, 60), warm: 0, stepMs: 5.0 });
    }
    const r = perf.measure({
        frames: opts.frames != null ? opts.frames : tier(30, 120),
        warm: opts.warm != null ? opts.warm : tier(5, 15),
        budget: opts.budget != null ? opts.budget : 5.0,
        stepMs: opts.stepMs != null ? opts.stepMs : 5.0,
        kernels: opts.kernels !== undefined ? opts.kernels : true,
        ...(opts.converge ? { converge: opts.converge } : {}),
        ...(opts.step ? { step: opts.step } : {}),
    });
    const timed = Boolean(r.gpu && r.gpu.max > 0);
    const meanMs = timed ? r.total.mean : r.wall.mean;
    const fps = meanMs > 0 ? 1000 / meanMs : 0;
    console.log(
        `[perf] ${label}: timed=${timed} fps=${fps.toFixed(1)} ` +
        `gpu.mean=${r.gpu.mean.toFixed(3)}ms kernels.mean=${r.kernels.mean.toFixed(3)}ms ` +
        `total.mean=${r.total.mean.toFixed(3)}ms total.p90=${r.total.p90.toFixed(3)}ms ` +
        `total.p99=${r.total.p99.toFixed(3)}ms total.max=${r.total.max.toFixed(3)}ms ` +
        `wall.mean=${r.wall.mean.toFixed(3)}ms over=${r.over} spill=${r.spill} spikes=${(r.spikes || []).length}`
    );
    return { ...r, timed, fps };
}
