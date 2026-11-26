// demos/foundry/arena.js — Live Battle Arena & Proving Ground running
// multi-threaded Box3D physics with dark tarmac, tactical range rings,
// multi-tone destructible concrete bunkers, muzzle/impact point lights,
// glowing tracers, and fireball bursts.

import { addStatic, applyMoved, structureView } from "/lib/kit/dynamics3d.js";
import { spawnCompiledMachine, stepMachine, computeAiInput } from "/lib/machine/runtime.js";
import { createRuntimeMachineView } from "/lib/machine/view.js";

function buildBunkerStructure(world, scene, x, z) {
    const members = [];
    const kinds = [];
    const ties = [];
    const cols = [[-2.6, -2.6], [2.6, -2.6], [-2.6, 2.6], [2.6, 2.6]];
    // Shallow anchored foundation footings at ground level; all columns & slabs above are destructible!
    const footBase = members.length;
    for (const [cx, cz] of cols) {
        members.push({
            center: [x + cx, 0.22, z + cz],
            half: [0.68, 0.22, 0.68],
            sigma: 2.4e6,
            crush: 1.6e7,
            anchored: true,
            span: 6,
        });
        kinds.push('footing');
    }
    for (let f = 0; f < 3; f++) {
        const y0 = 0.44 + f * 3.4;
        const base = members.length;
        for (const [cx, cz] of cols) {
            members.push({
                center: [x + cx, y0 + 1.4, z + cz],
                half: [0.52, 1.4, 0.52],
                sigma: 1.2e6,
                crush: 8.5e6,
                anchored: false,
                span: 6,
            });
            kinds.push('column');
        }
        const slab = members.length;
        members.push({
            center: [x, y0 + 3.1, z],
            half: [3.4, 0.34, 3.4],
            sigma: 1.1e6,
            crush: 8.0e6,
            span: 6,
        });
        kinds.push('slab');
        for (let i = 0; i < 4; i++) {
            ties.push([base + i, slab]);
            if (f === 0) ties.push([footBase + i, base + i]);
            else ties.push([base - 5 + i, base + i]);
        }
    }
    const TINT = {
        footing: [0.34, 0.35, 0.37],
        column: [0.56, 0.53, 0.49],
        slab: [0.44, 0.45, 0.47],
    };
    const structure = world.addStructure({ members, ties, chunk: 1.2, safety: 1.4, maxPieces: 120 });
    const view = structureView(scene, structure, {
        color(member, cell) {
            const t = TINT[kinds[member]] || TINT.column;
            const k = 0.93 + 0.14 * (((cell * 2654435761) >>> 0) / 4294967296);
            return [t[0] * k, t[1] * k, t[2] * k];
        },
        roughness: 0.90,
    });
    return { structure, view };
}

function buildProvingGroundDecor(scene) {
    const items = [];
    const add = (opts, pos, quat) => {
        const m = scene.createMesh(opts);
        if (pos) { m.x = pos[0]; m.y = pos[1]; m.z = pos[2]; }
        if (quat) m.quaternion = quat;
        items.push(m);
        return m;
    };

    // Tactical combat rings (16m amber engagement ring, 32m & 48m steel rings)
    for (const r of [16, 32, 48]) {
        const segs = r === 16 ? 32 : 40;
        for (let i = 0; i < segs; i++) {
            if (i % 2 === 1) continue;
            const a = (i / segs) * Math.PI * 2;
            const inner = r === 16;
            add({
                mesh: 'box', halfW: inner ? 0.24 : 0.18, halfH: 0.01, halfD: (Math.PI * r / segs) * 0.78,
                color: inner ? '#d98a22' : '#414d5e',
                emissive: inner ? 0.25 : 0, emissiveColor: '#f59e0b', roughness: 0.85,
            }, [Math.sin(a) * r, 0.012, Math.cos(a) * r], [0, Math.sin(a * 0.5), 0, Math.cos(a * 0.5)]);
        }
    }

    // Center combat lane runway dashes & cross-axis ticks
    for (let z = -60; z <= 60; z += 8) {
        add({ mesh: 'box', halfW: 0.15, halfH: 0.01, halfD: 1.8, color: '#4c596c', roughness: 0.88 }, [0, 0.012, z]);
    }
    for (let x = -56; x <= 56; x += 14) {
        if (Math.abs(x) < 1) continue;
        add({ mesh: 'box', halfW: 1.6, halfH: 0.01, halfD: 0.14, color: '#394352', roughness: 0.88 }, [x, 0.012, 0]);
    }

    // Painted Player (+22m, Cobalt) and Opponent (-22m, Crimson) starting pads
    for (const [zc, col] of [[22, '#2d76c4'], [-22, '#c84242']]) {
        add({ mesh: 'box', halfW: 4.5, halfH: 0.012, halfD: 0.16, color: col, emissive: 0.35, emissiveColor: col }, [0, 0.014, zc - 4.2]);
        add({ mesh: 'box', halfW: 4.5, halfH: 0.012, halfD: 0.16, color: col, emissive: 0.35, emissiveColor: col }, [0, 0.014, zc + 4.2]);
        add({ mesh: 'box', halfW: 0.16, halfH: 0.012, halfD: 4.2, color: col, emissive: 0.35, emissiveColor: col }, [-4.5, 0.014, zc]);
        add({ mesh: 'box', halfW: 0.16, halfH: 0.012, halfD: 4.2, color: col, emissive: 0.35, emissiveColor: col }, [4.5, 0.014, zc]);
    }

    // Ground concrete plinths beneath the two flanking bunkers
    for (const bx of [-22, 22]) {
        add({ mesh: 'box', halfW: 4.2, halfH: 0.12, halfD: 4.2, color: '#272d36', roughness: 0.9, receivesShadow: true }, [bx, 0.04, 0]);
    }
    return items;
}

