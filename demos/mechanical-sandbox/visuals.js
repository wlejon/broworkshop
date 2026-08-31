// visuals.js — 3D mesh constructors and dynamic connection visualizers.

/**
 * Shortest quaternion rotating +Y onto unit direction vector d.
 */
export function quatYTo(dx, dy, dz) {
    const len = Math.hypot(dx, dy, dz) || 1;
    const x = dx / len, y = dy / len, z = dz / len;
    if (y > 0.999999) return [0, 0, 0, 1];
    if (y < -0.999999) return [1, 0, 0, 0];
    const ax = z, az = -x;
    const al = Math.hypot(ax, az) || 1;
    const half = Math.acos(Math.max(-1, Math.min(1, y))) / 2;
    const s = Math.sin(half);
    return [(ax / al) * s, 0, (az / al) * s, Math.cos(half)];
}

/**
 * Creates a detailed 3D Gear mesh with perimeter teeth, rim, and central hub
 */
export function createGearMesh(scene, radius = 1.0, halfThickness = 0.15, teethCount = 12, color = '#d4af37') {
    const root = scene.createNode('gear');

    // Central cylinder body
    const body = scene.createMesh({
        mesh: Mesh.cylinder(radius, halfThickness, 24),
        color,
        roughness: 0.35,
        metalness: 0.7
    });
    root.add(body);

    // Center hub
    const hub = scene.createMesh({
        mesh: Mesh.cylinder(radius * 0.35, halfThickness * 1.25, 16),
        color: '#2a2e39',
        roughness: 0.4,
        metalness: 0.9
    });
    root.add(hub);

    // Axle hole
    const bore = scene.createMesh({
        mesh: Mesh.cylinder(radius * 0.15, halfThickness * 1.3, 12),
        color: '#11141a',
        roughness: 0.8
    });
    root.add(bore);

    // Individual 3D gear teeth around perimeter
    const toothHw = (Math.PI * radius) / (teethCount * 2.2);
    const toothHh = halfThickness;
    const toothHd = radius * 0.18;

    for (let i = 0; i < teethCount; i++) {
        const angle = (i / teethCount) * Math.PI * 2;
        const tooth = scene.createMesh({
            mesh: Mesh.box(toothHw, toothHh, toothHd),
            color: '#c59b27',
            roughness: 0.4,
            metalness: 0.7
        });
        const dist = radius + toothHd * 0.7;
        tooth.position = [Math.cos(angle) * dist, 0, Math.sin(angle) * dist];
        tooth.quaternion = [0, Math.sin(-angle / 2), 0, Math.cos(-angle / 2)];
        root.add(tooth);
    }

    return root;
}

/**
 * Creates a grooved pulley wheel
 */
export function createPulleyMesh(scene, radius = 0.8, halfThickness = 0.12, color = '#4a5568') {
    const root = scene.createNode('pulley');

    // Top and bottom flanges
    const flange1 = scene.createMesh({
        mesh: Mesh.cylinder(radius, halfThickness * 0.25, 20),
        color,
        roughness: 0.4,
        metalness: 0.8,
        y: halfThickness * 0.75
    });
    const flange2 = scene.createMesh({
        mesh: Mesh.cylinder(radius, halfThickness * 0.25, 20),
        color,
        roughness: 0.4,
        metalness: 0.8,
        y: -halfThickness * 0.75
    });
    // Inner groove core
    const core = scene.createMesh({
        mesh: Mesh.cylinder(radius * 0.82, halfThickness * 0.6, 20),
        color: '#1e293b',
        roughness: 0.6,
        metalness: 0.6
    });

    root.add(flange1);
    root.add(flange2);
    root.add(core);

    return root;
}

/**
 * Creates a metallic cylinder sleeve / housing
 */
export function createCylinderSleeveMesh(scene, outerRadius = 0.7, halfHeight = 1.2, color = '#334155') {
    return scene.createMesh({
        mesh: Mesh.cylinder(outerRadius, halfHeight, 20),
        color,
        roughness: 0.45,
        metalness: 0.6
    });
}

/**
 * Creates a polished piston head
 */
