// parts.js — visuals for the machine parts, as `look.mesh(scene)` builders
// for kit addBody (the mesh sits in the body's local frame; cylinders run
// along local +Y) plus plain static props.

const metal = (color, roughness = 0.35, metallic = 0.75) => ({ color, roughness, metallic });

/** A toothed gear: disc, hub, bore and box teeth round the rim. */
export function gearMesh(radius, halfT, teeth, color) {
    return (scene) => {
        const root = scene.createNode('gear');
        root.add(scene.createMesh({ mesh: 'cylinder', radius, halfHeight: halfT, segments: 24, ...metal(color) }));
        root.add(scene.createMesh({ mesh: 'cylinder', radius: radius * 0.35, halfHeight: halfT * 1.25, segments: 16, ...metal('#2a2e39', 0.4, 0.9) }));
        root.add(scene.createMesh({ mesh: 'cylinder', radius: radius * 0.15, halfHeight: halfT * 1.3, segments: 12, color: '#11141a', roughness: 0.8 }));
        const hw = (Math.PI * radius) / (teeth * 2.2), hd = radius * 0.18, d = radius + hd * 0.7;
        for (let i = 0; i < teeth; i++) {
            const a = (i / teeth) * Math.PI * 2;
            const t = scene.createMesh({ mesh: 'box', halfW: hw, halfH: halfT, halfD: hd, ...metal('#c59b27', 0.4, 0.7) });
            t.x = Math.cos(a) * d; t.z = Math.sin(a) * d;
            t.quaternion = [0, Math.sin(-a / 2), 0, Math.cos(-a / 2)];
            root.add(t);
        }
        return root;
    };
}

/** A grooved pulley wheel / winch drum: two flanges round a dark core. */
export function pulleyMesh(radius, halfT, color) {
    return (scene) => {
        const root = scene.createNode('pulley');
        for (const y of [halfT * 0.75, -halfT * 0.75]) {
            root.add(scene.createMesh({ mesh: 'cylinder', radius, halfHeight: halfT * 0.25, segments: 20, y, ...metal(color, 0.4, 0.8) }));
        }
        root.add(scene.createMesh({ mesh: 'cylinder', radius: radius * 0.82, halfHeight: halfT * 0.6, segments: 20, ...metal('#1e293b', 0.6, 0.6) }));
        // A spoke, so the drum visibly turns.
        root.add(scene.createMesh({ mesh: 'box', halfW: radius * 0.8, halfH: halfT * 0.9, halfD: radius * 0.08, ...metal('#94a3b8') }));
        return root;
    };
}

/**
 * A crank disc (a flywheel along local Y) carrying its crank pin boss at
 * local (0, pinY, -throwR): an AXLE_Z body puts that at world (0, +throwR, pinY)
 * from the centre, so the pin visibly leads the connecting rod round.
 */
export function crankMesh(radius, halfT, throwR, pinY, color) {
    return (scene) => {
        const root = scene.createNode('crank');
        root.add(scene.createMesh({ mesh: 'cylinder', radius, halfHeight: halfT, segments: 28, ...metal(color, 0.3, 0.8) }));
        root.add(scene.createMesh({ mesh: 'cylinder', radius: radius * 0.25, halfHeight: halfT * 1.4, segments: 14, ...metal('#2a2e39', 0.4, 0.9) }));
        root.add(scene.createMesh({ mesh: 'cylinder', radius: 0.16, halfHeight: pinY / 2, segments: 12, y: pinY / 2, z: -throwR, ...metal('#e2e8f0', 0.2, 0.9) }));
        root.add(scene.createMesh({ mesh: 'box', halfW: 0.28, halfH: halfT * 1.2, halfD: throwR * 0.6, z: -throwR * 0.55, ...metal('#8a6d1d', 0.35, 0.8) }));
        return root;
    };
}

/** A connecting rod: shank plus an eye at each end (local Y is its length). */
export function conrodMesh(length, width, color) {
    return (scene) => {
        const root = scene.createNode('conrod');
        root.add(scene.createMesh({ mesh: 'box', halfW: width * 0.5, halfH: length * 0.5, halfD: width * 0.35, ...metal(color, 0.3, 0.8) }));
        for (const [y, r] of [[length * 0.5, 0.8], [-length * 0.5, 0.9]]) {
            const eye = scene.createMesh({ mesh: 'cylinder', radius: width * r, halfHeight: width * 0.4, segments: 14, y, ...metal('#718096', 0.3, 0.85) });
            eye.rx = 90;
            root.add(eye);
        }
        return root;
    };
}

/** A bridge deck plank with steel edge beams (along local Z). */
export function plankMesh(hw, hh, hd, color) {
    return (scene) => {
        const root = scene.createNode('plank');
        root.add(scene.createMesh({ mesh: 'box', halfW: hw, halfH: hh, halfD: hd, color, roughness: 0.75, metallic: 0.1 }));
        for (const x of [-hw + 0.08, hw - 0.08]) {
            root.add(scene.createMesh({ mesh: 'box', halfW: 0.08, halfH: hh * 1.6, halfD: hd, x, y: hh * 0.4, ...metal('#334155', 0.35, 0.85) }));
        }
        return root;
    };
}

/**
 * A polished steel ball (cradle, pendulum bob). Not a full mirror: the stage
 * has no environment map, so metallic 0.95 renders near-black.
 */
export const steel = (color = '#e2e8f0') => ({ color, roughness: 0.22, metallic: 0.7, segments: 24 });

/** A static box prop at a position. */
export function slab(scene, hw, hh, hd, x, y, z, color, extra) {
    return scene.createMesh({ mesh: 'box', halfW: hw, halfH: hh, halfD: hd, x, y, z, color, roughness: 0.8, metallic: 0.2, ...extra });
}
