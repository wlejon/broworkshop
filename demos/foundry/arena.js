// demos/foundry/arena.js — Live Arena Combat & Destructible Target Testing
// for compiled recursive machines in bro.dynamics ({ workers: 4 }).

import { addStatic, addBody, applyMoved, structureView } from "/lib/kit/dynamics3d.js";
import { spawnCompiledMachine, stepMachine, computeAiInput } from "/lib/machine/runtime.js";
import { createRuntimeMachineView } from "/lib/machine/view.js";

function buildBunkerStructure(world, scene, x, z) {
    const members = [];
    const ties = [];
    const cols = [[-3.0, -3.0], [3.0, -3.0], [-3.0, 3.0], [3.0, 3.0]];
    for (let f = 0; f < 3; f++) {
        const y0 = f * 3.6;
        const base = members.length;
        for (const [cx, cz] of cols) {
            members.push({
                center: [x + cx, y0 + 1.5, z + cz],
                half: [0.55, 1.5, 0.55],
                sigma: 2.2e6,
                crush: 1.8e7,
                anchored: f === 0,
                span: 6,
            });
        }
        const slab = members.length;
        members.push({
            center: [x, y0 + 3.3, z],
            half: [3.8, 0.35, 3.8],
            sigma: 2.0e6,
            crush: 1.6e7,
            span: 6,
        });
        for (let i = 0; i < 4; i++) {
            ties.push([base + i, slab]);
            if (f > 0) ties.push([base - 5 + i, base + i]);
        }
    }
    const structure = world.addStructure({ members, ties, chunk: 1.2, safety: 1.8, maxPieces: 120 });
    const view = structureView(scene, structure, {
        color: () => [0.68, 0.66, 0.63],
        roughness: 0.85,
    });
    return { structure, view };
}

export function createArena(scene) {
    let world = null;
    let floorMesh = null;
    const walls = [];
    const structures = [];
    let playerInst = null, playerView = null;
    let enemyInst = null, enemyView = null;
    const projectiles = []; // { body, node, age, maxAge }
    let showStress = false;
    let paused = false;
    let lastStepMs = 0;

    const cleanup = () => {
        if (playerView) { playerView.destroy(); playerView = null; }
        if (enemyView) { enemyView.destroy(); enemyView = null; }
        for (const p of projectiles) p.node.destroy();
        projectiles.length = 0;
        for (const s of structures) { s.view.destroy(); s.structure.destroy(); }
        structures.length = 0;
        for (const w of walls) w.destroy();
        walls.length = 0;
        if (floorMesh) { floorMesh.destroy(); floorMesh = null; }
        playerInst = null; enemyInst = null;
        if (world) { world.destroy(); world = null; }
    };

    const spawnMatch = (playerCompiled, enemyCompiled) => {
        cleanup();
        world = bro.dynamics.createWorld({ workers: 4 });
        world.hitSpeed = 8.0;

        floorMesh = addStatic(world, scene, {
            shape: 'box', half: [130, 1, 130], position: [0, -1, 0], friction: 1.0,
        }, { color: '#393e46', roughness: 0.92 }).mesh;

        // Arena perimeter walls.
        const wallSpecs = [
            { half: [130, 3, 1.5], pos: [0, 2, -120] },
            { half: [130, 3, 1.5], pos: [0, 2, 120] },
            { half: [1.5, 3, 120], pos: [-120, 2, 0] },
            { half: [1.5, 3, 120], pos: [120, 2, 0] },
        ];
        for (const ws of wallSpecs) {
            walls.push(addStatic(world, scene, { shape: 'box', half: ws.half, position: ws.pos }, { color: '#4f5560', roughness: 0.88 }).mesh);
        }

        // Two destructible Metropolis-style concrete structures inside the arena!
        structures.push(buildBunkerStructure(world, scene, -24, 0));
        structures.push(buildBunkerStructure(world, scene, 24, 0));

        const pY = -playerCompiled.bounds.min[1] + 0.25;
        playerInst = spawnCompiledMachine(world, playerCompiled, {
            position: [0, pY, 24], yaw: 0, team: 1, name: 'Player',
        });
        playerView = createRuntimeMachineView(scene, playerInst, { teamTint: '#3d7be0' });

        if (enemyCompiled) {
            const eY = -enemyCompiled.bounds.min[1] + 0.25;
            enemyInst = spawnCompiledMachine(world, enemyCompiled, {
                position: [0, eY, -24], yaw: Math.PI, team: 2, name: 'Opponent',
            });
            enemyView = createRuntimeMachineView(scene, enemyInst, { teamTint: '#c94c4c' });
        }
        return { world, playerInst, enemyInst };
    };

    const adoptNewProjectiles = (inst) => {
        if (!inst || !inst.projectilesOut.length) return;
        for (const pr of inst.projectilesOut) {
            const color = pr.ownerTeam === 1 ? '#5ac8fa' : '#ff6b4a';
            const node = scene.createMesh({
                mesh: 'sphere', radius: pr.radius, segments: 12, rings: 8,
                color, emissive: 0.85, emissiveColor: color, castsShadow: true,
            });
            const p = world.pose(pr.body);
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

        // Sync moved projectiles & expire old ones.
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
        spawnMatch,
        step,
        setStressOverlay(v) { showStress = !!v; },
        get stressOverlay() { return showStress; },
        setPaused(v) { paused = !!v; },
        get paused() { return paused; },
        get active() { return !!world; },
        get player() { return playerInst; },
        get enemy() { return enemyInst; },
        get world() { return world; },
        cleanup,
    };
}
