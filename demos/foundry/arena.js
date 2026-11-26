// demos/foundry/arena.js — Live Battle Arena & Destructible Proving Ground
// running multi-threaded Box3D physics with painted range rings, concrete bunkers,
// glowing shell tracers, and impact bursts.

import { addStatic, applyMoved, structureView } from "/lib/kit/dynamics3d.js";
import { spawnCompiledMachine, stepMachine, computeAiInput } from "/lib/machine/runtime.js";
import { createRuntimeMachineView } from "/lib/machine/view.js";

function buildBunkerStructure(world, scene, x, z) {
    const members = [];
    const ties = [];
    const cols = [[-2.6, -2.6], [2.6, -2.6], [-2.6, 2.6], [2.6, 2.6]];
    for (let f = 0; f < 3; f++) {
        const y0 = f * 3.4;
        const base = members.length;
        for (const [cx, cz] of cols) {
            members.push({
                center: [x + cx, y0 + 1.4, z + cz],
                half: [0.52, 1.4, 0.52],
                sigma: 2.0e6,
                crush: 1.6e7,
                anchored: f === 0,
                span: 6,
            });
        }
        const slab = members.length;
        members.push({
            center: [x, y0 + 3.1, z],
            half: [3.4, 0.34, 3.4],
            sigma: 1.9e6,
            crush: 1.5e7,
            span: 6,
        });
        for (let i = 0; i < 4; i++) {
            ties.push([base + i, slab]);
            if (f > 0) ties.push([base - 5 + i, base + i]);
        }
    }
    const structure = world.addStructure({ members, ties, chunk: 1.2, safety: 1.8, maxPieces: 120 });
    const view = structureView(scene, structure, {
        color: () => [0.54, 0.52, 0.49],
        roughness: 0.88,
    });
    return { structure, view };
}

function buildRangeMarkings(scene) {
    const items = [];
    for (const r of [16, 32, 48]) {
        const segs = 36;
        for (let i = 0; i < segs; i++) {
            if (i % 2 === 1) continue;
            const a = (i / segs) * Math.PI * 2;
            const dash = scene.createMesh({
                mesh: 'box', halfW: 0.28, halfH: 0.01, halfD: (Math.PI * r / segs) * 0.8,
                color: r === 16 ? '#d97706' : '#475569', roughness: 0.9,
            });
            dash.x = Math.sin(a) * r; dash.y = 0.012; dash.z = Math.cos(a) * r;
            dash.quaternion = [0, Math.sin(a * 0.5), 0, Math.cos(a * 0.5)];
            items.push(dash);
        }
    }
    // Proving ground centerline chevron strips
    for (let z = -60; z <= 60; z += 10) {
        const mark = scene.createMesh({ mesh: 'box', halfW: 0.18, halfH: 0.01, halfD: 2.2, color: '#64748b', roughness: 0.9 });
        mark.y = 0.012; mark.z = z;
        items.push(mark);
    }
    return items;
}

export function createArena(scene) {
    let world = null;
    let floorMesh = null;
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
        for (const b of bursts) b.node.destroy();
        bursts.length = 0;
        for (const s of structures) { s.view.destroy(); s.structure.destroy(); }
        structures.length = 0;
        for (const w of walls) w.destroy();
        walls.length = 0;
        for (const d of decor) d.destroy();
        decor.length = 0;
        if (floorMesh) { floorMesh.destroy(); floorMesh = null; }
        playerInst = null; enemyInst = null;
        if (world) { world.destroy(); world = null; }
    };

    const spawnBurst = (pos, color = '#ffb040', maxR = 1.6) => {
        const node = scene.createMesh({
            mesh: 'sphere', radius: 0.35, segments: 12, rings: 8,
            color, emissive: 1.4, emissiveColor: color,
        });
        node.x = pos[0]; node.y = pos[1]; node.z = pos[2];
        bursts.push({ node, age: 0, maxAge: 0.25, maxR });
    };

    const spawnMatch = (playerCompiled, enemyCompiled) => {
        cleanup();
        world = bro.dynamics.createWorld({ workers: 4 });
        world.hitSpeed = 8.0;

        floorMesh = addStatic(world, scene, {
            shape: 'box', half: [140, 1, 140], position: [0, -1, 0], friction: 1.0, layers: 1,
        }, { color: '#252b34', roughness: 0.88, metallic: 0.15 }).mesh;
        floorMesh.receivesShadow = true;
        decor.push(...buildRangeMarkings(scene));

        const wallSpecs = [
            { half: [140, 2.8, 1.5], pos: [0, 1.8, -100] },
            { half: [140, 2.8, 1.5], pos: [0, 1.8, 100] },
            { half: [1.5, 2.8, 100], pos: [-100, 1.8, 0] },
            { half: [1.5, 2.8, 100], pos: [100, 1.8, 0] },
        ];
        for (const ws of wallSpecs) {
            walls.push(addStatic(world, scene, { shape: 'box', half: ws.half, position: ws.pos, layers: 1 }, { color: '#38414e', roughness: 0.88 }).mesh);
        }

        // Flanking destructible concrete bunkers
        structures.push(buildBunkerStructure(world, scene, -22, 0));
        structures.push(buildBunkerStructure(world, scene, 22, 0));

        const pY = -playerCompiled.bounds.min[1] + 0.16;
        playerInst = spawnCompiledMachine(world, playerCompiled, {
            position: [0, pY, 22], yaw: 0, team: 1, name: 'Player',
        });
        playerView = createRuntimeMachineView(scene, playerInst, { teamTint: '#2b6cb0' });

        if (enemyCompiled) {
            const eY = -enemyCompiled.bounds.min[1] + 0.16;
            enemyInst = spawnCompiledMachine(world, enemyCompiled, {
                position: [0, eY, -22], yaw: Math.PI, team: 2, name: 'Opponent',
            });
            enemyView = createRuntimeMachineView(scene, enemyInst, { teamTint: '#c53030' });
        }
        return { world, playerInst, enemyInst };
    };

    const adoptNewProjectiles = (inst) => {
        if (!inst || !inst.projectilesOut.length) return;
        for (const pr of inst.projectilesOut) {
            const color = pr.ownerTeam === 1 ? '#5ac8fa' : '#ff6b4a';
            const p = world.pose(pr.body);
            spawnBurst([p[0], p[1], p[2]], '#ffd166', 1.2);
            const node = scene.createMesh({
                mesh: 'sphere', radius: pr.radius, segments: 12, rings: 8,
                color, emissive: 1.2, emissiveColor: color, castsShadow: true,
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
            if (ht.speed > 20) spawnBurst(ht.point, '#ff8a3d', Math.min(3.5, 0.8 + ht.speed * 0.03));
        }
        for (let i = bursts.length - 1; i >= 0; i--) {
            const b = bursts[i];
            b.age += h;
            if (b.age >= b.maxAge) { b.node.destroy(); bursts.splice(i, 1); }
            else {
                const s = 1 + (b.age / b.maxAge) * b.maxR * 2.5;
                b.node.scaleX = s; b.node.scaleY = s; b.node.scaleZ = s;
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