export function createPistonHeadMesh(scene, radius = 0.6, halfHeight = 0.4, color = '#cbd5e1') {
    return scene.createMesh({
        mesh: Mesh.cylinder(radius, halfHeight, 20),
        color,
        roughness: 0.2,
        metalness: 0.85
    });
}

/**
 * Creates a connecting rod
 */
export function createConnectingRodMesh(scene, length = 2.4, width = 0.22, color = '#a0aec0') {
    const root = scene.createNode('conrod');
    const shank = scene.createMesh({
        mesh: Mesh.box(width * 0.5, length * 0.5, width * 0.35),
        color,
        roughness: 0.3,
        metalness: 0.8
    });
    const eyeTop = scene.createMesh({
        mesh: Mesh.cylinder(width * 0.8, width * 0.4, 14),
        color: '#718096',
        roughness: 0.3,
        metalness: 0.85,
        y: length * 0.5
    });
    const eyeBottom = scene.createMesh({
        mesh: Mesh.cylinder(width * 0.9, width * 0.4, 14),
        color: '#718096',
        roughness: 0.3,
        metalness: 0.85,
        y: -length * 0.5
    });
    root.add(shank);
    root.add(eyeTop);
    root.add(eyeBottom);
    return root;
}

/**
 * Creates a reflective steel sphere for Newton's Cradle or Pendulum Bob
 */
export function createSteelSphereMesh(scene, radius = 0.5, color = '#e2e8f0') {
    return scene.createMesh({
        mesh: Mesh.sphere(radius, 24, 18),
        color,
        roughness: 0.08,
        metalness: 0.95
    });
}

/**
 * Creates a bridge deck plank with steel curbs
 */
export function createBridgePlankMesh(scene, halfW = 1.2, halfH = 0.12, halfD = 0.4, color = '#8b5a2b') {
    const root = scene.createNode('bridge_plank');

    // Main wooden/composite deck
    const deck = scene.createMesh({
        mesh: Mesh.box(halfW, halfH, halfD),
        color,
        roughness: 0.75,
        metalness: 0.1
    });
    root.add(deck);

    // Left and right steel edge beams
    const beamL = scene.createMesh({
        mesh: Mesh.box(0.08, halfH * 1.6, halfD),
        color: '#334155',
        roughness: 0.35,
        metalness: 0.85,
        position: [-halfW + 0.08, halfH * 0.4, 0]
    });
    const beamR = scene.createMesh({
        mesh: Mesh.box(0.08, halfH * 1.6, halfD),
        color: '#334155',
        roughness: 0.35,
        metalness: 0.85,
        position: [halfW - 0.08, halfH * 0.4, 0]
    });
    root.add(beamL);
    root.add(beamR);

    return root;
}

/**
 * Creates a sturdy pedestal or anchor tower
 */
export function createPedestalMesh(scene, halfW = 1.0, halfH = 0.5, halfD = 1.0, color = '#1e293b') {
    return scene.createMesh({
        mesh: Mesh.box(halfW, halfH, halfD),
        color,
        roughness: 0.85,
        metalness: 0.15
    });
}

/**
 * A dynamic cylinder rod connecting two world points (rope, suspension cable, link)
 */
export function createDynamicRod(scene, color = '#cbd5e1', radius = 0.035, emissive = 0) {
    const mesh = scene.createMesh({
        mesh: Mesh.cylinder(radius, 0.5, 8),
        color,
        roughness: 0.5,
        metalness: 0.5,
        ...(emissive ? { emissive, emissiveColor: color } : {})
    });

    return {
        mesh,
        set(p1, p2) {
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const dz = p2.z - p1.z;
            const len = Math.hypot(dx, dy, dz);

            mesh.position = [(p1.x + p2.x) * 0.5, (p1.y + p2.y) * 0.5, (p1.z + p2.z) * 0.5];
            mesh.quaternion = quatYTo(dx, dy, dz);
            mesh.scale = [1.0, Math.max(1e-3, len), 1.0];
            mesh.visible = true;
        },
        setVisible(on) {
            mesh.visible = on;
        },
        destroy() {
            if (mesh && typeof mesh.destroy === 'function') {
                mesh.destroy();
            }
        }
    };
}
