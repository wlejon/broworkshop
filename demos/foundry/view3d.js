// demos/foundry/view3d.js — Scale-Adaptive Live 3D Foundry View powered by custom .bk shaders.
//
// Features:
//   - shaders/foundry_part.bk: satin CNC steel, sand-cast iron, brass, copper coils, rubber,
//     Hardox armor, glow LEDs + live GPU stress, thermal blackbody glow, wear scoring, slip.
//   - shaders/foundry_cage.bk: unlit razor-sharp CAD wireframe cages & corner L-brackets.
//   - shaders/foundry_floor.bk: brushed steel deck with seamless studio fade & BattleBox markings.
//   - Continuous machined steel drive shafts bridging every connected rotary link.
//   - Scale-adaptive test fixtures (T-slot dyno bed for T1, heavy steel I-beam gantry for T3).
//   - Full Industrial BattleBox arena with floodlight towers, wall pilasters & directional sparks.

import { skyEnvironment } from "/lib/kit/sky.js";
import { structureView } from "/lib/kit/dynamics3d.js";
import { matOf } from "/lib/foundry/materials.js";
import {
    MAT, spurGearMesh, bearingMesh, motorMesh, engineMesh, batteryMesh,
    flywheelMesh, clutchMesh, shearPinMesh, shaftMesh, couplerShaftMesh,
    cardanShaftMesh, miterBoxMesh, hydHoseMesh, springMesh,
    frameMesh, wedgeArmorMesh, wheelMesh, spinnerBarMesh, spinnerTurretMesh, hammerArmMesh,
    dynoBedMesh, titanGantryMesh, arenaBotHullMesh, arenaWallRigMesh,
    concretePillarCollarMesh, sparkStreakMesh, unitCageMesh,
} from "/app/meshes.js";
import {
    capacitorBankMesh, hydraulicPumpMesh, planetaryGearMesh, wormGearMesh,
    beltDriveMesh, chainDriveMesh, overrunClutchMesh, hydraulicValveMesh,
    radiatorMesh, hydraulicRamMesh, leadScrewMesh, trackUnitMesh,
    verticalDrumMesh, crusherJawMesh, flipperSpatulaMesh, pressPlatenMesh,
    bevelGearMesh, differentialMesh, crankSliderParts, piledriverSpearMesh, millSpindleMesh,
    forkLifterMesh, grappleClawMesh, winchDrumMesh, trebuchetArmMesh,
    excavatorBoomMesh, augerDrillMesh, latheChuckMesh, mechLegsMesh,
} from "/app/meshes_ext.js";

const fs = require('fs');
const readShader = (name) => fs.readFileSync(bro.resolvePath('/app/shaders/' + name), 'utf8');

const PART_BK = readShader('foundry_part.bk');
const CAGE_BK = readShader('foundry_cage.bk');
const FLOOR_BK = readShader('foundry_floor.bk');

const PI = Math.PI;
function qAxis(ax, ay, az, rad) {
    const s = Math.sin(rad * 0.5);
    return [ax * s, ay * s, az * s, Math.cos(rad * 0.5)];
}
function qFromZTo(dx, dy, dz) {
    const l = Math.hypot(dx, dy, dz) || 1;
    const x = dx / l, y = dy / l, z = dz / l;
    if (z > 0.9999) return [0, 0, 0, 1];
    if (z < -0.9999) return [0, 1, 0, 0];
    const cx = -y, cy = x, cz = 0, w = 1 + z;
    const ql = Math.hypot(cx, cy, cz, w) || 1;
    return [cx / ql, cy / ql, cz / ql, w / ql];
}
function rotY(p, yaw) {
    if (!yaw) return p.slice();
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return [c * p[0] + s * p[2], p[1], -s * p[0] + c * p[2]];
}

const DEFAULT_PART_UNIFORMS = { stress: 0, wear: 0, heat: 0, slip: 0, failed: 0, selected: 0, time: 0, scroll: 0 };

