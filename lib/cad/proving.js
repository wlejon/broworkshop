// lib/cad/proving.js — Live Box3D Proving Ground running our precision CAD assemblies
// with real rigid-body locomotion, mouse-ray ballistic aiming, live recoil & hydraulics,
// flying AP shells, fiery impact bursts, and destructible multi-story concrete bunkers.

import { addStatic, applyMoved, structureView } from "/lib/kit/dynamics3d.js";
import { buildCadAssembly } from "./assemblies.js";

function qRot(q, v) {
    const tx = 2 * (q[1] * v[2] - q[2] * v[1]);
    const ty = 2 * (q[2] * v[0] - q[0] * v[2]);
    const tz = 2 * (q[0] * v[1] - q[1] * v[0]);
    return [
        v[0] + q[3] * tx + (q[1] * tz - q[2] * ty),
        v[1] + q[3] * ty + (q[2] * tx - q[0] * tz),
        v[2] + q[3] * tz + (q[0] * ty - q[1] * tx),
    ];
}
function qConj(q) { return [-q[0], -q[1], -q[2], q[3]]; }

function buildTargetBunker(world, scene, x, z) {
    const members = [];
    const kinds = [];
    const ties = [];
    const cols = [[-2.4, -2.4], [2.4, -2.4], [-2.4, 2.4], [2.4, 2.4]];
    const footBase = members.length;
    for (const [cx, cz] of cols) {
        members.push({ center: [x + cx, 0.22, z + cz], half: [0.65, 0.22, 0.65], sigma: 2.5e6, crush: 1.6e7, anchored: true, span: 6 });
        kinds.push('foot');
    }
    for (let f = 0; f < 3; f++) {
        const y0 = 0.44 + f * 3.2;
        const base = members.length;
        for (const [cx, cz] of cols) {
            members.push({ center: [x + cx, y0 + 1.3, z + cz], half: [0.48, 1.3, 0.48], sigma: 1.15e6, crush: 8.2e6, anchored: false, span: 6 });
            kinds.push('col');
        }
        // Front armored concrete breastwork wall panel so shots & raycasts strike a real fortress face!
        const wall = members.length;
        members.push({ center: [x, y0 + 1.3, z + 2.4], half: [1.9, 1.25, 0.42], sigma: 0.95e6, crush: 6.8e6, anchored: false, span: 6 });
        kinds.push('col');
        const slab = members.length;
        members.push({ center: [x, y0 + 2.92, z], half: [3.1, 0.32, 3.1], sigma: 1.05e6, crush: 7.5e6, anchored: false, span: 6 });
        kinds.push('slab');
        ties.push([wall, slab]);
        if (f === 0) { ties.push([footBase + 2, wall]); ties.push([footBase + 3, wall]); }
        else { ties.push([base - 1, wall]); }
        for (let i = 0; i < 4; i++) {
            ties.push([base + i, slab]);
            ties.push([f === 0 ? footBase + i : base - 6 + i, base + i]);
        }
    }
    const TINT = { foot: [0.30, 0.32, 0.35], col: [0.54, 0.51, 0.48], slab: [0.42, 0.44, 0.46] };
    const structure = world.addStructure({ members, ties, chunk: 1.15, safety: 1.4, maxPieces: 140 });
    const view = structureView(scene, structure, {
        color(member, cell) {
            const t = TINT[kinds[member]] || TINT.col;
            const k = 0.92 + 0.16 * (((cell * 2654435761) >>> 0) / 4294967296);
            return [t[0] * k, t[1] * k, t[2] * k];
        },
        roughness: 0.90,
    });
    return { structure, view, x, z, initStanding: structure.counts.standing };
}

