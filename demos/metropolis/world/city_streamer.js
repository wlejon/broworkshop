// Unified sector streamer for Metropolis:
//   - Horizon LOD2 256m building quads (1 static draw call per quad, vertex-colored & albedo-matched)
//   - Mid-range LOD1 textured PBR buildings + static roads/bridges/viaducts (quad swap, zero pop)
//   - Enterable LOD0 buildings within 58m (doorway + furnished floors + InteriorVolume + tiled lights)
//   - 4 bro.flora tree species with disk-cached 8x4 impostors & static shadow proxies
//   - Pooled 96 GPU-tiled street/bridge Point lights for dusk & night

import { SECTOR_SIZE, riverCenterX, terrainHeight } from "/app/world/terrain_field.js";
import { buildSectorRoadAndBridgeNodes } from "/app/world/road_bridge_mesh.js";
import { buildBuildingLod2Data, buildBuildingLod1Nodes, buildBuildingLod0 } from "/lib/city-building-mesh.js";
import { growSpecies, buildSpeciesLevels, bakeSpeciesImpostor, createTreeStand } from "/lib/flora-trees.js";

const SUB_SIZE = 256;
const LOD2_RADIUS_SEC = 5;   // +/- 5 sectors = 5.6km diameter horizon skyline
const ROAD_RADIUS_SEC = 2;   // +/- 2 sectors static road/bridge/viaduct meshes
const LOD1_DIST = 340;       // promote 256m quad from LOD2 -> LOD1 textured PBR within 340m 3D
const LOD0_DIST = 56;        // promote up to 3 nearest buildings to enterable LOD0 within 56m
const MAX_LOD0 = 3;