export function createFoundryView3D(vp) {
    const scene = vp.scene;

    // --- Balanced Dark Industrial Foundry Studio Lighting (rich linear PBR metals!) ---
    skyEnvironment(scene, { hdri: 'dikhololo_night', intensity: 0.72, rotation: 0.9 });
    scene.setAmbient([0.085, 0.105, 0.145]);
    scene.setFog({ enabled: true, start: 6, end: 24, color: [0.026, 0.032, 0.042] });
    scene.setToneMap({ mode: 'aces' });
    scene.setExposure({ mode: 'fixed', ev: 0.28 });
    if (scene.setMSAA) scene.setMSAA(4);
    scene.setSSAO({ enabled: true, radius: 0.16, intensity: 1.18, bias: 0.008 });
    scene.setBloom({ threshold: 1.25, intensity: 0.36, radius: 0.55, iterations: 4 });

    // 3-point foundry rig: crisp overhead studio key + warm forge amber rim + cool cyan fill
    scene.createLight({
        type: 'directional',
        direction: [-0.52, -0.74, -0.42],
        color: [0.96, 0.98, 1.0],
        intensity: 2.75,
        castsShadow: true,
        shadowMapSize: 2048,
        shadowBias: 0.0005,
        pcf: 3,
    });
    scene.createLight({
        type: 'directional',
        direction: [0.68, -0.34, 0.64],
        color: [1.0, 0.68, 0.34],
        intensity: 1.85,
        castsShadow: false,
    });
    scene.createLight({
        type: 'directional',
        direction: [0.40, -0.45, -0.80],
        color: [0.40, 0.68, 1.0],
        intensity: 1.05,
        castsShadow: false,
    });

    const cageGeo = unitCageMesh();
    const sparkGeo = sparkStreakMesh();
    let stageNodes = [];
    let partVisuals = new Map();
    let boxVisuals = [];
    let arenaVisuals = null;
    let xray = true;
    let showBounds = true;
    let selectedTopId = null;
    let clock = 0;

    function createPartMesh(mesh, opts = {}) {
        const node = scene.createMesh({
            mesh,
            color: [1, 1, 1],
            vertexColorTint: true,
            castsShadow: opts.castsShadow ?? true,
            receivesShadow: opts.receivesShadow ?? true,
        });
        node.setShader({ module: PART_BK, file: 'shaders/foundry_part.bk', uniforms: { ...DEFAULT_PART_UNIFORMS } });
        return node;
    }

    function addStudioBackdrop(radius) {
        const dome = scene.createMesh({
            mesh: 'sphere', radius, segments: 24, rings: 14,
            color: [0.026, 0.032, 0.042], roughness: 1.0, metallic: 0.0,
            emissive: 0.85, emissiveColor: [0.026, 0.032, 0.042],
            twoSided: true, castsShadow: false, receivesShadow: false,
        });
        stageNodes.push(dome);
    }

    function clearAll() {
        for (const n of stageNodes) n.destroy();
        stageNodes = [];
        for (const v of partVisuals.values()) v.group.destroy();
        partVisuals.clear();
        for (const bv of boxVisuals) bv.node.destroy();
        boxVisuals = [];
        if (arenaVisuals) {
            for (const b of arenaVisuals.bots) {
                b.chassisNode.destroy();
                if (b.weaponNode) b.weaponNode.destroy();
            }
            for (const sv of arenaVisuals.structViews) sv.destroy();
            for (const sp of arenaVisuals.sparks) sp.node.destroy();
            arenaVisuals = null;
        }
    }

    function buildBenchFloor(spanM, floorY) {
        const radius = Math.max(3.2, spanM * 9.0);
        const majorStep = spanM < 0.45 ? 0.05 : spanM < 1.8 ? 0.25 : 1.0;
        scene.setFog({ enabled: true, start: radius * 0.26, end: radius * 0.68, color: [0.026, 0.032, 0.042] });
        scene.setSSAO({ enabled: true, radius: Math.max(0.035, Math.min(0.42, spanM * 0.13)), intensity: 1.20, bias: 0.007 });

        const floor = scene.createMesh({
            mesh: 'plane', halfW: radius, halfD: radius,
            color: [1, 1, 1], castsShadow: false, receivesShadow: true,
        });
        floor.position = [0, floorY, 0];
        floor.setShader({
            module: FLOOR_BK, file: 'shaders/foundry_floor.bk',
            uniforms: { major_step: majorStep, minor_div: 5, radius, arena_mode: 0 },
        });
        stageNodes.push(floor);
        addStudioBackdrop(radius * 1.15);
    }

    /** Compute exact 3D physical port position for any component (gear center-dist, sprocket hub, turret, etc.). */
    function portWorldPos(part, dir, otherPart = null) {
        let local = [0, 0, 0];
        const a = part.analysis || {};
        if (part.type === 'gear_pair' && dir === 'out') {
            local = [a.centerDist || 0, 0, 0];
        } else if (part.type === 'belt_drive' || part.type === 'chain_drive') {
            const halfSpan = (a.spanM || 0.16) * 0.5;
            local = [0, 0, dir === 'in' ? -halfSpan : halfSpan];
        } else if (part.type === 'track_unit' && dir === 'in') {
            // Mate drive axle to the nearest sprocket hub (rear, center, or front) of the track unit!
            const halfS = (a.lengthM || 0.68) * 0.34;
            if (otherPart) {
                const cands = [[0, 0, -halfS], [0, 0, 0], [0, 0, halfS]];
                let bestD = Infinity;
                for (const c of cands) {
                    const rc = rotY(c, part.yaw3d || 0);
                    const wx = part.pos3d[0] + rc[0], wy = part.pos3d[1] + rc[1], wz = part.pos3d[2] + rc[2];
                    const d = Math.hypot(otherPart.pos3d[0] - wx, otherPart.pos3d[1] - wy, otherPart.pos3d[2] - wz);
                    if (d < bestD) { bestD = d; local = c; }
                }
            } else {
                local = [0, 0, -halfS];
            }
        } else if (part.type === 'weapon_head' && dir === 'in') {
            const wk = a.weaponKind;
            const wr = a.radiusM || 0.30;
            if (wk === 'spinner_bar') local = [0, -0.044, -0.088];
            else if (wk === 'mill_spindle') local = [0, wr * 1.15, 0];
            else if (wk === 'auger_drill') local = [0, wr * 1.75, 0];
            else if (wk === 'mech_legs') local = [0, wr * 0.56, 0];
            else if (wk === 'excavator_boom') local = [0, -wr * 0.22, -wr * 0.42];
        }
        const r = rotY(local, part.yaw3d || 0);
        return [part.pos3d[0] + r[0], part.pos3d[1] + r[1], part.pos3d[2] + r[2]];
    }

    function buildPartVisual(part, parent, targetMap = partVisuals) {
        const group = scene.createNode({ name: part.path });
        group.position = part.pos3d.slice();
        if (part.yaw3d) group.quaternion = qAxis(0, 1, 0, part.yaw3d);
        parent.add(group);

        const a = part.analysis;
        const p = part.params;
        const mat = matOf(p.material || 'alloySteel');
        const shaderNodes = [];
        const spinNodes = [];
        const slideNodes = [];
        const rockNodes = [];
        let intactNode = null, snappedNode = null;

        const addCAD = (geo, pos = null) => {
            const m = createPartMesh(geo);
            if (pos) m.position = pos;
            group.add(m);
            shaderNodes.push(m);
            return m;
        };

        if (part.type === 'gear_pair') {
            const mM = Math.max(0.001, (p.moduleMm || 2.5) / 1000);
            const fw = a.faceWidthM || 0.015;
            const matId = p.material === 'brass' || p.material === 'bronze' ? MAT.BRASS : MAT.STEEL;
            const g1 = addCAD(spurGearMesh(a.z1, mM, fw, mat.color, matId), [0, 0, 0]);
            const g2 = addCAD(spurGearMesh(a.z2, mM, fw, mat.color, matId), [a.centerDist, 0, 0]);
            spinNodes.push({ node: g1, axis: 'z', ratio: a.ratio, phase: 0 });
            spinNodes.push({ node: g2, axis: 'z', ratio: -1, phase: PI / Math.max(8, a.z2) });
        } else if (part.type === 'bearing') {
            addCAD(bearingMesh((p.boreMm || 20) / 1000, p.kind || 'ball'));
        } else if (part.type === 'motor') {
            addCAD(motorMesh(a.size));
        } else if (part.type === 'ic_engine') {
            addCAD(engineMesh(a.size, p.cylinders || 8));
        } else if (part.type === 'battery') {
            addCAD(batteryMesh(a.size));
        } else if (part.type === 'flywheel') {
            const r = Math.max(0.025, (p.radiusMm || 68) / 1000);
            const th = Math.max(0.008, (p.thicknessMm || 18) / 1000);
            const fw = addCAD(flywheelMesh(r, th, mat.color));
            spinNodes.push({ node: fw, axis: 'z', ratio: 1, phase: 0 });
        } else if (part.type === 'slip_clutch') {
            const r = Math.max(0.02, (p.radiusMm || 46) / 1000);
            const cl = addCAD(clutchMesh(r, a.size[2]));
            spinNodes.push({ node: cl, axis: 'z', ratio: 1, phase: 0 });
        } else if (part.type === 'shear_pin') {
            const r = Math.max(0.014, a.size[0] * 0.5);
            intactNode = addCAD(shearPinMesh(r, a.size[2], false));
            snappedNode = addCAD(shearPinMesh(r, a.size[2], true));
            snappedNode.visible = false;
            spinNodes.push({ node: intactNode, axis: 'z', ratio: 1, phase: 0 });
        } else if (part.type === 'shaft') {
            const r = Math.max(0.005, (p.diameterMm || 18) / 2000);
            const l = Math.max(0.03, (p.lengthMm || 120) / 1000);
            const sh = addCAD(shaftMesh(r, l, mat.color));
            spinNodes.push({ node: sh, axis: 'z', ratio: 1, phase: 0 });
        } else if (part.type === 'spring_actuator') {
            const r = Math.max(0.025, a.size[0] * 0.48);
            addCAD(springMesh(r, a.size[2]));
        } else if (part.type === 'frame') {
            addCAD(frameMesh(a.size[0], a.size[1], a.size[2], mat.color));
        } else if (part.type === 'armor') {
            if (p.face === 'front') {
                addCAD(wedgeArmorMesh(a.size[0], a.size[1], Math.max(0.11, a.size[1] * 0.78), mat.color));
            } else {
                addCAD(frameMesh(a.size[0], a.size[1], Math.max(0.025, (p.thicknessMm || 8) / 1000 * 2.5), mat.color));
            }
        } else if (part.type === 'wheel') {
            const wn = addCAD(wheelMesh(a.radiusM || 0.13, p.widthM || 0.08));
            spinNodes.push({ node: wn, axis: 'x', ratio: 1, phase: 0 });
        } else if (part.type === 'track_unit') {
            addCAD(trackUnitMesh(a.lengthM || 0.68, a.heightM || 0.20, a.widthM || 0.11));
        } else if (part.type === 'capacitor_bank') {
            addCAD(capacitorBankMesh(a.size));
        } else if (part.type === 'hydraulic_pump') {
            addCAD(hydraulicPumpMesh(a.size));
        } else if (part.type === 'planetary_gear') {
            const pg = addCAD(planetaryGearMesh(a.odM || 0.078, a.faceWidthM || 0.022, a.planets || 3, mat.color));
            spinNodes.push({ node: pg, axis: 'z', ratio: 1, phase: 0 });
        } else if (part.type === 'worm_gear') {
            addCAD(wormGearMesh(a.odM || 0.095, a.faceWidthM || 0.026, mat.color));
        } else if (part.type === 'belt_drive') {
            addCAD(beltDriveMesh(a.r1 || 0.028, a.r2 || 0.056, a.spanM || 0.18, a.widthM || 0.025));
        } else if (part.type === 'chain_drive') {
            addCAD(chainDriveMesh(a.r1 || 0.030, a.r2 || 0.064, a.spanM || 0.22, a.pitchM || 0.0127));
        } else if (part.type === 'overrun_clutch') {
            const oc = addCAD(overrunClutchMesh(a.size[0], a.size[2]));
            spinNodes.push({ node: oc, axis: 'z', ratio: 1, phase: 0 });
        } else if (part.type === 'hydraulic_valve') {
            addCAD(hydraulicValveMesh(a.size));
        } else if (part.type === 'radiator') {
            addCAD(radiatorMesh(a.size));
        } else if (part.type === 'hydraulic_ram') {
            const ramN = addCAD(hydraulicRamMesh(a.boreM || 0.058, a.strokeM || 0.16));
            slideNodes.push({ node: ramN, axis: 'z', amp: Math.min(0.05, (a.strokeM || 0.16) * 0.14), base: [0, 0, 0], freq: 0.25 });
        } else if (part.type === 'lead_screw') {
            addCAD(leadScrewMesh(a.diameterM || 0.028, a.strokeM || 0.22));
        } else if (part.type === 'bevel_gear') {
            const bg = addCAD(bevelGearMesh(a.odM || 0.092, mat.color));
            spinNodes.push({ node: bg, axis: 'z', ratio: 0.0, phase: 0 });
        } else if (part.type === 'differential') {
            const df = addCAD(differentialMesh(a.odM || 0.118, mat.color));
            spinNodes.push({ node: df, axis: 'z', ratio: 1, phase: 0 });
        } else if (part.type === 'crank_slider') {
            const parts = crankSliderParts(a.throwM || 0.042, a.rodLenM || 0.155);
            addCAD(parts.base);
            const crankN = addCAD(parts.crank);
            const pistonN = addCAD(parts.piston);
            spinNodes.push({ node: crankN, axis: 'x', ratio: 1, phase: 0 });
            slideNodes.push({ node: pistonN, axis: 'z', amp: a.throwM || 0.042, base: [0, 0, 0], freq: 1.0 });
        } else if (part.type === 'weapon_head') {
            if (a.weaponKind === 'hammer_arm') {
                const hn = addCAD(hammerArmMesh(a.radiusM || 0.4));
                rockNodes.push({ node: hn, axis: 'x', amp: 0.55, offset: -0.25, freq: 0.45 });
            } else if (a.weaponKind === 'spinner_drum') {
                const dn = addCAD(verticalDrumMesh(a.radiusM || 0.11));
                spinNodes.push({ node: dn, axis: 'x', ratio: 1, phase: 0 });
            } else if (a.weaponKind === 'crusher_jaw') {
                const cj = addCAD(crusherJawMesh(a.radiusM || 0.32));
                rockNodes.push({ node: cj, axis: 'x', amp: 0.28, offset: -0.10, freq: 0.35 });
            } else if (a.weaponKind === 'flipper_spatula') {
                const fl = addCAD(flipperSpatulaMesh(a.radiusM || 0.28));
                rockNodes.push({ node: fl, axis: 'x', amp: 0.38, offset: -0.22, freq: 0.40 });
            } else if (a.weaponKind === 'piledriver_spear') {
                const sp = addCAD(piledriverSpearMesh(a.radiusM || 0.28));
                slideNodes.push({ node: sp, axis: 'z', amp: 0.045, base: [0, 0, 0], freq: 1.0 });
            } else if (a.weaponKind === 'fork_lifter') {
                const fk = addCAD(forkLifterMesh(a.radiusM || 0.30));
                slideNodes.push({ node: fk, axis: 'y', amp: 0.085, base: [0, 0.04, 0], freq: 0.30 });
            } else if (a.weaponKind === 'grapple_claw') {
                const gc = addCAD(grappleClawMesh(a.radiusM || 0.30));
                rockNodes.push({ node: gc, axis: 'x', amp: 0.22, offset: -0.06, freq: 0.35 });
            } else if (a.weaponKind === 'winch_drum') {
                const wd = addCAD(winchDrumMesh(a.radiusM || 0.10));
                spinNodes.push({ node: wd, axis: 'x', ratio: 1, phase: 0 });
            } else if (a.weaponKind === 'trebuchet_arm') {
                const ta = addCAD(trebuchetArmMesh(a.radiusM || 0.44));
                rockNodes.push({ node: ta, axis: 'x', amp: 0.68, offset: -0.32, freq: 0.40 });
            } else if (a.weaponKind === 'excavator_boom') {
                const ex = addCAD(excavatorBoomMesh(a.radiusM || 0.56));
                rockNodes.push({ node: ex, axis: 'x', amp: 0.24, offset: -0.08, freq: 0.22 });
            } else if (a.weaponKind === 'auger_drill') {
                const ag = addCAD(augerDrillMesh(a.radiusM || 0.16));
                spinNodes.push({ node: ag, axis: 'y', ratio: 1, phase: 0 });
            } else if (a.weaponKind === 'lathe_chuck') {
                const lc = addCAD(latheChuckMesh(a.radiusM || 0.11));
                spinNodes.push({ node: lc, axis: 'z', ratio: 1, phase: 0 });
            } else if (a.weaponKind === 'mech_legs') {
                const ml = addCAD(mechLegsMesh(a.radiusM || 0.44));
                rockNodes.push({ node: ml, axis: 'x', amp: 0.12, offset: 0, freq: 0.55 });
            } else if (a.weaponKind === 'mill_spindle') {
                const ms = addCAD(millSpindleMesh(a.radiusM || 0.08));
                spinNodes.push({ node: ms, axis: 'y', ratio: 1, phase: 0 });
            } else if (a.weaponKind === 'press_platen') {
                const pp = addCAD(pressPlatenMesh(a.radiusM || 0.22));
                slideNodes.push({ node: pp, axis: 'y', amp: 0.06, base: [0, 0, 0], freq: 0.25 });
            } else {
                // Stationary 90-deg bevel drive turret + horizontal spinning S7 bar!
                addCAD(spinnerTurretMesh());
                const bn = addCAD(spinnerBarMesh(a.radiusM || 0.32));
                spinNodes.push({ node: bn, axis: 'y', ratio: 1, phase: 0 });
            }
        }

        const rec = { group, part, shaderNodes, spinNodes, slideNodes, rockNodes, intactNode, snappedNode };
        targetMap.set(part.path, rec);
        return rec;
    }

    /** Push live GPU stress, wear, blackbody heat, slip, failure & exact kinematics onto any partVisual map. */
    function updatePartVisuals(visMap, runtime, dt, allowSelect = true) {
        for (const [path, rec] of visMap) {
            const ps = runtime.partState.get(path);
            if (!ps) continue;

            for (const sn of rec.spinNodes) {
                if (!sn.ratio) continue;
                const ang = ps.angle * sn.ratio + sn.phase;
                if (sn.axis === 'z') sn.node.quaternion = qAxis(0, 0, 1, ang);
                else if (sn.axis === 'y') sn.node.quaternion = qAxis(0, 1, 0, ang);
                else if (sn.axis === 'x') sn.node.quaternion = qAxis(1, 0, 0, ang);
            }
            for (const sl of rec.slideNodes || []) {
                const d = Math.sin(ps.angle * sl.freq) * sl.amp;
                sl.node.position = [
                    sl.base[0] + (sl.axis === 'x' ? d : 0),
                    sl.base[1] + (sl.axis === 'y' ? d : 0),
                    sl.base[2] + (sl.axis === 'z' ? d : 0),
                ];
            }
            for (const rk of rec.rockNodes || []) {
                const ang = rk.offset + Math.sin(ps.angle * rk.freq) * rk.amp;
                if (rk.axis === 'x') rk.node.quaternion = qAxis(1, 0, 0, ang);
                else if (rk.axis === 'y') rk.node.quaternion = qAxis(0, 1, 0, ang);
                else rk.node.quaternion = qAxis(0, 0, 1, ang);
            }

            if (rec.intactNode && rec.snappedNode) {
                rec.intactNode.visible = !ps.failed;
                rec.snappedNode.visible = ps.failed;
            }

            const maxT = rec.part.analysis.rated.tempMaxC || 220;
            const heat = Math.max(0, Math.min(1, (ps.tempC - 28) / Math.max(40, maxT - 28)));
            const sel = allowSelect && selectedTopId && rec.part.topNodeId === selectedTopId ? 1 : 0;
            const slip = ps.status === 'slipping' ? 1 : 0;
            const failed = ps.failed ? 1 : 0;

            for (const m of rec.shaderNodes) {
                m.setShaderUniform('stress', ps.stressRatio);
                m.setShaderUniform('wear', ps.wear);
                m.setShaderUniform('heat', heat);
                m.setShaderUniform('slip', slip);
                m.setShaderUniform('failed', failed);
                m.setShaderUniform('selected', sel);
                m.setShaderUniform('time', clock);
                m.setShaderUniform('scroll', ps.angle);
            }
        }
    }

    /**
     * Bridge connected rot/hyd/lin ports with mechanically accurate hardware:
     *   - Coaxial rotary (<= 11°): straight machined steel shaft + bolted couplers
     *   - Moderate offset (11°–28°): Cardan double U-joint driveshaft with forged yokes & brass trunnions
     *   - Orthogonal/steep corner (> 28°): strictly orthogonal shafts joined by a cast-iron 90° miter transfer box
     *   - Hydraulic lines: black braided high-pressure hoses with brass hex swivel crimp fittings
     */
    function buildConnectingShafts(compiled, byPath, parent, skipPaths = null) {
        const shaftR = compiled.scale === 'titan' ? 0.075 : 0.0095;
        const addSeg = (p1, p2, geoFn, r) => {
            const dx = p2[0] - p1[0], dy = p2[1] - p1[1], dz = p2[2] - p1[2];
            const dist = Math.hypot(dx, dy, dz);
            if (dist < 0.012) return;
            const n = createPartMesh(geoFn(dist, r));
            n.position = [(p1[0] + p2[0]) * 0.5, (p1[1] + p2[1]) * 0.5, (p1[2] + p2[2]) * 0.5];
            n.quaternion = qFromZTo(dx, dy, dz);
            parent.add(n);
        };
        const addMiter = (pt, r) => {
            const mb = createPartMesh(miterBoxMesh(r));
            mb.position = pt;
            parent.add(mb);
        };

        for (const link of compiled.links || []) {
            if (link.domain !== 'rot' && link.domain !== 'hyd' && link.domain !== 'lin') continue;
            if (skipPaths && (skipPaths.has(link.from) || skipPaths.has(link.to))) continue;
            const pA = byPath.get(link.from);
            const pB = byPath.get(link.to);
            if (!pA || !pB) continue;
            const aPos = portWorldPos(pA, 'out', pB);
            const bPos = portWorldPos(pB, 'in', pA);
            const dx = bPos[0] - aPos[0], dy = bPos[1] - aPos[1], dz = bPos[2] - aPos[2];
            const dist = Math.hypot(dx, dy, dz);
            if (dist < 0.014) continue;

            // Hydraulic lines: braided rubber hose with brass crimp fittings (+ brass elbow if dogleg)
            if (link.domain === 'hyd') {
                const rH = shaftR * 0.85;
                const ax = rotY([0, 0, 1], pA.yaw3d || 0);
                const dotZ = Math.abs((dx * ax[0] + dy * ax[1] + dz * ax[2]) / dist);
                if (dotZ > 0.94) {
                    addSeg(aPos, bPos, hydHoseMesh, rH);
                } else {
                    const elbow = [aPos[0], bPos[1], bPos[2]];
                    addSeg(aPos, elbow, hydHoseMesh, rH);
                    addSeg(elbow, bPos, hydHoseMesh, rH);
                    addMiter(elbow, rH * 0.72);
                }
                continue;
            }

            // Linear actuator pushrods: direct chrome rod along line of action
            if (link.domain === 'lin') {
                addSeg(aPos, bPos, couplerShaftMesh, shaftR * 0.92);
                continue;
            }

            // Rotary drive shafts: measure true misalignment angle against part A's natural output axis!
            const axZ = rotY([0, 0, 1], pA.yaw3d || 0);
            const axX = rotY([1, 0, 0], pA.yaw3d || 0);
            const dotZ = Math.abs((dx * axZ[0] + dy * axZ[1] + dz * axZ[2]) / dist);
            const dotX = Math.abs((dx * axX[0] + dy * axX[1] + dz * axX[2]) / dist);
            const dotY = Math.abs(dy / dist);
            const isRightAngle = pA.type === 'bevel_gear' || pA.type === 'differential' || pA.type === 'worm_gear'
                || pA.type === 'belt_drive' || pA.type === 'chain_drive'
                || pB.type === 'bevel_gear' || pB.type === 'differential';
            const bestDot = isRightAngle ? Math.max(dotZ, dotX, dotY) : dotZ;
            const deg = Math.acos(Math.min(1, bestDot)) * 180 / Math.PI;

            if (deg <= 11) {
                addSeg(aPos, bPos, couplerShaftMesh, shaftR);
            } else if (deg <= 28) {
                addSeg(aPos, bPos, cardanShaftMesh, shaftR);
            } else {
                // Orthogonal 2-segment (or 3-segment) shaft routing with bolted cast-iron 90° miter transfer box!
                // First run straight along A's primary axis (Z or X), then turn 90° at a miter box into B.
                const mid1 = Math.abs(dz) >= Math.abs(dx)
                    ? [aPos[0], aPos[1], bPos[2]]
                    : [bPos[0], aPos[1], aPos[2]];
                const d1 = Math.hypot(mid1[0] - aPos[0], mid1[1] - aPos[1], mid1[2] - aPos[2]);
                const d2 = Math.hypot(bPos[0] - mid1[0], bPos[1] - mid1[1], bPos[2] - mid1[2]);
                if (d1 > 0.015 && d2 > 0.015) {
                    addSeg(aPos, mid1, couplerShaftMesh, shaftR);
                    addMiter(mid1, shaftR);
                    // If vertical step also remains, add a clean vertical shaft + second miter box
                    if (Math.abs(bPos[1] - mid1[1]) > 0.015 && Math.hypot(bPos[0] - mid1[0], bPos[2] - mid1[2]) > 0.015) {
                        const mid2 = [mid1[0], bPos[1], mid1[2]];
                        addSeg(mid1, mid2, couplerShaftMesh, shaftR);
                        addMiter(mid2, shaftR);
                        addSeg(mid2, bPos, couplerShaftMesh, shaftR);
                    } else {
                        addSeg(mid1, bPos, couplerShaftMesh, shaftR);
                    }
                } else {
                    addSeg(aPos, bPos, cardanShaftMesh, shaftR);
                }
            }
        }
    }

    /** Load a compiled blueprint into the Bench / Machine / Titan 3D inspection view. */
    function loadBlueprintView(compiled) {
        clearAll();
        const b = compiled.bounds;
        const span = Math.max(b.size[0], b.size[1], b.size[2], 0.22);

        // Scale-adaptive industrial test fixture grounding subassemblies & Titan powerpacks!
        const bedH = compiled.scale === 'subassembly' ? Math.max(0.016, span * 0.045)
            : compiled.scale === 'titan' ? 0.22 : 0;
        const bedTopY = Math.min(0, b.min[1]) - Math.max(0.004, span * 0.008);
        const floorY = bedTopY - bedH - (compiled.scale === 'subassembly' ? 0.012 : 0.004);
        buildBenchFloor(span, floorY);

        const root = scene.createNode({ name: 'foundry_root' });
        stageNodes.push(root);

        if (compiled.scale === 'subassembly') {
            const bed = createPartMesh(dynoBedMesh(b.size[0] + Math.max(0.08, span * 0.22), b.size[2] + Math.max(0.08, span * 0.22), bedH));
            bed.position = [b.center[0], bedTopY, b.center[2]];
            root.add(bed);
        } else if (compiled.scale === 'titan') {
            const gantry = createPartMesh(titanGantryMesh(b.size[0] + 0.55, b.size[2] + 0.65, bedH));
            gantry.position = [b.center[0], bedTopY, b.center[2]];
            root.add(gantry);
        }

        const byPath = new Map();
        for (const part of compiled.parts) {
            byPath.set(part.path, part);
            buildPartVisual(part, root, partVisuals);
        }

        // Automatically bridge every connected rotary/hydraulic/linear edge with machined shafts & hoses!
        buildConnectingShafts(compiled, byPath, root);

        // Razor-sharp unlit CAD wireframe bounding cages (zero foggy specular glare!)
        const boxes = compiled.asmBoxes.length ? compiled.asmBoxes : [{
            path: compiled.id, topNodeId: null, label: compiled.name, center: b.center, size: b.size,
        }];
        for (const ab of boxes) {
            if (compiled.scale === 'machine' && ab.depth > 0) continue;
            const n = scene.createMesh({
                mesh: cageGeo,
                color: [1, 1, 1, 0.5],
                twoSided: true,
                castsShadow: false,
                receivesShadow: false,
            });
            n.position = ab.center.slice();
            n.scale = [ab.size[0] + 0.018, ab.size[1] + 0.018, ab.size[2] + 0.018];
            n.setShader({
                module: CAGE_BK, file: 'shaders/foundry_cage.bk',
                uniforms: { tint: [0.30, 0.72, 1.0, 0.92], pulse: 0, time: 0, xray: xray ? 1 : 0, pad0: 0 },
            });
            n.visible = showBounds;
            root.add(n);
            boxVisuals.push({ node: n, topNodeId: ab.topNodeId, box: ab });
        }

        // Render glowing 3D clash/obstruction hotspot markers for any live motion-audit findings!
        const ma = compiled.motionAudit;
        if (ma && ma.findings && ma.findings.length) {
            const markerR = compiled.scale === 'titan' ? 0.22 : 0.032;
            for (const f of ma.findings) {
                if (!f.point3d) continue;
                const isErr = f.severity === 'error';
                const col = isErr ? [1.0, 0.14, 0.10] : [1.0, 0.72, 0.12];
                const beacon = scene.createMesh({
                    mesh: 'sphere', radius: markerR,
                    color: col, emissive: isErr ? 4.2 : 2.6, emissiveColor: col,
                    castsShadow: false, receivesShadow: false,
                    position: f.point3d,
                });
                root.add(beacon);
            }
        }

        vp.reframe([b.center[0], b.center[1], b.center[2]], span * 2.10, { yaw: 0.66, pitch: -0.35 });
    }

    /** Push live stress, wear, thermal blackbody glow, clutch slip, and animation angles to the GPU! */
    function syncRuntime(runtime, dt = 1 / 60) {
        clock += dt;
        if (!runtime) return;
        const rollups = runtime.getNodeRollups();
        updatePartVisuals(partVisuals, runtime, dt, true);

        for (const bv of boxVisuals) {
            bv.node.visible = showBounds;
            const r = bv.topNodeId ? rollups.get(bv.topNodeId) : null;
            const sel = selectedTopId && bv.topNodeId === selectedTopId;
            let tint = [0.28, 0.70, 1.0, 0.88];
            let pulse = 0;
            if (r && r.status === 'failed') { tint = [1.0, 0.16, 0.12, 1.35]; pulse = 1.0; }
            else if (r && r.status === 'slipping') { tint = [0.98, 0.28, 0.88, 1.25]; pulse = 0.85; }
            else if (r && r.status === 'overstress') { tint = [1.0, 0.56, 0.10, 1.15]; pulse = 0.7; }
            else if (r && r.status === 'warn') { tint = [0.95, 0.80, 0.16, 1.0]; pulse = 0.35; }
            else if (sel) { tint = [0.32, 0.88, 1.0, 1.25]; pulse = 0.25; }

            bv.node.setShaderUniform('tint', tint);
            bv.node.setShaderUniform('pulse', pulse);
            bv.node.setShaderUniform('time', clock);
            bv.node.setShaderUniform('xray', xray ? 1 : 0);
        }
    }

    /** Load live Box3D Combat Arena rendering the EXACT compiled 3D machines from the Dyno Bench! */
    function loadArenaView(arena) {
        clearAll();
        const hs = arena.halfSize;
        scene.setFog({ enabled: true, start: 13, end: 32, color: [0.026, 0.032, 0.042] });
        scene.setSSAO({ enabled: true, radius: 0.32, intensity: 1.20, bias: 0.012 });

        // BattleBox steel floor with hazard perimeter, team starting squares & center combat ring!
        const floor = scene.createMesh({
            mesh: 'plane', halfW: hs + 0.35, halfD: hs + 0.35,
            color: [1, 1, 1], castsShadow: false, receivesShadow: true,
        });
        floor.position = [0, 0, 0];
        floor.setShader({
            module: FLOOR_BK, file: 'shaders/foundry_floor.bk',
            uniforms: { major_step: 1.0, minor_div: 4, radius: hs, arena_mode: 1 },
        });
        stageNodes.push(floor);

        // Full Industrial BattleBox Enclosure (kickwalls, yellow rails, steel I-beam pilasters, corner floodlight towers!)
        addStudioBackdrop(26);
        const wallRig = createPartMesh(arenaWallRigMesh(hs));
        stageNodes.push(wallRig);

        // Destructible weathered charcoal concrete pillars via bro.dynamics::Structure + bolted steel floor collars!
        const structViews = arena.structures.map((s) => {
            const collar = createPartMesh(concretePillarCollarMesh(s.spec.w, s.spec.d));
            collar.position = [s.spec.x, 0, s.spec.z];
            stageNodes.push(collar);

            return structureView(scene, s.structure, {
                color: (member, cell) => {
                    if (member === 0) return [0.10, 0.12, 0.15];
                    const n = ((cell * 37) % 11) / 11;
                    const v = 0.15 + n * 0.06;
                    return [v, v * 0.99, v * 0.95];
                },
                roughness: 0.96,
            });
        });

        // Mount each bot's ACTUAL compiled 3D machine assembly (motors, gears, engines, hydraulics, tracks, shafts!)
        // directly onto the quantized Box3D chassis + articulated weapon body — 1:1 with Dyno Bench!
        const botVis = [];
        for (const bot of arena.bots) {
            const [hw, hh, hl] = bot.half;
            const teamTint = bot.id === 0 ? [0.98, 0.62, 0.12, 0.95] : [0.22, 0.76, 1.0, 0.95];
            const chassisNode = scene.createNode({ name: 'bot_' + bot.id });
            scene.root.add(chassisNode);

            // Center the compiled blueprint's chassis frame dead-center onto the Box3D rigid body
            const framePart = bot.compiled.parts.find((p) => p.type === 'frame');
            const refC = framePart ? framePart.pos3d : bot.compiled.bounds.center;
            const bodyMount = scene.createNode({ name: 'bot_mount_' + bot.id });
            bodyMount.position = [-refC[0], -refC[1], -refC[2]];
            chassisNode.add(bodyMount);

            const partMap = new Map();
            const byPath = new Map();
            const weaponPath = bot.weaponBody != null && bot.weaponHead ? bot.weaponHead.path : null;

            for (const part of bot.compiled.parts) {
                byPath.set(part.path, part);
                if (part.path === weaponPath) {
                    // For horizontal spinners, keep the stationary cast-iron bevel turret bolted to the chassis nose!
                    if (bot.weaponKind === 'spinner_bar') {
                        const turret = createPartMesh(spinnerTurretMesh(), {
                            position: part.pos3d,
                            quaternion: part.yaw3d ? qAxis(0, 1, 0, part.yaw3d) : [0, 0, 0, 1],
                        });
                        bodyMount.add(turret);
                    }
                    continue;
                }
                buildPartVisual(part, bodyMount, partMap);
            }
            // Bridge ALL connecting drive shafts/hoses (including straight into the weapon turret!)
            buildConnectingShafts(bot.compiled, byPath, bodyMount, null);

            // Crisp team-colored holographic CAD perimeter cage (Amber = YOUR DESIGN, Cyan = OPPONENT)
            const teamCage = scene.createMesh({
                mesh: cageGeo,
                color: [1, 1, 1, 0.5],
                twoSided: true,
                castsShadow: false,
                receivesShadow: false,
            });
            teamCage.scale = [hw * 2.04, hh * 2.08, hl * 2.04];
            teamCage.setShader({
                module: CAGE_BK, file: 'shaders/foundry_cage.bk',
                uniforms: { tint: teamTint, pulse: 0, time: 0, xray: 1, pad0: 0 },
            });
            chassisNode.add(teamCage);

            // Slim rear status LED strip showing live worst-part health at a glance
            const beacon = scene.createMesh({
                mesh: 'box', halfW: hw * 0.42, halfH: 0.014, halfD: 0.020,
                color: [0.18, 0.92, 0.48], emissive: 2.0, emissiveColor: [0.18, 0.92, 0.48],
                castsShadow: false,
                position: [0, hh + 0.025, -hl * 0.88],
            });
            chassisNode.add(beacon);

            // Hinged macro weapon body renders the EXACT compiled weapon effector mesh!
            let weaponNode = null;
            if (bot.weaponBody != null) {
                const wr = bot.weaponHead?.analysis.radiusM || 0.32;
                const wGeo = bot.weaponKind === 'hammer_arm' ? hammerArmMesh(wr)
                    : bot.weaponKind === 'spinner_drum' ? verticalDrumMesh(wr)
                    : bot.weaponKind === 'crusher_jaw' ? crusherJawMesh(wr)
                    : bot.weaponKind === 'flipper_spatula' ? flipperSpatulaMesh(wr)
                    : bot.weaponKind === 'piledriver_spear' ? piledriverSpearMesh(wr)
                    : bot.weaponKind === 'fork_lifter' ? forkLifterMesh(wr)
                    : bot.weaponKind === 'grapple_claw' ? grappleClawMesh(wr)
                    : bot.weaponKind === 'winch_drum' ? winchDrumMesh(wr)
                    : bot.weaponKind === 'trebuchet_arm' ? trebuchetArmMesh(wr)
                    : bot.weaponKind === 'excavator_boom' ? excavatorBoomMesh(wr)
                    : bot.weaponKind === 'auger_drill' ? augerDrillMesh(wr)
                    : bot.weaponKind === 'lathe_chuck' ? latheChuckMesh(wr)
                    : bot.weaponKind === 'mech_legs' ? mechLegsMesh(wr)
                    : spinnerBarMesh(wr);
                weaponNode = createPartMesh(wGeo);
                scene.root.add(weaponNode);
            }

            botVis.push({ bot, chassisNode, weaponNode, partMap, teamCage, teamTint, beacon });
        }

        arenaVisuals = { bots: botVis, structViews, sparks: [] };
        vp.reframe([0, 0.30, 0], 8.2, { yaw: 0.62, pitch: -0.48 });
    }

    function syncArena(arena, dt) {
        clock += dt;
        if (!arenaVisuals) return;
        for (const sv of arenaVisuals.structViews) sv.update();

        let sumX = 0, sumZ = 0, botCount = 0;
        for (const bv of arenaVisuals.bots) {
            const p = arena.world.pose(bv.bot.chassisBody);
            bv.chassisNode.position = [p[0], p[1], p[2]];
            bv.chassisNode.quaternion = [p[3], p[4], p[5], p[6]];
            sumX += p[0]; sumZ += p[2]; botCount++;

            if (bv.weaponNode && bv.bot.weaponBody != null) {
                const wp = arena.world.pose(bv.bot.weaponBody);
                bv.weaponNode.position = [wp[0], wp[1], wp[2]];
                bv.weaponNode.quaternion = [wp[3], wp[4], wp[5], wp[6]];
            }

            // Sync EVERY internal compiled part's real rotation, reciprocation, wear, heat, slip & failure!
            updatePartVisuals(bv.partMap, bv.bot.runtime, dt, false);

            let worst = 'ok', maxS = 0;
            const rank = { ok: 0, warn: 1, slipping: 2, overstress: 3, failed: 4 };
            for (const ps of bv.bot.runtime.partState.values()) {
                if (rank[ps.status] > rank[worst]) worst = ps.status;
                if (ps.stressRatio > maxS) maxS = ps.stressRatio;
            }

            if (bv.weaponNode && bv.bot.compiled.weaponChain) {
                const wcs = bv.bot.runtime.chainState.get(bv.bot.compiled.weaponChain.id);
                const wps = bv.bot.weaponHead ? bv.bot.runtime.partState.get(bv.bot.weaponHead.path) : null;
                bv.weaponNode.setShaderUniform('stress', wcs.broken ? 0 : Math.min(1.8, maxS));
                bv.weaponNode.setShaderUniform('slip', wcs.slipping ? 1 : 0);
                bv.weaponNode.setShaderUniform('failed', wps?.failed ? 1 : 0);
                bv.weaponNode.setShaderUniform('time', clock);
            }

            // Keep team-colored holographic frame subtle & crisp; pulse on fault!
            bv.teamCage.visible = showBounds;
            const cTint = worst === 'failed' ? [1.0, 0.18, 0.12, 1.3] : bv.teamTint;
            bv.teamCage.setShaderUniform('tint', cTint);
            bv.teamCage.setShaderUniform('pulse', worst === 'failed' ? 1.0 : worst === 'slipping' ? 0.6 : 0);
            bv.teamCage.setShaderUniform('time', clock);

            const col = worst === 'failed' ? [1.0, 0.14, 0.10]
                : worst === 'slipping' ? [1.0, 0.30, 0.90]
                : worst === 'overstress' ? [1.0, 0.56, 0.10]
                : worst === 'warn' ? [0.96, 0.80, 0.14]
                : [0.18, 0.92, 0.48];
            bv.beacon.color = col;
            bv.beacon.emissiveColor = col;
            bv.beacon.emissive = worst === 'ok' ? 1.6 : 3.2;
        }

        // Smoothly track the midpoint of the brawl when the user isn't manually orbiting/panning
        if (botCount > 0 && vp.cam && vp.cam.target && !(vp.controls && vp.controls.dragging)) {
            const tx = Math.max(-2.2, Math.min(2.2, (sumX / botCount) * 0.65));
            const tz = Math.max(-2.2, Math.min(2.2, (sumZ / botCount) * 0.65));
            const k = 1 - Math.exp(-Math.max(0.001, dt) * 2.4);
            vp.cam.target[0] += (tx - vp.cam.target[0]) * k;
            vp.cam.target[1] += (0.28 - vp.cam.target[1]) * k;
            vp.cam.target[2] += (tz - vp.cam.target[2]) * k;
        }

        // Elongated ballistic HDR white-gold welding spark streaks!
        for (const fx of arena.fxEvents) {
            const count = fx.kind === 'part_fail' ? 5 : 3;
            for (let k = 0; k < count; k++) {
                if (arenaVisuals.sparks.length > 48) break;
                const ang = (clock * 19.7 + k * 2.13 + fx.pos[0] * 5.0) % (2 * PI);
                const spd = 2.4 + (k % 3) * 1.3;
                const vx = Math.cos(ang) * spd, vy = 1.4 + (k % 2) * 1.1, vz = Math.sin(ang) * spd;
                const n = createPartMesh(sparkGeo, { castsShadow: false, receivesShadow: false });
                n.position = [fx.pos[0], Math.max(0.08, fx.pos[1]), fx.pos[2]];
                n.quaternion = qFromZTo(vx, vy, vz);
                arenaVisuals.sparks.push({ node: n, vel: [vx, vy, vz], life: 0.22, maxLife: 0.22 });
            }
        }
        for (let i = arenaVisuals.sparks.length - 1; i >= 0; i--) {
            const sp = arenaVisuals.sparks[i];
            sp.life -= dt;
            if (sp.life <= 0) {
                sp.node.destroy();
                arenaVisuals.sparks.splice(i, 1);
            } else {
                sp.vel[1] -= 9.8 * dt;
                const p = sp.node.position;
                sp.node.position = [p[0] + sp.vel[0] * dt, Math.max(0.02, p[1] + sp.vel[1] * dt), p[2] + sp.vel[2] * dt];
                sp.node.quaternion = qFromZTo(sp.vel[0], sp.vel[1], sp.vel[2]);
                const k = sp.life / sp.maxLife;
                sp.node.scale = [0.8 + k * 0.4, 0.8 + k * 0.4, 0.4 + k * 1.4];
            }
        }
    }

    return {
        loadBlueprintView,
        syncRuntime,
        loadArenaView,
        syncArena,
        setXray(on) { xray = !!on; },
        setShowBounds(on) { showBounds = !!on; },
        setSelected(topNodeId) { selectedTopId = topNodeId || null; },
        clearAll,
    };
}