export function createProvingGround(scene) {
    let world = null;
    let floorMesh = null;
    let cad = null;
    let chassisBody = null;
    let aimMarker = null;
    let flashLight = null;
    let flashLife = 0;
    const bunkers = [];
    const decor = [];
    const projectiles = [];
    const bursts = [];
    let state = {
        theta: 0, turretYaw: 0, turretPitch: 0.14, recoil: 0, recoilVel: 0,
        wheelSpin: 0, punch: 0, spades: false, cooldown: 0,
        aimPoint: [0, 3.0, -24], aimRange: 38, aimLocked: false,
        shotsFired: 0, brokenCells: 0, shake: 0,
    };

    const cleanup = () => {
        if (cad) { cad.destroy(); cad = null; }
        for (const p of projectiles) p.node.destroy();
        projectiles.length = 0;
        for (const b of bursts) { b.core.destroy(); b.shell.destroy(); }
        bursts.length = 0;
        for (const bk of bunkers) { bk.view.destroy(); bk.structure.destroy(); }
        bunkers.length = 0;
        for (const d of decor) d.destroy();
        decor.length = 0;
        if (aimMarker) { aimMarker.outer.destroy(); aimMarker.dot.destroy(); aimMarker = null; }
        if (floorMesh) { floorMesh.destroy(); floorMesh = null; }
        if (flashLight) { flashLight.destroy(); flashLight = null; }
        chassisBody = null;
        if (world) { world.destroy(); world = null; }
    };

    const spawnBurst = (pos, color = '#ff9933', maxR = 1.4, maxAge = 0.22) => {
        const core = scene.createMesh({ mesh: 'sphere', radius: 0.20, segments: 12, rings: 8, color: '#fff5d6', emissive: 2.8, emissiveColor: '#ffe082' });
        const shell = scene.createMesh({ mesh: 'sphere', radius: 0.30, segments: 12, rings: 8, color, emissive: 1.7, emissiveColor: color });
        core.x = pos[0]; core.y = pos[1]; core.z = pos[2];
        shell.x = pos[0]; shell.y = pos[1]; shell.z = pos[2];
        bursts.push({ core, shell, age: 0, maxAge, maxR });
        if (flashLight) {
            flashLight.x = pos[0]; flashLight.y = pos[1] + 0.6; flashLight.z = pos[2];
            flashLight.intensity = 26 * Math.min(2.0, maxR);
            flashLife = maxAge;
        }
    };

    const start = (assemblyId) => {
        cleanup();
        world = bro.dynamics.createWorld({ workers: 4 });
        world.hitSpeed = 6.0;

        flashLight = scene.createLight({ type: 'point', position: [0, 4, 0], color: [1.0, 0.72, 0.32], intensity: 0, range: 28 });

        floorMesh = addStatic(world, scene, {
            shape: 'box', half: [160, 1, 160], position: [0, -1, 0], friction: 0.95, layers: 1,
        }, { color: '#1b2028', roughness: 0.88, metallic: 0.15 }).mesh;
        floorMesh.receivesShadow = true;

        // Tactical range stripes every 10m downrange
        for (let z = -60; z <= 30; z += 10) {
            const stripe = scene.createMesh({
                mesh: 'box', halfW: 24, halfH: 0.01, halfD: 0.10,
                color: z === -24 ? '#d98a22' : '#333d4b', roughness: 0.85,
            });
            stripe.y = 0.012; stripe.z = z;
            decor.push(stripe);
        }

        // Destructible multi-story concrete target bunkers downrange!
        bunkers.push(buildTargetBunker(world, scene, 0, -24));
        bunkers.push(buildTargetBunker(world, scene, -13, -30));
        bunkers.push(buildTargetBunker(world, scene, 13, -30));

        // 3D world aim marker ring
        const outer = scene.createMesh({ mesh: 'cylinder', radius: 0.56, halfHeight: 0.02, segments: 24, color: '#38bdf8', emissive: 1.6, emissiveColor: '#38bdf8' });
        const dot = scene.createMesh({ mesh: 'sphere', radius: 0.13, segments: 10, rings: 8, color: '#e0f2fe', emissive: 2.2, emissiveColor: '#38bdf8' });
        outer.visible = false; dot.visible = false;
        aimMarker = { outer, dot };

        // Mount high-detail CAD assembly synced to a real Box3D chassis body
        cad = buildCadAssembly(scene, assemblyId);
        chassisBody = world.addBox({
            position: [0, 0.62, 12],
            half: [1.35, 0.60, 2.15],
            mass: cad.spec.massKg || 18000,
            friction: 0.85,
            restitution: 0.05,
            layers: 2,
            mask: 1 | 4,
        });

        state = {
            theta: 0, turretYaw: 0, turretPitch: 0.14, recoil: 0, recoilVel: 0,
            wheelSpin: 0, punch: 0, spades: false, cooldown: 0,
            aimPoint: [0, 3.0, -24], aimRange: 36, aimLocked: false,
            shotsFired: 0, brokenCells: 0, shake: 0,
        };
        cad.update(state, 0, [0, 0, 12], [0, 0, 0, 1]);
        return { world, cad, chassisBody };
    };

    const aimAtRay = (ray) => {
        if (!world || !chassisBody || !ray) return state;
        const hit = world.raycast(ray.origin, ray.dir, 320, ~2);
        // Check analytical hit against destructible bunker footprints (Box3D Structure cells live outside plain body raycast)
        let bestT = hit ? hit.distance : Infinity;
        let pt = hit ? [hit.point[0], hit.point[1], hit.point[2]] : null;
        let locked = false;
        for (const bk of bunkers) {
            if (bk.structure.counts.standing <= 0) continue;
            const min = [bk.x - 3.2, 0, bk.z - 3.2], max = [bk.x + 3.2, 9.8, bk.z + 3.2];
            let tmin = -Infinity, tmax = Infinity;
            for (let i = 0; i < 3; i++) {
                if (Math.abs(ray.dir[i]) < 1e-8) {
                    if (ray.origin[i] < min[i] || ray.origin[i] > max[i]) { tmin = 1; tmax = 0; break; }
                } else {
                    let t1 = (min[i] - ray.origin[i]) / ray.dir[i];
                    let t2 = (max[i] - ray.origin[i]) / ray.dir[i];
                    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
                    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
                }
            }
            if (tmax >= Math.max(0, tmin)) {
                const th = Math.max(0, tmin);
                if (th < bestT) {
                    bestT = th;
                    pt = [ray.origin[0] + ray.dir[0] * th, ray.origin[1] + ray.dir[1] * th, ray.origin[2] + ray.dir[2] * th];
                    locked = true;
                }
            }
        }
        if (!pt) {
            if (Math.abs(ray.dir[1]) > 1e-4) {
                const t = Math.max(4, Math.min(200, (2.2 - ray.origin[1]) / ray.dir[1]));
                pt = [ray.origin[0] + ray.dir[0] * t, Math.max(0.2, ray.origin[1] + ray.dir[1] * t), ray.origin[2] + ray.dir[2] * t];
            } else {
                pt = [ray.origin[0] + ray.dir[0] * 80, 2.2, ray.origin[2] + ray.dir[2] * 80];
            }
        }
        state.aimPoint = pt;
        state.aimLocked = locked;

        const p = world.pose(chassisBody);
        const rPos = [p[0], p[1] + 1.4, p[2]];
        const rQuat = [p[3], p[4], p[5], p[6]];
        const dx = pt[0] - rPos[0], dy = pt[1] - rPos[1], dz = pt[2] - rPos[2];
        const range = Math.hypot(dx, dy, dz);
        const horiz = Math.hypot(dx, dz);
        const speed = 108;
        const tFlight = Math.min(2.5, horiz / speed);
        const dropComp = 0.5 * 9.81 * tFlight * tFlight;
        const local = qRot(qConj(rQuat), [dx, dy + dropComp, dz]);
        state.turretYaw = Math.atan2(-local[0], -local[2]);
        state.turretPitch = Math.max(-0.08, Math.min(0.68, Math.atan2(local[1], Math.max(1, Math.hypot(local[0], local[2])))));
        state.aimRange = range;

        if (aimMarker) {
            const col = state.aimLocked ? [1.0, 0.32, 0.22] : [0.22, 0.74, 0.98];
            aimMarker.outer.x = pt[0]; aimMarker.outer.y = Math.max(0.05, pt[1]); aimMarker.outer.z = pt[2];
            aimMarker.outer.color = col; aimMarker.outer.visible = true;
            aimMarker.dot.x = pt[0]; aimMarker.dot.y = Math.max(0.14, pt[1] + 0.06); aimMarker.dot.z = pt[2];
            aimMarker.dot.visible = true;
        }
        return state;
    };

    const step = (dt, input = {}) => {
        if (!world || !chassisBody || !cad) return null;
        const h = Math.min(1 / 60, dt);
        state.cooldown = Math.max(0, state.cooldown - h);
        state.shake = Math.max(0, state.shake - h * 2.4);
        state.spades = !!input.spades;

        const p = world.pose(chassisBody);
        const rPos = [p[0], p[1], p[2]];
        const rQuat = [p[3], p[4], p[5], p[6]];
        const fwd = qRot(rQuat, [0, 0, -1]);
        const vel = world.velocity(chassisBody);
        const mass = cad.spec.massKg || 18000;

        // Smooth physical drive & steering on Box3D rigid chassis
        const throttle = (cad.spec.canDrive && !state.spades) ? (input.throttle || 0) : 0;
        const steer = (cad.spec.canDrive && !state.spades) ? (input.steer || 0) : 0;
        const curFwd = vel[0] * fwd[0] + vel[2] * fwd[2];
        const targetSpd = throttle * (cad.spec.category === 'walker' ? 4.2 : 8.5);
        const forceMag = (targetSpd - curFwd) * mass * 2.6;
        world.applyForce(chassisBody, [fwd[0] * forceMag, 0, fwd[2] * forceMag], rPos);
        // Lateral tire grip damping
        const right = qRot(rQuat, [1, 0, 0]);
        const latSpd = vel[0] * right[0] + vel[2] * right[2];
        world.applyForce(chassisBody, [-right[0] * latSpd * mass * 5.0, 0, -right[2] * latSpd * mass * 5.0], rPos);
        world.applyTorque(chassisBody, [0, -steer * mass * 4.8 - vel[4] * mass * 3.2, 0]);

        state.wheelSpin += curFwd * h / 0.56;
        state.theta += h * (cad.spec.category === 'walker' ? (Math.abs(curFwd) * 1.4 + Math.abs(steer) * 2.2) : 2.8);

        // Recoil spring-damper recovery
        const kSpring = 72, cDamp = 13;
        state.recoilVel += (-kSpring * state.recoil - cDamp * state.recoilVel) * h;
        state.recoil = Math.max(0, Math.min(0.62, state.recoil + state.recoilVel * h));

        // Pile-driver hydraulic ram punch
        if (cad.spec.category === 'brawler') {
            const targetPunch = input.fire ? 1.25 : 0;
            state.punch += (targetPunch - state.punch) * Math.min(1, h * (input.fire ? 18 : 6));
        }

        // Fire AP shell from rifled cannon with real 3rd-law recoil!
        if (cad.spec.canAim && input.fire && state.cooldown <= 0) {
            state.cooldown = 1.05;
            state.recoilVel = 3.6;
            state.shotsFired++;
            state.shake = Math.max(state.shake, 0.32);

            const qYaw = [0, Math.sin(state.turretYaw * 0.5), 0, Math.cos(state.turretYaw * 0.5)];
            const qPitch = [Math.sin(state.turretPitch * 0.5), 0, 0, Math.cos(state.turretPitch * 0.5)];
            const localDir = qRot(qYaw, qRot(qPitch, [0, 0, -1]));
            const dir = qRot(rQuat, localDir);
            const pivWorld = [rPos[0], rPos[1] + 1.65, rPos[2]];
            const muzzle = [pivWorld[0] + dir[0] * 4.2, pivWorld[1] + dir[1] * 4.2, pivWorld[2] + dir[2] * 4.2];
            const shellBody = world.addSphere({
                position: muzzle, radius: 0.22, mass: 140,
                velocity: [dir[0] * 108, dir[1] * 108, dir[2] * 108],
                bullet: true, friction: 0.4, restitution: 0.12, layers: 8, mask: 1,
            });
            world.applyImpulse(chassisBody, [-dir[0] * 8500, -dir[1] * 8500, -dir[2] * 8500], pivWorld);
            spawnBurst(muzzle, '#ffbe55', 0.72, 0.12);
            const node = scene.createMesh({ mesh: 'sphere', radius: 0.22, segments: 12, rings: 8, color: '#ffae42', emissive: 2.2, emissiveColor: '#ff9524', castsShadow: true });
            node.x = muzzle[0]; node.y = muzzle[1]; node.z = muzzle[2];
            projectiles.push({ body: shellBody, node, age: 0, maxAge: 5.0, hit: false });
        }

        world.step(h, 4);

        for (const ht of world.hits()) {
            if (ht.speed > 12) {
                spawnBurst(ht.point, '#ff7722', Math.min(2.2, 0.7 + ht.speed * 0.018), 0.24);
                state.shake = Math.max(state.shake, 0.28);
            }
            for (const pr of projectiles) {
                if (!pr.hit && (ht.a === pr.body || ht.b === pr.body) && pr.age > 0.04) {
                    pr.hit = true;
                    pr.maxAge = Math.min(pr.maxAge, pr.age + 0.035);
                }
            }
        }

        if (flashLight && flashLife > 0) {
            flashLife = Math.max(0, flashLife - h);
            flashLight.intensity = flashLife > 0 ? flashLight.intensity * (flashLife / (flashLife + h * 1.5)) : 0;
        }
        for (let i = bursts.length - 1; i >= 0; i--) {
            const b = bursts[i]; b.age += h;
            if (b.age >= b.maxAge) { b.core.destroy(); b.shell.destroy(); bursts.splice(i, 1); }
            else {
                const k = b.age / b.maxAge;
                const sc = Math.max(0.1, (1 - k) * 1.6), ss = 1 + k * b.maxR * 2.4;
                b.core.scaleX = sc; b.core.scaleY = sc; b.core.scaleZ = sc;
                b.shell.scaleX = ss; b.shell.scaleY = ss; b.shell.scaleZ = ss;
            }
        }
        const pMap = new Map();
        for (let i = projectiles.length - 1; i >= 0; i--) {
            const pr = projectiles[i]; pr.age += h;
            if (pr.age > pr.maxAge || !world.hasBody(pr.body)) {
                if (world.hasBody(pr.body)) world.removeBody(pr.body);
                pr.node.destroy(); projectiles.splice(i, 1);
            } else { pMap.set(pr.body, pr.node); }
        }
        applyMoved(world, pMap);

        let brokenCells = 0;
        for (const bk of bunkers) {
            bk.view.update();
            brokenCells += bk.initStanding - bk.structure.counts.standing;
        }
        state.brokenCells = brokenCells;

        // Sync precision CAD visual assembly directly to Box3D rigid chassis!
        const pAfter = world.pose(chassisBody);
        const rootPos = [pAfter[0], pAfter[1] - 0.60, pAfter[2]];
        const rootQuat = [pAfter[3], pAfter[4], pAfter[5], pAfter[6]];
        cad.update(state, 0, rootPos, rootQuat);

        return {
            pos: [pAfter[0], pAfter[1] + 0.8, pAfter[2]],
            stepMs: world.counts.stepMs,
            shotsFired: state.shotsFired,
            brokenCells,
            reloadFrac: cad.spec.canAim ? (1 - Math.min(1, state.cooldown / 1.05)) : 1,
            aimRange: state.aimRange,
            aimLocked: state.aimLocked,
            shake: state.shake,
        };
    };

    return {
        start, aimAtRay, step, cleanup,
        get active() { return !!world; },
        get cad() { return cad; },
        get state() { return state; },
        setStress(on) { if (cad) cad.setStress(on, 0.65); },
    };
}