export function createCityStreamer({ scene, graph, mats, hideOnBake = [] }) {
    const quadCache = new Map();       // "qx,qz" -> { qx, qz, bps, lod2, lod1List, lod1Built, mode }
    const roadSectorNodes = new Map(); // "sx,sz" -> built road/bridge handle
    const lod0Active = new Map();      // bp.id -> { bp, lod0, lod1Ref }
    const speciesList = [];
    let treeStand = null;
    let disposed = false;

    // Pooled GPU-tiled amber streetlights (bounded non-shadow Point lights)
    const streetLights = [];
    for (let i = 0; i < 96; i++) {
        streetLights.push(scene.createLight({
            type: 'point',
            position: [0, -500, 0],
            color: [1.0, 0.78, 0.46],
            intensity: 0,
            range: 52,
            castsShadow: false,
        }));
    }
    let lastLightPos = [NaN, NaN, NaN];
    let lastNightFactor = 0;

    function getQuadKey(qx, qz) { return `${qx},${qz}`; }

    function ensureQuad(qx, qz) {
        const key = getQuadKey(qx, qz);
        if (quadCache.has(key)) return quadCache.get(key);

        const sx = Math.floor(qx / 2), sz = Math.floor(qz / 2);
        const sec = graph.getSectorData(sx, sz);
        const x0 = qx * SUB_SIZE, x1 = x0 + SUB_SIZE;
        const z0 = qz * SUB_SIZE, z1 = z0 + SUB_SIZE;

        const bps = [];
        const lod2Meshes = [];
        for (const bp of sec.buildings) {
            if (bp.x < x0 || bp.x >= x1 || bp.z < z0 || bp.z >= z1) continue;
            bps.push(bp);
            const m = buildBuildingLod2Data(bp, mats);
            lod2Meshes.push(m.rotate(0, 1, 0, bp.yaw).translate(bp.x, bp.groundY, bp.z));
        }

        let lod2 = null;
        if (lod2Meshes.length > 0) {
            const distSq = sx * sx + sz * sz;
            lod2 = scene.createMesh({
                data: Mesh.merge(lod2Meshes),
                color: [1, 1, 1],
                roughness: 0.72,
                metallic: 0.08,
                vertexColorTint: true,
                castsShadow: distSq <= 9,
                receivesShadow: true,
            });
        }

        const q = {
            qx, qz,
            cx: x0 + SUB_SIZE * 0.5,
            cz: z0 + SUB_SIZE * 0.5,
            bps,
            lod2,
            lod1Map: null,
            mode: 'lod2',
        };
        quadCache.set(key, q);
        return q;
    }

    function setQuadMode(q, targetMode) {
        if (q.mode === targetMode) return;
        if (targetMode === 'lod1') {
            if (!q.lod1Map) {
                q.lod1Map = new Map();
                for (const bp of q.bps) {
                    const h = buildBuildingLod1Nodes(scene, bp, mats, { castsShadow: true });
                    h.setNight?.(lastNightFactor);
                    q.lod1Map.set(bp.id, h);
                }
            }
            if (q.lod2) q.lod2.visible = false;
            for (const [id, handle] of q.lod1Map) {
                handle.root.visible = !lod0Active.has(id);
            }
        } else {
            if (q.lod2) q.lod2.visible = true;
            if (q.lod1Map) {
                for (const handle of q.lod1Map.values()) handle.root.visible = false;
            }
        }
        q.mode = targetMode;
    }

    function relocateStreetLights(eye) {
        if (!Number.isNaN(lastLightPos[0]) && Math.hypot(eye[0] - lastLightPos[0], eye[2] - lastLightPos[2]) < 48) return;
        lastLightPos[0] = eye[0]; lastLightPos[1] = eye[1]; lastLightPos[2] = eye[2];
        const csx = Math.floor(eye[0] / SECTOR_SIZE), csz = Math.floor(eye[2] / SECTOR_SIZE);

        const spots = [];
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
            const sec = graph.getSectorData(csx + dx, csz + dz);
            for (const seg of sec.roads) {
                if (!seg.isBridge && seg.kind !== 'boulevard' && seg.kind !== 'urban' && seg.kind !== 'suburb') continue;
                const mx = 0.5 * (seg.x0 + seg.x1), mz = 0.5 * (seg.z0 + seg.z1);
                const d2 = (mx - eye[0]) ** 2 + (mz - eye[2]) ** 2;
                const len = Math.hypot(seg.x1 - seg.x0, seg.z1 - seg.z0);
                const nx = -(seg.z1 - seg.z0) / (len || 1), nz = (seg.x1 - seg.x0) / (len || 1);
                const side = (seg.id & 1) ? 1 : -1;
                const y = graph.sampleRoadDeckY(seg, 0.5) + 6.2;
                spots.push({
                    d2,
                    x: mx + nx * side * (seg.halfW + 1.2),
                    y,
                    z: mz + nz * side * (seg.halfW + 1.2),
                });
                if (seg.isBridge) {
                    for (const t of [0.3, 0.7]) {
                        const bx = seg.x0 + (seg.x1 - seg.x0) * t, bz = seg.z0 + (seg.z1 - seg.z0) * t;
                        spots.push({
                            d2: (bx - eye[0]) ** 2 + (bz - eye[2]) ** 2,
                            x: bx - nx * side * (seg.halfW + 1.2),
                            y: graph.sampleRoadDeckY(seg, t) + 6.2,
                            z: bz - nz * side * (seg.halfW + 1.2),
                        });
                    }
                }
            }
        }
        spots.sort((a, b) => a.d2 - b.d2);
        for (let i = 0; i < streetLights.length; i++) {
            const l = streetLights[i];
            if (i < spots.length) {
                l.position = [spots[i].x, spots[i].y, spots[i].z];
            } else {
                l.position = [eye[0], -500, eye[2]];
            }
        }
    }

    function initFoliage(initEye) {
        const names = ['oak', 'birch', 'elm', 'pine'];
        for (let i = 0; i < names.length; i++) {
            const sp = growSpecies(names[i], { seconds: 30, seed: 0xc0f1 + i * 97 });
            sp.levels = buildSpeciesLevels(scene, sp, {
                levels: [
                    { from: 0, L: 3, sides: 6, area: 1.0 },
                    { from: 42, L: 6, sides: 5, area: 0.85 },
                ],
            });
            sp.imp = bakeSpeciesImpostor(scene, sp, { hideNodes: hideOnBake });
            speciesList.push(sp);
        }

        // Gather core trees across [-5..5] sectors around valley center
        const allTrees = [];
        for (let sz = -5; sz <= 5; sz++) for (let sx = -5; sx <= 5; sx++) {
            const sec = graph.getSectorData(sx, sz);
            for (const t of sec.trees) {
                const sp = speciesList[t.speciesIdx % speciesList.length];
                allTrees.push({ sp, x: t.x, y: t.y, z: t.z, yaw: t.yaw, size: t.size, r: sp.radius * t.size });
            }
        }
        treeStand = createTreeStand(scene, speciesList, allTrees, {
            handoff: 62,
            shadowProxy: true,
            closeLod: true,
            maxClose: 18,
        });
        treeStand.update(initEye);
    }

    function init(initialEye = [riverCenterX(0) - 240, 28, 120]) {
        // Bake / load tree impostors BEFORE building world sector meshes around (0,0,0)
        initFoliage(initialEye);
        const csx = Math.floor(initialEye[0] / SECTOR_SIZE), csz = Math.floor(initialEye[2] / SECTOR_SIZE);
        for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
            const sx = csx + dx, sz = csz + dz;
            const k = `${sx},${sz}`;
            if (Math.abs(dx) <= ROAD_RADIUS_SEC && Math.abs(dz) <= ROAD_RADIUS_SEC && !roadSectorNodes.has(k)) {
                roadSectorNodes.set(k, buildSectorRoadAndBridgeNodes(scene, graph, graph.getSectorData(sx, sz), mats));
            }
            for (let qz = 0; qz < 2; qz++) for (let qx = 0; qx < 2; qx++) {
                ensureQuad(sx * 2 + qx, sz * 2 + qz);
            }
        }
        update(initialEye, 0, 0, true);
    }

    function update(eye, dt = 0, nightFactor = 0, forceAll = false) {
        if (disposed) return;
        const ex = eye[0], ey = eye[1], ez = eye[2];
        const csx = Math.floor(ex / SECTOR_SIZE), csz = Math.floor(ez / SECTOR_SIZE);

        // 1. Road/bridge/viaduct sector meshes
        const keepRoads = new Set();
        let builtBudget = forceAll ? 64 : 2;
        for (let dz = -ROAD_RADIUS_SEC; dz <= ROAD_RADIUS_SEC; dz++) {
            for (let dx = -ROAD_RADIUS_SEC; dx <= ROAD_RADIUS_SEC; dx++) {
                const sx = csx + dx, sz = csz + dz;
                const k = `${sx},${sz}`;
                keepRoads.add(k);
                if (!roadSectorNodes.has(k) && builtBudget > 0) {
                    roadSectorNodes.set(k, buildSectorRoadAndBridgeNodes(scene, graph, graph.getSectorData(sx, sz), mats));
                    builtBudget--;
                }
            }
        }
        for (const [k, handle] of roadSectorNodes) {
            if (keepRoads.has(k)) continue;
            handle.destroy();
            roadSectorNodes.delete(k);
        }

        // 2. Building quads (LOD2 horizon out to +/- 5 sectors; LOD1 textured within 340m 3D)
        const cqx = Math.floor(ex / SUB_SIZE), cqz = Math.floor(ez / SUB_SIZE);
        const radQ = LOD2_RADIUS_SEC * 2;
        const keepQuads = new Set();
        let quadBudget = forceAll ? 256 : 4;
        const lod0Cands = [];

        for (let dz = -radQ; dz <= radQ; dz++) for (let dx = -radQ; dx <= radQ; dx++) {
            const qx = cqx + dx, qz = cqz + dz;
            const key = getQuadKey(qx, qz);
            keepQuads.add(key);
            if (!quadCache.has(key)) {
                if (quadBudget <= 0) continue;
                quadBudget--;
            }
            const q = ensureQuad(qx, qz);
            const dist3D = Math.hypot(q.cx - ex, Math.max(0, ey - 18) * 1.15, q.cz - ez);
            const wantMode = dist3D < LOD1_DIST ? 'lod1' : 'lod2';
            if (wantMode === 'lod1' && q.mode !== 'lod1' && !q.lod1Map && !forceAll && quadBudget <= 0) {
                continue;
            }
            if (wantMode === 'lod1' && !q.lod1Map) quadBudget = Math.max(0, quadBudget - 1);
            setQuadMode(q, wantMode);

            if (wantMode === 'lod1') {
                for (const bp of q.bps) {
                    const d = Math.hypot(bp.x - ex, (bp.groundY + 2 - ey), bp.z - ez);
                    if (d < LOD0_DIST + Math.max(bp.width, bp.depth) * 0.5) {
                        lod0Cands.push([d, bp, q]);
                    }
                }
            }
        }

        // Evict far quads (> radQ + 2)
        for (const [key, q] of quadCache) {
            if (Math.abs(q.qx - cqx) <= radQ + 2 && Math.abs(q.qz - cqz) <= radQ + 2) continue;
            if (q.lod2) q.lod2.destroy();
            if (q.lod1Map) for (const h of q.lod1Map.values()) h.destroy();
            quadCache.delete(key);
        }

        // 3. Promote nearest <= MAX_LOD0 buildings to enterable LOD0
        lod0Cands.sort((a, b) => a[0] - b[0]);
        if (lod0Cands.length > MAX_LOD0) lod0Cands.length = MAX_LOD0;
        const wantLod0 = new Set(lod0Cands.map((c) => c[1].id));

        for (const [id, entry] of lod0Active) {
            if (wantLod0.has(id)) continue;
            entry.lod0.destroy();
            if (entry.q.lod1Map?.has(id)) {
                entry.q.lod1Map.get(id).root.visible = (entry.q.mode === 'lod1');
            }
            lod0Active.delete(id);
        }
        for (const [, bp, q] of lod0Cands) {
            if (lod0Active.has(bp.id)) continue;
            if (q.lod1Map?.has(bp.id)) q.lod1Map.get(bp.id).root.visible = false;
            const lod0 = buildBuildingLod0(scene, bp, mats, { castsShadow: true });
            lod0.setNight?.(nightFactor);
            lod0Active.set(bp.id, { bp, lod0, q });
        }

        // 4. Flora trees & tiled streetlights & building window emissives
        if (treeStand) treeStand.update(eye);
        relocateStreetLights(eye);
        if (Math.abs(nightFactor - lastNightFactor) > 0.02 || forceAll) {
            lastNightFactor = nightFactor;
            const intensity = nightFactor > 0.05 ? nightFactor * 420 : 0;
            for (const l of streetLights) l.intensity = intensity;
            for (const q of quadCache.values()) {
                if (q.lod1Map) for (const h of q.lod1Map.values()) h.setNight?.(nightFactor);
            }
            for (const e of lod0Active.values()) e.lod0.setNight?.(nightFactor);
        }
    }

    function findBuildingContaining(x, y, z) {
        for (const entry of lod0Active.values()) {
            const bp = entry.bp;
            const dx = x - bp.x, dz = z - bp.z;
            const cy = Math.cos(bp.yaw), sy = Math.sin(bp.yaw);
            const lx = cy * dx - sy * dz, lz = sy * dx + cy * dz;
            const top = bp.groundY + bp.tiers[0].floorH;
            if (Math.abs(lx) <= bp.width * 0.48 && Math.abs(lz) <= bp.depth * 0.48 && y >= bp.groundY - 0.5 && y <= top) {
                return bp;
            }
        }
        return null;
    }

    function getActiveLod0List() {
        return Array.from(lod0Active.values()).map((e) => e.bp);
    }

    return {
        init,
        update,
        findBuildingContaining,
        getActiveLod0List,
        stats: () => ({
            activeQuads: quadCache.size,
            roadSectors: roadSectorNodes.size,
            activeLod0: lod0Active.size,
            totalTrees: treeStand ? treeStand.stats().totalTrees : 0,
            closeTrees: treeStand ? treeStand.stats().closeMeshes : 0,
        }),
        destroy() {
            if (disposed) return;
            disposed = true;
            for (const e of lod0Active.values()) e.lod0.destroy();
            lod0Active.clear();
            for (const h of roadSectorNodes.values()) h.destroy();
            roadSectorNodes.clear();
            for (const q of quadCache.values()) {
                if (q.lod2) q.lod2.destroy();
                if (q.lod1Map) for (const h of q.lod1Map.values()) h.destroy();
            }
            quadCache.clear();
            if (treeStand) treeStand.destroy();
            for (const l of streetLights) l.destroy();
        },
    };
}
