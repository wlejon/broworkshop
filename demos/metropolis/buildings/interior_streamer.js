// Zero-churn on-demand building interior streamer with mid-tier parallax shells,
// pitched roofs, porches, storefront awnings, skyscraper crowns, oak/marble interiors, and room culling.
import {
    getBuildingBlueprint,
    getBuildingMass,
    localToWorld,
    worldToLocal,
} from '/app/buildings/building_gen.js';
import {
    createParallaxShellMesh,
    createSolidBoxMesh,
    createWallDoorMesh,
    createWallWindowMesh,
    createWindowGlassMesh,
    createStairFlightMesh,
    createElevatorCabMesh,
    createGableRoofMesh,
    createHipRoofMesh,
    createPorchCanopyMesh,
    createStorefrontAwningMesh,
    createSkyCrownSteppedMesh,
    createSkyCrownSpireMesh,
    createRoofHvacMesh,
    createTableMesh,
    createChairMesh,
    createDeskMesh,
    createSofaMesh,
    createBedMesh,
    createCounterMesh,
    createShelfMesh,
    createLampMesh,
    createPlantMesh,
    createRugMesh,
    createCeilingLightMesh,
    createWallArtMesh,
} from '/app/buildings/building_meshes.js';

const fs = require('fs');

const MAX_PARALLAX = 2048;
const WALL_THICK = 0.24;
const ENTER_DIST = 74;
const EXIT_DIST = 88;
const MAX_FURNISHED = 6;

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

function kindCode(kind) {
    if (kind === 'home') return 0;
    if (kind === 'business') return 1;
    return 2;
}

const HOME_ROOF_COLORS = [
    [0.24, 0.22, 0.24, 1], // slate charcoal
    [0.38, 0.22, 0.17, 1], // warm cedar shingle
    [0.26, 0.29, 0.25, 1], // heritage moss
    [0.30, 0.26, 0.23, 1], // weathered brown
];

const AWNING_COLORS = [
    [0.62, 0.18, 0.16, 1], // bistro red
    [0.14, 0.34, 0.26, 1], // emerald canvas
    [0.16, 0.26, 0.44, 1], // navy canvas
    [0.66, 0.46, 0.16, 1], // warm ochre
];