export function createArena(scene) {
    let world = null;
    let floorMesh = null;
    let flashLight = null;
    let flashLife = 0;
    const decor = [];
    const walls = [];
    const structures = [];
    let playerInst = null, playerView = null;
    let enemyInst = null, enemyView = null;
    const projectiles = [];
    const bursts = [];
    let showStress = false;
    let paused = false;
    let lastStepMs = 0;

    const cleanup = () => {
        if (playerView) { playerView.destroy(); playerView = null; }
        if (enemyView) { enemyView.destroy(); enemyView = null; }
        for (const p of projectiles) p.node.destroy();
        projectiles.length = 0;
        for (const b of bursts) { b.core.destroy(); b.shell.destroy(); }
        bursts.length = 0;
        for (const s of structures) { s.view.destroy(); s.structure.destroy(); }
        structures.length = 0;
        for (const w of walls) w.destroy();
        walls.length = 0;
        for (const d of decor) d.destroy();
        decor.length = 0;
        if (floorMesh) { floorMesh.destroy(); floorMesh = null; }
        if (flashLight) { flashLight.destroy(); flashLight = null; }
        flashLife = 0;
        playerInst = null; enemyInst = null;
        if (world) { world.destroy(); world = null; }
    };

    const spawnBurst = (pos, color = '#ff9933', maxR = 1.2, maxAge = 0.16) => {
        const core = scene.createMesh({
            mesh: 'sphere', radius: 0.18, segments: 12, rings: 8,
            color: '#fff4d2', emissive: 2.6, emissiveColor: '#ffe08a',
        });
        const shell = scene.createMesh({
            mesh: 'sphere', radius: 0.28, segments: 12, rings: 8,
            color, emissive: 1.6, emissiveColor: color,
        });
        core.x = pos[0]; core.y = pos[1]; core.z = pos[2];
        shell.x = pos[0]; shell.y = pos[1]; shell.z = pos[2];
        bursts.push({ core, shell, age: 0, maxAge, maxR });

        if (flashLight) {
            flashLight.x = pos[0]; flashLight.y = pos[1] + 0.6; flashLight.z = pos[2];
            flashLight.intensity = 22 * Math.min(2.0, maxR);
            flashLife = maxAge;
        }
    };

    const spawnMatch = (playerCompiled, enemyCompiled) => {
        cleanup();
        world = bro.dynamics.createWorld({ workers: 4 });
        world.hitSpeed = 8.0;

        flashLight = scene.createLight({
            type: 'point', position: [0, 4, 0],
            color: [1.0, 0.72, 0.32], intensity: 0, range: 26,
        });

        floorMesh = addStatic(world, scene, {
            shape: 'box', half: [150, 1, 150], position: [0, -1, 0], friction: 1.0, layers: 1,
        }, { color: '#1d222a', roughness: 0.88, metallic: 0.14 }).mesh;
        floorMesh.receivesShadow = true;
        decor.push(...buildProvingGroundDecor(scene));

        const wallSpecs = [
            { half: [140, 2.4, 1.4], pos: [0, 1.4, -100] },
            { half: [140, 2.4, 1.4], pos: [0, 1.4, 100] },
            { half: [1.4, 2.4, 100], pos: [-100, 1.4, 0] },
            { half: [1.4, 2.4, 100], pos: [100, 1.4, 0] },
        ];
        for (const ws of wallSpecs) {
            walls.push(addStatic(world, scene, { shape: 'box', half: ws.half, position: ws.pos, layers: 1 }, { color: '#2b323d', roughness: 0.88 }).mesh);
        }

        // Flanking multi-tone destructible concrete bunkers
        structures.push(buildBunkerStructure(world, scene, -22, 0));
        structures.push(buildBunkerStructure(world, scene, 22, 0));

        const pY = -playerCompiled.bounds.min[1] + 0.16;
        playerInst = spawnCompiledMachine(world, playerCompiled, {
            position: [0, pY, 22], yaw: 0, team: 1, name: 'Player',
        });
        playerView = createRuntimeMachineView(scene, playerInst, { teamTint: '#2e6fb8' });

        if (enemyCompiled) {
            const eY = -enemyCompiled.bounds.min[1] + 0.16;
            enemyInst = spawnCompiledMachine(world, enemyCompiled, {
                position: [0, eY, -22], yaw: Math.PI, team: 2, name: 'Opponent',
            });
            enemyView = createRuntimeMachineView(scene, enemyInst, { teamTint: '#c23b3b' });
        }
        return { world, playerInst, enemyInst };
    };

    const adoptNewProjectiles = (inst) => {
        if (!inst || !inst.projectilesOut.length) return;
        for (const pr of inst.projectilesOut) {
            const color = pr.ownerTeam === 1 ? '#4cc9ff' : '#ff6242';
            const p = world.pose(pr.body);
            spawnBurst([p[0], p[1], p[2]], '#ffbe55', 0.55, 0.11);
            const node = scene.createMesh({
                mesh: 'sphere', radius: pr.radius, segments: 12, rings: 8,
                color, emissive: 2.0, emissiveColor: color, castsShadow: true,
            });
            node.x = p[0]; node.y = p[1]; node.z = p[2];
            projectiles.push({ body: pr.body, node, age: 0, maxAge: pr.maxAge });
        }
        inst.projectilesOut.length = 0;
    };

    const step = (dt, playerInput) => {
        if (!world || paused) return null;
        const h = Math.min(1 / 60, dt);

        if (playerInst) stepMachine(playerInst, h, playerInput);
        if (enemyInst && playerInst) {
            const pp = world.pose(playerInst.rootBody);
            const aiIn = computeAiInput(enemyInst, [pp[0], pp[1], pp[2]], h);
            stepMachine(enemyInst, h, aiIn);
        }

        adoptNewProjectiles(playerInst);
        adoptNewProjectiles(enemyInst);

        world.step(h, 4);
        lastStepMs = world.counts.stepMs;

        for (const ht of world.hits()) {
            if (ht.speed > 18) spawnBurst(ht.point, '#ff7722', Math.min(2.2, 0.65 + ht.speed * 0.022), 0.22);
        }

        if (flashLight && flashLife > 0) {
            flashLife = Math.max(0, flashLife - h);
            flashLight.intensity = flashLife > 0 ? flashLight.intensity * (flashLife / (flashLife + h * 1.5)) : 0;
        }

        for (let i = bursts.length - 1; i >= 0; i--) {
            const b = bursts[i];
            b.age += h;
            if (b.age >= b.maxAge) { b.core.destroy(); b.shell.destroy(); bursts.splice(i, 1); }
            else {
                const k = b.age / b.maxAge;
                const sc = Math.max(0.1, (1 - k) * 1.6);
                const ss = 1 + k * b.maxR * 2.4;
                b.core.scaleX = sc; b.core.scaleY = sc; b.core.scaleZ = sc;
                b.shell.scaleX = ss; b.shell.scaleY = ss; b.shell.scaleZ = ss;
            }
        }

        const projMap = new Map();
        for (let i = projectiles.length - 1; i >= 0; i--) {
            const pr = projectiles[i];
            pr.age += h;
            if (pr.age > pr.maxAge || !world.hasBody(pr.body)) {
                if (world.hasBody(pr.body)) world.removeBody(pr.body);
                pr.node.destroy();
                projectiles.splice(i, 1);
            } else {
                projMap.set(pr.body, pr.node);
            }
        }
        applyMoved(world, projMap);

        for (const s of structures) s.view.update();
        if (playerView) playerView.update(showStress);
        if (enemyView) enemyView.update(showStress);

        const rPose = playerInst && world.hasBody(playerInst.rootBody) ? world.pose(playerInst.rootBody) : [0, 2, 0, 0, 0, 0, 1];
        return {
            stepMs: lastStepMs,
            playerPos: [rPose[0], rPose[1], rPose[2]],
            playerIntegrity: playerInst ? playerInst.integrity : 0,
            enemyIntegrity: enemyInst ? enemyInst.integrity : 0,
            playerBroken: playerInst ? (playerInst.brokenCount + playerInst.strippedCount) : 0,
            enemyBroken: enemyInst ? (enemyInst.brokenCount + enemyInst.strippedCount) : 0,
            shells: projectiles.length,
        };
    };

    return {
        spawnMatch, step,
        setStressOverlay(v) { showStress = !!v; },
        get stressOverlay() { return showStress; },
        setPaused(v) { paused = !!v; },
        get active() { return !!world; },
        get player() { return playerInst; },
        get enemy() { return enemyInst; },
        get world() { return world; },
        cleanup,
    };
}
