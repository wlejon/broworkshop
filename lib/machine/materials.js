// lib/machine/materials.js — Physical alloys, ports, and primitive definitions
// for recursive mechanical compilation.

export const MATERIALS = {
    aluminum: {
        name: 'Aluminum 7075',
        density: 2810,      // kg/m^3
        yieldMPa: 500,
        shearMPa: 330,
        stiffness: 0.72,
        costPerKg: 6,
        friction: 0.55,
        restitution: 0.08,
        color: '#c4d0dc',
        metallic: 0.82,
        roughness: 0.28,
    },
    steel: {
        name: 'Rolled Steel',
        density: 7850,
        yieldMPa: 620,
        shearMPa: 410,
        stiffness: 0.90,
        costPerKg: 3,
        friction: 0.65,
        restitution: 0.04,
        color: '#737e8c',
        metallic: 0.84,
        roughness: 0.38,
    },
    titanium: {
        name: 'Titanium Ti-6Al-4V',
        density: 4430,
        yieldMPa: 1100,
        shearMPa: 740,
        stiffness: 1.0,
        costPerKg: 18,
        friction: 0.60,
        restitution: 0.06,
        color: '#9aa4b6',
        metallic: 0.88,
        roughness: 0.26,
    },
    tungsten: {
        name: 'Tungsten Heavy Alloy',
        density: 18500,
        yieldMPa: 1350,
        shearMPa: 860,
        stiffness: 1.0,
        costPerKg: 42,
        friction: 0.75,
        restitution: 0.02,
        color: '#3f4552',
        metallic: 0.90,
        roughness: 0.32,
    },
    spring_steel: {
        name: 'Tempered Spring Steel',
        density: 7850,
        yieldMPa: 1450,
        shearMPa: 950,
        stiffness: 1.0,
        costPerKg: 9,
        friction: 0.60,
        restitution: 0.12,
        color: '#d49a42',
        metallic: 0.90,
        roughness: 0.24,
    },
};

export const PORT_TYPES = {
    SPIN: 'spin',       // { rpm, torque, maxTorque }
    STROKE: 'stroke',   // { pos, force, maxForce, min, max }
    IMPULSE: 'impulse', // { energyJ, momentumNs, cooldown }
    SIGNAL: 'signal',   // { value (-1..1), trigger (bool) }
};

export const PRIMITIVES = {
    beam: {
        label: 'Structural Beam / Plate',
        defaultMaterial: 'steel',
        description: 'Rigid alloy structural member or armor plate; compiles into compound hull clusters.',
    },
    bearing: {
        label: 'Bearing (Revolute)',
        defaultMaterial: 'steel',
        description: '1-DOF rotary joint with optional limits, clamped servo, and radial/torque ratings.',
    },
    slide: {
        label: 'Slide / Piston (Prismatic)',
        defaultMaterial: 'titanium',
        description: '1-DOF linear hydraulic rail with stroke limits and clamped force servo.',
    },
    gear: {
        label: 'Gear / Ratchet / Clutch',
        defaultMaterial: 'steel',
        description: 'Analytical torque & speed coupling between ports with deterministic tooth-shear limit.',
    },
    spring: {
        label: 'Spring / Flywheel',
        defaultMaterial: 'spring_steel',
        description: 'Mechanical energy storage: coil/torsion spring or kinetic flywheel.',
    },
    drive: {
        label: 'Prime Core / Breech',
        defaultMaterial: 'tungsten',
        description: 'Continuous torque/force prime mover or ballistic impulse breech.',
    },
    cam: {
        label: 'Cam / Limit Trigger',
        defaultMaterial: 'aluminum',
        description: 'Clockwork phase oscillator or angle/stroke limit switch.',
    },
    unit: {
        label: 'Compiled Unit',
        defaultMaterial: 'steel',
        description: 'Recursively embeds any compiled component or subsystem via its ports and ratings.',
    },
};

export function materialOf(id) {
    return MATERIALS[id] || MATERIALS.steel;
}

export function boxMassKg(half, materialId, scaleMass = 1) {
    const m = materialOf(materialId);
    const vol = 8 * half[0] * half[1] * half[2];
    return Math.max(0.5, vol * m.density * scaleMass * 0.18); // hollow-frame structural fill factor 0.18
}

export function cylMassKg(radius, halfHeight, materialId, fillFactor = 0.45) {
    const m = materialOf(materialId);
    const vol = Math.PI * radius * radius * (2 * halfHeight);
    return Math.max(0.5, vol * m.density * fillFactor);
}

/** Shear / yield force capacity of a pin or member cross section (Newtons). */
export function partForceCapacity(half, materialId) {
    const m = materialOf(materialId);
    const area = 4 * Math.min(half[0] * half[1], half[1] * half[2], half[0] * half[2]);
    // Design structural load scale calibrated to game-scale multi-ton mechs (kN..MN).
    return Math.max(5000, area * m.yieldMPa * 4200);
}