export function createInteriorStreamer(scene, pools, layout, _horizon) {
    const parallaxSrc = fs.readFileSync(bro.resolvePath('/app/shaders/building_parallax.bk'), 'utf-8');
    const shellMetaBuf = bro.kernel.createBuffer(MAX_PARALLAX * 2 * 16);
    const shellMetaF32 = new Float32Array(MAX_PARALLAX * 8);

    const parallaxBatch = pools.registerBatch('parallax_shells', createParallaxShellMesh, {
        capacity: MAX_PARALLAX,
        module: parallaxSrc,
        file: 'shaders/building_parallax.bk',
        uniforms: { glow_scale: 0.45, night_factor: 0.0, time: 0.0, pad0: 0.0 },
        glowScale: 0.45,
        castsShadow: true,
        receivesShadow: true,
        doubleSided: false,
        drawOrder: 7,
        fadeOutDist: 420,
    });
    parallaxBatch.setBuffer('shell_meta', shellMetaBuf);

    // Close-up enterable pools keep fadeOutDist = 0 so hardware early-Z remains enabled.
    const extWallBatch = pools.registerBatch('bldg_ext_walls', () => createSolidBoxMesh(0, 0), {
        capacity: 4096, glowScale: 0.45, castsShadow: true, receivesShadow: true, drawOrder: 4, fadeOutDist: 0,
    });
    const extDoorBatch = pools.registerBatch('bldg_ext_doors', () => createWallDoorMesh(0, 0), {
        capacity: 512, glowScale: 0.45, castsShadow: true, receivesShadow: true, drawOrder: 4, fadeOutDist: 0,
    });
    const extWinBatch = pools.registerBatch('bldg_ext_windows', () => createWallWindowMesh(0, 0), {
        capacity: 2048, glowScale: 0.45, castsShadow: true, receivesShadow: true, drawOrder: 4, fadeOutDist: 0,
    });
    const extGlassBatch = pools.registerBatch('bldg_ext_glass', createWindowGlassMesh, {
        capacity: 2048,
        color: [0.56, 0.74, 0.86, 0.44],
        glowScale: 0.45,
        castsShadow: false,
        receivesShadow: true,
        doubleSided: false,
        drawOrder: 14,
        fadeOutDist: 0,
    });
    const oakSlabBatch = pools.registerBatch('bldg_Slab', () => createSolidBoxMesh(2, 1.0), {
        capacity: 1536, glowScale: 0.45, castsShadow: true, receivesShadow: true, drawOrder: 6, fadeOutDist: 0,
    });
    const marbleSlabBatch = pools.registerBatch('bldg_Slab_marble', () => createSolidBoxMesh(2, 2.0), {
        capacity: 512, glowScale: 0.45, castsShadow: true, receivesShadow: true, drawOrder: 6, fadeOutDist: 0,
    });
    const roofBatch = pools.registerBatch('bldg_roofs', () => createSolidBoxMesh(7, 0), {
        capacity: 512, glowScale: 0.45, castsShadow: true, receivesShadow: true, drawOrder: 6, fadeOutDist: 0,
    });
    const intWallBatch = pools.registerBatch('bldg_int_walls', () => createSolidBoxMesh(0, 1.0), {
        capacity: 2048, glowScale: 0.45, castsShadow: true, receivesShadow: true, drawOrder: 8, fadeOutDist: 0,
    });
    const intWinBatch = pools.registerBatch('bldg_int_windows', () => createWallWindowMesh(0, 1.0), {
        capacity: 1024, glowScale: 0.45, castsShadow: true, receivesShadow: true, drawOrder: 8, fadeOutDist: 0,
    });
    const intDoorBatch = pools.registerBatch('bldg_int_doors', () => createWallDoorMesh(0, 1.0), {
        capacity: 1024, glowScale: 0.45, castsShadow: true, receivesShadow: true, drawOrder: 8, fadeOutDist: 0,
    });
    const stairBatch = pools.registerBatch('bldg_stairs', () => createStairFlightMesh(18), {
        capacity: 256, glowScale: 0.45, castsShadow: true, receivesShadow: true, drawOrder: 9, fadeOutDist: 0,
    });
    const elevBatch = pools.registerBatch('bldg_elevators', createElevatorCabMesh, {
        capacity: 64, glowScale: 0.45, castsShadow: true, receivesShadow: true, drawOrder: 9, fadeOutDist: 0,
    });

    // Architectural roof/crown/awning silhouettes
    const archBatches = {
        gable:  pools.registerBatch('arch_roof_gable', createGableRoofMesh, { capacity: 512, castsShadow: true, drawOrder: 7, fadeOutDist: 420 }),
        hip:    pools.registerBatch('arch_roof_hip', createHipRoofMesh, { capacity: 512, castsShadow: true, drawOrder: 7, fadeOutDist: 420 }),
        porch:  pools.registerBatch('arch_porch', createPorchCanopyMesh, { capacity: 256, castsShadow: true, drawOrder: 7, fadeOutDist: 160 }),
        awning: pools.registerBatch('arch_awning', createStorefrontAwningMesh, { capacity: 256, castsShadow: true, drawOrder: 7, fadeOutDist: 200 }),
        crownA: pools.registerBatch('arch_crown_step', createSkyCrownSteppedMesh, { capacity: 256, castsShadow: true, drawOrder: 7, fadeOutDist: 420 }),
        crownB: pools.registerBatch('arch_crown_spire', createSkyCrownSpireMesh, { capacity: 256, castsShadow: true, drawOrder: 7, fadeOutDist: 420 }),
        hvac:   pools.registerBatch('arch_hvac', createRoofHvacMesh, { capacity: 512, castsShadow: true, drawOrder: 7, fadeOutDist: 320 }),
    };

    const furnBatches = {
        table:         pools.registerBatch('furn_table', createTableMesh, { capacity: 512, castsShadow: true, drawOrder: 12, fadeOutDist: 0 }),
        chair:         pools.registerBatch('furn_chair', createChairMesh, { capacity: 768, castsShadow: true, drawOrder: 12, fadeOutDist: 0 }),
        desk:          pools.registerBatch('furn_desk', createDeskMesh, { capacity: 512, castsShadow: true, drawOrder: 12, fadeOutDist: 0 }),
        sofa:          pools.registerBatch('furn_sofa', createSofaMesh, { capacity: 384, castsShadow: true, drawOrder: 12, fadeOutDist: 0 }),
        bed:           pools.registerBatch('furn_bed', createBedMesh, { capacity: 256, castsShadow: true, drawOrder: 12, fadeOutDist: 0 }),
        counter:       pools.registerBatch('furn_counter', createCounterMesh, { capacity: 256, castsShadow: true, drawOrder: 12, fadeOutDist: 0 }),
        shelf:         pools.registerBatch('furn_shelf', createShelfMesh, { capacity: 512, castsShadow: true, drawOrder: 12, fadeOutDist: 0 }),
        lamp:          pools.registerBatch('furn_lamp', createLampMesh, { capacity: 512, castsShadow: true, drawOrder: 12, fadeOutDist: 0 }),
        plant:         pools.registerBatch('furn_plant', createPlantMesh, { capacity: 512, castsShadow: true, drawOrder: 12, fadeOutDist: 0 }),
        rug:           pools.registerBatch('furn_rug', createRugMesh, { capacity: 512, castsShadow: true, drawOrder: 11, fadeOutDist: 0 }),
        ceiling_light: pools.registerBatch('furn_ceil_light', createCeilingLightMesh, { capacity: 512, castsShadow: false, drawOrder: 12, fadeOutDist: 0 }),
        wall_art:      pools.registerBatch('furn_wall_art', createWallArtMesh, { capacity: 384, castsShadow: true, drawOrder: 12, fadeOutDist: 0 }),
    };

    const enterableSet = new Set();
    const bpById = new Map();
    const visibleRooms = new Set();
    const nearbyCandidates = [];
    const stats = {
        activeInteriors: 0,
        enterableShells: 0,
        parallaxCount: 0,
        culledRooms: 0,
        streamedFloors: 0,
    };

    function getBlueprintAt(pos) {
        const [bx0, bz0] = layout.worldToBlock(pos[0], pos[2]);
        for (let bz = bz0 - 1; bz <= bz0 + 1; bz++) {
            for (let bx = bx0 - 1; bx <= bx0 + 1; bx++) {
                const parcels = layout.getParcelsInBlock(bx, bz);
                for (let i = 0; i < parcels.length; i++) {
                    const p = parcels[i];
                    if (p.kind === 'park') continue;
                    const m = getBuildingMass(p);
                    const dx = pos[0] - m.originX;
                    const dz = pos[2] - m.originZ;
                    const c = Math.cos(m.rot), s = Math.sin(m.rot);
                    const lx = c * dx - s * dz;
                    const lz = s * dx + c * dz;
                    if (lx >= -m.halfW - 1.5 && lx <= m.halfW + 1.5 && lz >= -m.halfD - 1.5 && lz <= m.halfD + 1.5) {
                        const bp = getBuildingBlueprint(p);
                        bpById.set(bp.id, bp);
                        return bp;
                    }
                }
            }
        }
        return null;
    }

    function getActiveBuilding(pos) {
        const bp = getBlueprintAt(pos);
        if (!bp) return null;
        const [lx, ly, lz] = worldToLocal(bp, pos[0], pos[1], pos[2]);
        const eb = bp.exteriorBox;
        const insideFootprint = lx >= eb.minX && lx <= eb.maxX && lz >= eb.minZ && lz <= eb.maxZ;
        const insideY = ly >= eb.minY - 0.5 && ly <= eb.maxY + 0.5;
        const floorIndex = clamp(Math.floor((ly - bp.baseY + 0.25) / bp.floorHeight), 0, bp.totalFloors - 1);
        const fl = bp.floors[floorIndex];
        let roomId = null;
        let roomRole = null;
        let activeRoomCenter = null;
        if (insideFootprint && fl) {
            const c = clamp(Math.floor((lx + bp.halfW) / bp.cellSize), 0, bp.cols - 1);
            const r = clamp(Math.floor((lz + bp.halfD) / bp.cellSize), 0, bp.rows - 1);
            const rid = fl.cellRoom[r][c];
            roomId = rid;
            if (rid >= 0 && fl.rooms[rid]) {
                const rm = fl.rooms[rid];
                roomRole = rm.role;
                activeRoomCenter = localToWorld(bp, 0.5 * (rm.x0 + rm.x1), fl.yCeil - 0.45, 0.5 * (rm.z0 + rm.z1));
            } else if (rid === -2) roomRole = 'stairwell';
            else if (rid === -3 || (bp.elevatorShaft && c === bp.elevatorShaft.c && r === bp.elevatorShaft.r)) roomRole = 'elevator';
        }
        return {
            blueprint: bp,
            buildingId: bp.id,
            kind: bp.kind,
            inside: insideFootprint && insideY,
            floorIndex,
            roomId,
            roomRole,
            activeRoomCenter,
            localPos: [lx, ly, lz],
        };
    }

    function pushParallaxMass(m, camPos, yBase, height, w, d, cxLocal, czLocal, yOffset) {
        const idx = parallaxBatch.count();
        if (idx >= MAX_PARALLAX) return;
        const c = Math.cos(m.rot), s = Math.sin(m.rot);
        const wx = m.originX + c * cxLocal + s * czLocal;
        const wz = m.originZ - s * cxLocal + c * czLocal;
        const pushed = parallaxBatch.pushRel(wx, yBase, wz, camPos, 0, m.rot, 0, w, height, d, m.palette);
        if (pushed < 0) return;
        const o = pushed * 8;
        shellMetaF32[o + 0] = w;
        shellMetaF32[o + 1] = height;
        shellMetaF32[o + 2] = d;
        shellMetaF32[o + 3] = m.floorHeight;
        shellMetaF32[o + 4] = (m.seedMod ?? 0.5);
        shellMetaF32[o + 5] = kindCode(m.kind);
        shellMetaF32[o + 6] = yOffset;
        shellMetaF32[o + 7] = m.archStyle ?? 0;
        stats.parallaxCount++;
    }

    function pushRoofSilhouette(m, camPos, topW, topD, topY, cxLocal, czLocal, closeDist) {
        const c = Math.cos(m.rot), s = Math.sin(m.rot);
        const wx = m.originX + c * cxLocal + s * czLocal;
        const wz = m.originZ - s * cxLocal + c * czLocal;
        if (m.kind === 'home') {
            const roofH = Math.max(1.8, Math.min(3.4, topW * 0.25));
            const batch = (m.roofVariant & 1) === 0 ? archBatches.gable : archBatches.hip;
            const col = HOME_ROOF_COLORS[m.archStyle % HOME_ROOF_COLORS.length];
            batch.pushRel(wx, topY, wz, camPos, 0, m.rot, 0, topW, roofH, topD, col);
            if (closeDist < 82) {
                const px = m.originX + s * (m.halfD);
                const pz = m.originZ + c * (m.halfD);
                archBatches.porch.pushRel(px, m.baseY, pz, camPos, 0, m.rot, 0, 1, 1, 1, [0.88, 0.86, 0.82, 1]);
            }
        } else if (m.kind === 'business') {
            if (closeDist < 190) {
                archBatches.hvac.pushRel(wx, topY, wz, camPos, 0, m.rot, 0, Math.min(4.2, topW * 0.35), 1.4, Math.min(3.6, topD * 0.35), [0.46, 0.48, 0.52, 1]);
                const px = m.originX + s * (m.halfD);
                const pz = m.originZ + c * (m.halfD);
                const col = AWNING_COLORS[m.archStyle % AWNING_COLORS.length];
                archBatches.awning.pushRel(px, m.baseY + m.floorHeight * 0.78, pz, camPos, 0, m.rot, 0, Math.max(4.0, topW * 0.65), 1.1, 1.35, col);
            }
        } else {
            // Skyscrapers: varied architectural crowns & rooftop penthouses
            if ((m.archStyle & 1) === 0) {
                const crownH = clamp(m.totalFloors * 0.38, 6.0, 16.0);
                archBatches.crownA.pushRel(wx, topY, wz, camPos, 0, m.rot, 0, topW * 0.84, crownH, topD * 0.84, m.palette);
            } else {
                const crownH = clamp(m.totalFloors * 0.46, 8.0, 22.0);
                archBatches.crownB.pushRel(wx, topY, wz, camPos, 0, m.rot, 0, topW * 0.78, crownH, topD * 0.78, [0.34, 0.38, 0.44, 1]);
            }
        }
    }

    function pushSlabList(bp, fl, camPos) {
        const useMarble = bp.kind === 'skyscraper' && fl.index === 0;
        const sb = useMarble ? marbleSlabBatch : oakSlabBatch;
        for (let i = 0; i < fl.slabTiles.length; i++) {
            const s = fl.slabTiles[i];
            const sx = s.x1 - s.x0;
            const sz = s.z1 - s.z0;
            const cx = 0.5 * (s.x0 + s.x1);
            const cz = 0.5 * (s.z0 + s.z1);
            const [wx, wy, wz] = localToWorld(bp, cx, fl.yBase - s.thick, cz);
            const tint = s.isPorch ? [0.54, 0.52, 0.49, 1] : [0.82, 0.80, 0.76, 1];
            (s.isPorch ? oakSlabBatch : sb).pushRel(wx, wy, wz, camPos, 0, bp.rot, 0, sx, s.thick, sz, tint);
        }
        if (fl.terraceSlabs) {
            for (let i = 0; i < fl.terraceSlabs.length; i++) {
                const s = fl.terraceSlabs[i];
                const sx = s.x1 - s.x0;
                const sz = s.z1 - s.z0;
                const cx = 0.5 * (s.x0 + s.x1);
                const cz = 0.5 * (s.z0 + s.z1);
                const [wx, wy, wz] = localToWorld(bp, cx, fl.yCeil - s.thick, cz);
                oakSlabBatch.pushRel(wx, wy, wz, camPos, 0, bp.rot, 0, sx, s.thick, sz, [0.42, 0.43, 0.45, 1]);
            }
        }
    }

    function emitFloorGeometry(bp, fl, camPos, isActiveBuilding, activeFloor, activeRoomId, emitInterior, elevators) {
        stats.streamedFloors++;
        pushSlabList(bp, fl, camPos);

        const wallH = bp.floorHeight;
        const cullRooms = isActiveBuilding && fl.index === activeFloor && activeRoomId != null && activeRoomId >= 0;
        visibleRooms.clear();
        if (cullRooms && fl.rooms[activeRoomId]) {
            visibleRooms.add(activeRoomId);
            const nbs = fl.rooms[activeRoomId].neighbors;
            for (let i = 0; i < nbs.length; i++) visibleRooms.add(nbs[i]);
            stats.culledRooms += Math.max(0, fl.rooms.length - visibleRooms.size);
        }

        for (let i = 0; i < fl.wallSegs.length; i++) {
            const w = fl.wallSegs[i];
            if (!w.isExt && !emitInterior) continue;
            if (!w.isExt && cullRooms && w.type === 'solid') {
                const visA = w.roomA >= 0 && visibleRooms.has(w.roomA);
                const visB = w.roomB >= 0 && visibleRooms.has(w.roomB);
                if (!visA && !visB && w.roomA !== -2 && w.roomB !== -2 && w.roomA !== -3 && w.roomB !== -3) continue;
            }
            const [wx, wy, wz] = localToWorld(bp, w.x, fl.yBase, w.z);
            const rotY = bp.rot + w.ry;
            if (w.isExt) {
                if (w.type === 'door') extDoorBatch.pushRel(wx, wy, wz, camPos, 0, rotY, 0, w.length, wallH, WALL_THICK, w.tint);
                else if (w.type === 'window') {
                    extWinBatch.pushRel(wx, wy, wz, camPos, 0, rotY, 0, w.length, wallH, WALL_THICK, w.tint);
                    extGlassBatch.pushRel(wx, wy, wz, camPos, 0, rotY, 0, w.length, wallH, WALL_THICK, [1, 1, 1, 1]);
                } else extWallBatch.pushRel(wx, wy, wz, camPos, 0, rotY, 0, w.length, wallH, WALL_THICK, w.tint);
            } else {
                if (w.type === 'door') {
                    intDoorBatch.pushRel(wx, wy, wz, camPos, 0, rotY, 0, w.length, wallH, WALL_THICK, w.tint);
                    if ((w.roomA === -3 || w.roomB === -3) && elevators && !elevators.isDoorOpenAt(bp.id, fl.index)) {
                        intWallBatch.pushRel(wx, wy, wz, camPos, 0, rotY, 0, w.length * 0.72, wallH * 0.78, 0.08, [0.42, 0.46, 0.52, 1]);
                    }
                } else if (bp.kind !== 'home' && w.roomA >= 0 && w.roomB >= 0) {
                    intWinBatch.pushRel(wx, wy, wz, camPos, 0, rotY, 0, w.length, wallH, WALL_THICK, w.tint);
                    extGlassBatch.pushRel(wx, wy, wz, camPos, 0, rotY, 0, w.length, wallH, WALL_THICK, [1, 1, 1, 1]);
                } else {
                    intWallBatch.pushRel(wx, wy, wz, camPos, 0, rotY, 0, w.length, wallH, WALL_THICK, w.tint);
                }
            }
        }

        for (let i = 0; i < fl.stairs.length; i++) {
            const st = fl.stairs[i];
            const [wx, wy, wz] = localToWorld(bp, st.cx, fl.yBase, st.z0);
            const rotY = (st.dir ?? 1) < 0 ? bp.rot + Math.PI : bp.rot;
            stairBatch.pushRel(wx, wy, wz, camPos, 0, rotY, 0, st.width, st.rise, st.runLen, [0.54, 0.42, 0.30, 1]);
        }

        if (!emitInterior) return;

        for (let i = 0; i < fl.furniture.length; i++) {
            const fn = fl.furniture[i];
            if (cullRooms && !visibleRooms.has(fn.roomId)) continue;
            const batch = furnBatches[fn.type];
            if (!batch) continue;
            const [wx, wy, wz] = localToWorld(bp, fn.x, fl.yBase, fn.z);
            batch.pushRel(wx, wy, wz, camPos, 0, bp.rot + fn.ry, 0, 1, 1, 1, fn.tint);
        }
        if (fl.ceilingLights) {
            for (let i = 0; i < fl.ceilingLights.length; i++) {
                const cl = fl.ceilingLights[i];
                if (cullRooms && !visibleRooms.has(cl.roomId)) continue;
                const [wx, wy, wz] = localToWorld(bp, cl.x, fl.yCeil, cl.z);
                furnBatches.ceiling_light.pushRel(wx, wy, wz, camPos, 0, bp.rot, 0, 1, 1, 1, [1.0, 0.92, 0.78, 1]);
            }
        }
        if (fl.wallArt && bp.kind !== 'home') {
            for (let i = 0; i < fl.wallArt.length; i++) {
                const wa = fl.wallArt[i];
                if (cullRooms && !visibleRooms.has(wa.roomId)) continue;
                const [wx, wy, wz] = localToWorld(bp, wa.x, fl.yBase + 1.55, wa.z);
                furnBatches.wall_art.pushRel(wx, wy, wz, camPos, 0, bp.rot + wa.ry, 0, 1, 1, 1, [0.70, 0.56, 0.42, 1]);
            }
        }
    }

    function emitEnterableBuilding(bp, camPos, isActive, activeFloor, activeRoomId, furnish, elevators) {
        stats.enterableShells++;
        if (furnish) stats.activeInteriors++;

        const total = bp.totalFloors;
        const af = clamp(activeFloor, 0, total - 1);

        const floorSet = new Set([0]);
        for (let df = -1; df <= 1; df++) {
            const f = af + df;
            if (f >= 0 && f < total) floorSet.add(f);
        }
        if (total <= 3) {
            for (let f = 0; f < total; f++) floorSet.add(f);
        }

        for (const f of floorSet) {
            const fl = bp.floors[f];
            const emitFurn = furnish && (total <= 3 || f === af || f === 0);
            emitFloorGeometry(bp, fl, camPos, isActive, af, activeRoomId, emitFurn, elevators);
        }

        if (total > 3) {
            const emitBandRange = (fStart, fEnd) => {
                if (fEnd < fStart) return;
                if (fStart < bp.setbackStart && fEnd >= bp.setbackStart) {
                    emitBandRange(fStart, bp.setbackStart - 1);
                    emitBandRange(bp.setbackStart, fEnd);
                    return;
                }
                const fl0 = bp.floors[fStart];
                const h = (fEnd - fStart + 1) * bp.floorHeight;
                pushParallaxMass(bp, camPos, fl0.yBase, h, fl0.footW, fl0.footD, fl0.footCX, fl0.footCZ, fl0.yBase - bp.baseY);
            };
            const loEnd = af - 2;
            if (loEnd >= 1) emitBandRange(1, loEnd);
            const hiStart = Math.max(1, af + 2);
            if (hiStart <= total - 1) emitBandRange(hiStart, total - 1);
        }

        // Roof cornice slab (0.68 m > 0.65 m) + architectural roof/crown silhouette seated flush on slab top
        const topFl = bp.floors[total - 1];
        const [rx, ry, rz] = localToWorld(bp, topFl.footCX, topFl.yCeil, topFl.footCZ);
        roofBatch.pushRel(rx, ry, rz, camPos, 0, bp.rot, 0, topFl.footW + 0.24, 0.68, topFl.footD + 0.24, [0.30, 0.32, 0.35, 1]);
        const dCam = Math.hypot(bp.originX - camPos[0], bp.originZ - camPos[2]);
        pushRoofSilhouette(bp, camPos, topFl.footW, topFl.footD, topFl.yCeil + 0.68, topFl.footCX, topFl.footCZ, dCam);

        if (bp.elevatorShaft && elevators) {
            const est = elevators.ensureBuilding(bp);
            if (est) {
                let inMaterializedFloor = false;
                for (const f of floorSet) {
                    const fl = bp.floors[f];
                    if (est.currentY >= fl.yBase - 0.25 && est.currentY < fl.yCeil - 0.25) {
                        inMaterializedFloor = true;
                        break;
                    }
                }
                if (inMaterializedFloor) {
                    const sh = bp.elevatorShaft;
                    const [ex, ey, ez] = localToWorld(bp, sh.cx, est.currentY, sh.cz);
                    elevBatch.pushRel(ex, ey, ez, camPos, 0, bp.rot, 0, sh.cabW, sh.cabH, sh.cabD, [0.64, 0.66, 0.70, 1]);
                }
            }
        }
    }

    function update(camPos, activeFloorHint, lod, atmoState, elevators, simTime = 0) {
        stats.activeInteriors = 0;
        stats.enterableShells = 0;
        stats.parallaxCount = 0;
        stats.culledRooms = 0;
        stats.streamedFloors = 0;

        const nightFactor = atmoState?.nightFactor ?? 0;
        const glowScale = atmoState?.emissiveScale ?? 0.45;
        pools.setGlowAll(glowScale);
        pools.setUniformAll('night_factor', nightFactor);
        parallaxBatch.setFadeOutDist(lod.meshFadeStart);
        parallaxBatch.setUniform('night_factor', nightFactor);
        parallaxBatch.setUniform('time', simTime);

        const groundY = layout.sampleGroundHeight(camPos[0], camPos[2]);
        const groundAlt = Math.max(0, camPos[1] - groundY);
        const activeInfo = getActiveBuilding(camPos);
        const allowEnterable = activeInfo?.inside || groundAlt <= 90;

        const maxDist = lod.meshFadeEnd + 64;
        const [bxCenter, bzCenter] = layout.worldToBlock(camPos[0], camPos[2]);
        const blockRadius = Math.min(6, Math.ceil((maxDist + (layout.MAX_WARP || 42)) / layout.BLOCK_SIZE));

        nearbyCandidates.length = 0;

        for (let bz = bzCenter - blockRadius; bz <= bzCenter + blockRadius; bz++) {
            for (let bx = bxCenter - blockRadius; bx <= bxCenter + blockRadius; bx++) {
                const [bcx, bcz] = layout.gridToWorld((bx + 0.5) * layout.BLOCK_SIZE, (bz + 0.5) * layout.BLOCK_SIZE);
                if (Math.hypot(bcx - camPos[0], bcz - camPos[2]) > maxDist + 112) continue;

                const parcels = layout.getParcelsInBlock(bx, bz);
                for (let i = 0; i < parcels.length; i++) {
                    const p = parcels[i];
                    if (p.kind === 'park') continue;
                    const d = Math.hypot(p.cx - camPos[0], p.cz - camPos[2]);
                    if (d > maxDist) continue;

                    const isAct = activeInfo && activeInfo.buildingId === p.id;
                    const wasEnt = enterableSet.has(p.id);
                    const wantEnt = allowEnterable && (isAct || d <= (wasEnt ? EXIT_DIST : ENTER_DIST));
                    if (wantEnt) {
                        const bp = getBuildingBlueprint(p);
                        bpById.set(bp.id, bp);
                        enterableSet.add(bp.id);
                        nearbyCandidates.push({ bp, d, isAct });
                    } else {
                        enterableSet.delete(p.id);
                        const m = getBuildingMass(p);
                        if (m.setbackStart < m.totalFloors) {
                            const hLo = m.setbackStart * m.floorHeight;
                            const hHi = (m.totalFloors - m.setbackStart) * m.floorHeight;
                            pushParallaxMass(m, camPos, m.baseY - 0.45, hLo + 0.45, m.width, m.depth, 0, 0, -0.45);
                            pushParallaxMass(m, camPos, m.baseY - 0.45, hLo + hHi + 0.45, m.sbWidth, m.sbDepth, 0, 0, -0.45);
                            if (d < lod.meshFadeStart) {
                                pushRoofSilhouette(m, camPos, m.sbWidth, m.sbDepth, m.baseY + hLo + hHi, 0, 0, d);
                            }
                        } else {
                            const totH = m.totalFloors * m.floorHeight;
                            pushParallaxMass(m, camPos, m.baseY - 0.45, totH + 0.45, m.width, m.depth, 0, 0, -0.45);
                            if (d < lod.meshFadeStart) {
                                pushRoofSilhouette(m, camPos, m.width, m.depth, m.baseY + totH, 0, 0, d);
                            }
                        }
                    }
                }
            }
        }

        nearbyCandidates.sort((a, b) => a.d - b.d);
        for (let i = 0; i < nearbyCandidates.length; i++) {
            const { bp, isAct } = nearbyCandidates[i];
            const furnish = isAct || i < MAX_FURNISHED;
            let af = 0;
            let activeRoomId = null;
            if (isAct && activeInfo) {
                af = activeFloorHint != null ? activeFloorHint : activeInfo.floorIndex;
                activeRoomId = activeInfo.roomId;
            }
            emitEnterableBuilding(bp, camPos, isAct, af, activeRoomId, furnish, elevators);
        }

        if (stats.parallaxCount > 0) {
            shellMetaBuf.write(shellMetaF32.subarray(0, stats.parallaxCount * 8));
        }

        return activeInfo;
    }

    return {
        update,
        getActiveBuilding,
        getBlueprintAt,
        getBlueprintById: (id) => bpById.get(id) || null,
        getStats: () => ({ ...stats }),
    };
}
