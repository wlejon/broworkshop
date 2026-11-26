// lib/machine/components.js — Tier-1 Functioning Compiled Components (8) and
// Tier-2 Recursive Composite Subsystems (4). Every entry is a real physical
// blueprint with alloys, joints/couplings, ports, and certified boundaries.

const QID = [0, 0, 0, 1];

export const TIER1_COMPONENTS = {
    gearbox_4to1: {
        id: 'gearbox_4to1',
        name: '4:1 Spur Gearbox',
        tier: 1,
        category: 'drivetrain',
        description: 'Four-to-one helical steel reducer trading RPM for 4x torque with a 65 kN·m tooth-shear limit.',
        ports: [
            { id: 'spin_in', type: 'spin', role: 'input 4x rpm' },
            { id: 'spin_out', type: 'spin', role: 'output 4x torque' },
        ],
        nodes: [
            { id: 'housing', kind: 'beam', pos: [0, 0, 0], half: [0.35, 0.28, 0.35], material: 'steel', role: 'gearbox' },
            { id: 'input_shaft', kind: 'cylinder', parent: 'housing', pos: [0, 0.08, 0.32], radius: 0.14, halfHeight: 0.16, rot: [0.7071, 0, 0, 0.7071], material: 'aluminum', role: 'shaft' },
            { id: 'bull_gear', kind: 'cylinder', parent: 'housing', pos: [0, -0.04, -0.28], radius: 0.28, halfHeight: 0.12, rot: [0.7071, 0, 0, 0.7071], material: 'titanium', role: 'gear' },
        ],
        couplings: [
            { id: 'spur_4_1', kind: 'gear', nodeId: 'bull_gear', ratio: 4.0, nominalTorque: 12000, maxTorque: 65000, efficiency: 0.96 },
        ],
    },

    flywheel_bank: {
        id: 'flywheel_bank',
        name: 'Tungsten Flywheel Bank',
        tier: 1,
        category: 'storage',
        description: 'High-density tungsten kinetic rotor + clutch dump releasing 280 kJ surges on command [R].',
        ports: [
            { id: 'charge_spin', type: 'spin', role: 'spin-up input' },
            { id: 'clutch_trig', type: 'signal', role: 'clutch release [R]' },
            { id: 'surge_out', type: 'spin', role: '2.8x torque surge' },
        ],
        nodes: [
            { id: 'cradle', kind: 'beam', pos: [0, 0, 0], half: [0.42, 0.35, 0.42], material: 'steel', role: 'armor' },
            { id: 'rotor', kind: 'cylinder', parent: 'cradle', pos: [0, 0, 0], radius: 0.36, halfHeight: 0.22, material: 'tungsten', role: 'flywheel', massKg: 420 },
        ],
        couplings: [
            { id: 'kinetic_rotor', kind: 'flywheel', nodeId: 'rotor', maxEnergy: 280000, chargeW: 72000 },
        ],
    },

    recoil_breech: {
        id: 'recoil_breech',
        name: '120mm Recoil Breech',
        tier: 1,
        category: 'ordnance',
        description: 'Heavy cannon barrel & breech riding a prismatic hydraulic recoil damper that cuts chassis shock by 62%.',
        ports: [
            { id: 'fire_sig', type: 'signal', role: 'trigger fire [Space]' },
            { id: 'blast_out', type: 'impulse', role: '105 m/s shell + recoil' },
        ],
        nodes: [
            { id: 'cradle', kind: 'beam', pos: [0, 0, 0], half: [0.34, 0.30, 0.72], material: 'steel', role: 'cradle' },
            {
                id: 'breech_sled', kind: 'beam', parent: 'cradle',
                pos: [0, 0.05, 0.12], half: [0.24, 0.22, 0.58], material: 'titanium', role: 'breech',
                joint: {
                    kind: 'slider', anchor: [0, 0.05, 0.12], axis: [0, 0, 1],
                    lower: -0.08, upper: 0.85, target: 0, hertz: 8.5, damping: 0.95, maxEffort: 1.4e5,
                    breakForce: 9.5e5, role: 'recoil',
                },
            },
            {
                id: 'barrel', kind: 'cylinder', parent: 'breech_sled',
                pos: [0, 0.08, -1.35], radius: 0.14, halfHeight: 1.15, rot: [0.7071, 0, 0, 0.7071],
                material: 'tungsten', role: 'barrel',
                cannon: {
                    caliberMm: 120, muzzleSpeed: 105, massKg: 34, shellRadius: 0.24,
                    recoilNs: 2800, cooldownSec: 1.35, energyJ: 187000,
                    offset: [0, 1.18, 0], dir: [0, 1, 0],
                },
            },
        ],
    },

    hydraulic_hinge: {
        id: 'hydraulic_hinge',
        name: 'Hydraulic Torque Hinge',
        tier: 1,
        category: 'actuator',
        description: 'Clamped implicit servo hinge joint rated to 140 kN·m peak torque without elastic jitter.',
        ports: [
            { id: 'stroke_in', type: 'signal', role: 'target angle [-1.35..1.35]' },
            { id: 'torque_out', type: 'stroke', role: 'clamped hinge motion' },
        ],
        nodes: [
            { id: 'clevis', kind: 'beam', pos: [0, 0, 0], half: [0.24, 0.22, 0.24], material: 'steel', role: 'mount' },
            {
                id: 'arm', kind: 'beam', parent: 'clevis',
                pos: [0, -0.45, 0], half: [0.20, 0.45, 0.22], material: 'titanium', role: 'arm',
                joint: {
                    kind: 'hinge', anchor: [0, 0, 0], axis: [1, 0, 0],
                    lower: -1.35, upper: 1.35, target: 0, hertz: 11, damping: 0.95, maxEffort: 1.4e5,
                    breakForce: 9.0e5, role: 'hinge_servo',
                },
            },
        ],
    },

    outrigger_spade: {
        id: 'outrigger_spade',
        name: 'Hydraulic Outrigger Spade',
        tier: 1,
        category: 'stabilizer',
        description: 'Deployable hydraulic brace leg [R] widening support polygon against massive artillery recoil.',
        ports: [
            { id: 'deploy_sig', type: 'signal', role: 'deploy / stow [R]' },
            { id: 'brace_out', type: 'stroke', role: 'ground anchor reaction' },
        ],
        nodes: [
            { id: 'mount', kind: 'beam', pos: [0, 0, 0], half: [0.28, 0.25, 0.28], material: 'steel', role: 'mount' },
            {
                id: 'strut', kind: 'beam', parent: 'mount',
                pos: [0, -0.55, 0.65], half: [0.16, 0.55, 0.16], material: 'titanium', role: 'spade',
                joint: {
                    kind: 'hinge', anchor: [0, 0, 0.1], axis: [1, 0, 0], mirrorFlip: true,
                    lower: -0.65, upper: 0.45, target: -0.55, hertz: 10, damping: 0.95, maxEffort: 1.8e5,
                    breakForce: 1.1e6, role: 'spade', channel: 'spade',
                },
            },
            { id: 'pad', kind: 'beam', parent: 'strut', pos: [0, -1.05, 0.85], half: [0.35, 0.14, 0.35], material: 'tungsten', role: 'spade', groundContact: true, friction: 1.5 },
        ],
    },

    spring_catapult_arm: {
        id: 'spring_catapult_arm',
        name: 'Ratchet Spring Catapult',
        tier: 1,
        category: 'ordnance',
        description: 'Self-cocking spring-steel torsion arm locked by an analytical ratchet and released by cam trigger [Space].',
        ports: [
            { id: 'wind_spin', type: 'spin', role: 'ratchet charge' },
            { id: 'release_sig', type: 'signal', role: 'fire release [Space]' },
            { id: 'lob_out', type: 'impulse', role: 'heavy siege lob' },
        ],
        nodes: [
            { id: 'pillow_block', kind: 'beam', pos: [0, 0, 0], half: [0.65, 0.35, 0.52], material: 'titanium', role: 'mount' },
            {
                id: 'throw_arm', kind: 'beam', parent: 'pillow_block',
                pos: [0, 0.35, 1.35], half: [0.22, 0.22, 1.45], material: 'spring_steel', role: 'catapult',
                joint: {
                    kind: 'hinge', anchor: [0, 0.25, 0], axis: [1, 0, 0],
                    lower: -0.35, upper: 1.25, target: -0.25, hertz: 7, damping: 0.85, maxEffort: 2.2e5,
                    breakForce: 1.4e6, role: 'catapult_arm', channel: 'catapult_arm',
                },
            },
            {
                id: 'sling_cup', kind: 'beam', parent: 'throw_arm',
                pos: [0, 0.65, 2.55], half: [0.38, 0.22, 0.38], material: 'titanium', role: 'catapult',
                cannon: {
                    caliberMm: 450, muzzleSpeed: 42, massKg: 140, shellRadius: 0.45,
                    recoilNs: 3500, cooldownSec: 2.2, energyJ: 123000, catapultTrigger: true,
                    offset: [0, 0.55, 0], dir: [0, 0.65, -0.76],
                },
            },
        ],
        couplings: [
            { id: 'torsion_coil', kind: 'spring', nodeId: 'throw_arm', maxEnergy: 220000, chargeW: 95000 },
        ],
    },

    suspension_bogie: {
        id: 'suspension_bogie',
        name: 'Twin-Wheel Sprung Bogie',
        tier: 1,
        category: 'locomotion',
        description: 'Titanium rocker pod carrying two high-grip driven wheels with 8.5 Hz Box3D suspension.',
        ports: [
            { id: 'drive_spin', type: 'spin', role: 'differential wheel drive' },
            { id: 'load_out', type: 'stroke', role: 'ground weight support' },
        ],
        nodes: [
            { id: 'carrier', kind: 'beam', pos: [0, 0, 0], half: [0.32, 0.24, 0.95], material: 'titanium', role: 'frame' },
            {
                id: 'wheel_f', kind: 'wheel', parent: 'carrier',
                pos: [0, -0.38, -0.72], radius: 0.58, halfHeight: 0.22, material: 'steel', massKg: 240, role: 'wheel', groundContact: true, friction: 1.4,
                joint: {
                    kind: 'wheel', anchor: [0, -0.38, -0.72], axis: [0, 1, 0], axisB: [1, 0, 0],
                    lower: -0.25, upper: 0.25, hertz: 8.5, damping: 0.95,
                    enableMotor: true, motorSpeed: 0, maxEffort: 7.5e4, breakForce: 1.8e6,
                    role: 'wheel', channel: 'wheel',
                },
            },
            {
                id: 'wheel_r', kind: 'wheel', parent: 'carrier',
                pos: [0, -0.38, 0.72], radius: 0.58, halfHeight: 0.22, material: 'steel', massKg: 240, role: 'wheel', groundContact: true, friction: 1.4,
                joint: {
                    kind: 'wheel', anchor: [0, -0.38, 0.72], axis: [0, 1, 0], axisB: [1, 0, 0],
                    lower: -0.25, upper: 0.25, hertz: 8.5, damping: 0.95,
                    enableMotor: true, motorSpeed: 0, maxEffort: 7.5e4, breakForce: 1.8e6,
                    role: 'wheel', channel: 'wheel',
                },
            },
        ],
    },

    cam_oscillator: {
        id: 'cam_oscillator',
        name: 'Clockwork Cam Sequencer',
        tier: 1,
        category: 'control',
        description: 'Pure mechanical eccentric cam wheel generating synchronized gait & trigger waveforms.',
        ports: [
            { id: 'clock_spin', type: 'spin', role: 'drive clock input' },
            { id: 'phase_sig', type: 'signal', role: 'sin/cos gait timing' },
        ],
        nodes: [
            { id: 'cam_box', kind: 'beam', pos: [0, 0, 0], half: [0.32, 0.24, 0.32], material: 'aluminum', role: 'cam' },
            { id: 'lobe', kind: 'cylinder', parent: 'cam_box', pos: [0, 0.05, 0], radius: 0.26, halfHeight: 0.14, material: 'spring_steel', role: 'cam' },
        ],
        couplings: [
            { id: 'gait_cam', kind: 'cam', nodeId: 'lobe', freqHz: 1.35, phaseOffset: 0 },
        ],
    },
};

export const TIER2_SUBSYSTEMS = {
    mech_leg_unit: {
        id: 'mech_leg_unit',
        name: 'Articulated Mech Leg',
        tier: 2,
        category: 'locomotion',
        description: '2-DOF thigh + knee strider leg built from hydraulic hinge actuators, titanium struts, and wide foot pad.',
        ports: [
            { id: 'hip_sig', type: 'signal', role: 'gait swing angle' },
            { id: 'knee_sig', type: 'signal', role: 'knee lift angle' },
            { id: 'step_out', type: 'stroke', role: 'ground stride load' },
        ],
        nodes: [
            { id: 'hip_block', kind: 'beam', pos: [0, 0, 0], half: [0.26, 0.24, 0.26], material: 'steel', role: 'leg' },
            {
                id: 'thigh', kind: 'beam', parent: 'hip_block',
                pos: [0, -0.68, 0], half: [0.22, 0.65, 0.24], material: 'titanium', role: 'leg',
                joint: {
                    kind: 'hinge', anchor: [0, -0.05, 0], axis: [1, 0, 0],
                    lower: -0.85, upper: 0.85, target: 0.12, hertz: 12, damping: 0.95, maxEffort: 2.4e5,
                    breakForce: 1.4e6, role: 'hip', channel: 'gait_hip_L',
                },
            },
            {
                id: 'shin', kind: 'beam', parent: 'thigh',
                pos: [0, -1.85, 0.12], half: [0.19, 0.65, 0.21], material: 'titanium', role: 'leg',
                joint: {
                    kind: 'hinge', anchor: [0, -1.25, 0], axis: [1, 0, 0],
                    lower: -1.15, upper: 0.35, target: -0.25, hertz: 12, damping: 0.95, maxEffort: 2.2e5,
                    breakForce: 1.3e6, role: 'knee', channel: 'gait_knee_L',
                },
            },
            { id: 'foot', kind: 'beam', parent: 'shin', pos: [0, -2.52, 0.02], half: [0.46, 0.16, 0.68], material: 'tungsten', role: 'foot', groundContact: true, friction: 1.5 },
        ],
    },

    turret_howitzer_unit: {
        id: 'turret_howitzer_unit',
        name: 'Stabilized Turret + Recoil Gun',
        tier: 2,
        category: 'ordnance',
        description: 'Powered azimuth ring + elevation trunnion recursively embedding the 120mm Recoil Breech unit.',
        ports: [
            { id: 'yaw_sig', type: 'signal', role: 'azimuth target [Q/E]' },
            { id: 'pitch_sig', type: 'signal', role: 'elevation target [Z/C]' },
            { id: 'fire_sig', type: 'signal', role: 'fire shell [Space]' },
            { id: 'blast_out', type: 'impulse', role: 'ballistic fire' },
        ],
        nodes: [
            { id: 'turret_ring', kind: 'beam', pos: [0, 0, 0], half: [0.75, 0.18, 0.75], material: 'steel', role: 'turret' },
            {
                id: 'turret_head', kind: 'beam', parent: 'turret_ring',
                pos: [0, 0.48, 0], half: [0.85, 0.42, 0.95], material: 'titanium', role: 'turret',
                joint: {
                    kind: 'hinge', anchor: [0, 0.18, 0], axis: [0, 1, 0],
                    lower: -3.05, upper: 3.05, target: 0, hertz: 10, damping: 0.95, maxEffort: 2.0e5,
                    breakForce: 1.5e6, role: 'turret_yaw', channel: 'turret_yaw',
                },
            },
            {
                id: 'trunnion', kind: 'beam', parent: 'turret_head',
                pos: [0, 0.72, -0.35], half: [0.44, 0.34, 0.45], material: 'steel', role: 'turret',
                joint: {
                    kind: 'hinge', anchor: [0, 0.72, -0.15], axis: [1, 0, 0],
                    lower: -0.15, upper: 0.88, target: 0.22, hertz: 12, damping: 0.95, maxEffort: 1.6e5,
                    breakForce: 1.2e6, role: 'turret_pitch', channel: 'turret_pitch',
                },
            },
        ],
        units: [
            { id: 'gun', unitId: 'recoil_breech', parent: 'trunnion', mountPos: [0, 0.72, -0.45], scale: 1 },
        ],
    },

    pile_bunker_arm: {
        id: 'pile_bunker_arm',
        name: 'Flywheel Pile-Bunker Ram',
        tier: 2,
        category: 'melee',
        description: 'Spur gearbox + tungsten flywheel bank driving a high-impulse prismatic tungsten spike [Space / R].',
        ports: [
            { id: 'surge_sig', type: 'signal', role: 'ram punch [Space]' },
            { id: 'ram_out', type: 'impulse', role: 'high-mass kinetic strike' },
        ],
        nodes: [
            { id: 'arm_chassis', kind: 'beam', pos: [0, 0, 0], half: [0.55, 0.45, 1.05], material: 'steel', role: 'armor' },
            {
                id: 'ram_spike', kind: 'beam', parent: 'arm_chassis',
                pos: [0, 0, -1.35], half: [0.24, 0.24, 1.15], material: 'tungsten', role: 'plow',
                joint: {
                    kind: 'slider', anchor: [0, 0, -1.0], axis: [0, 0, -1],
                    lower: 0.0, upper: 1.45, target: 0.0, hertz: 16, damping: 0.65, maxEffort: 4.5e5,
                    breakForce: 2.2e6, role: 'pile_bunker', channel: 'pile_bunker',
                },
            },
        ],
        units: [
            { id: 'gb', unitId: 'gearbox_4to1', parent: 'arm_chassis', mountPos: [0, 0.45, 0.35], scale: 0.9 },
            { id: 'fw', unitId: 'flywheel_bank', parent: 'arm_chassis', mountPos: [0, 0.55, -0.30], scale: 0.9 },
        ],
    },

    trebuchet_launcher: {
        id: 'trebuchet_launcher',
        name: 'Clockwork Siege Lobber',
        tier: 2,
        category: 'ordnance',
        description: 'Gantry frame holding counterweight ballast and the Ratchet Spring Catapult sub-unit.',
        ports: [
            { id: 'fire_sig', type: 'signal', role: 'release siege shot [Space]' },
            { id: 'lob_out', type: 'impulse', role: '140 kg ballistic lob' },
        ],
        nodes: [
            { id: 'gantry_l', kind: 'beam', pos: [-0.95, 0.65, 0], half: [0.18, 0.95, 0.55], material: 'steel', role: 'frame' },
            { id: 'gantry_r', kind: 'beam', parent: 'gantry_l', pos: [0.95, 0.65, 0], half: [0.18, 0.95, 0.55], material: 'steel', role: 'frame' },
            { id: 'crossbar', kind: 'beam', parent: 'gantry_l', pos: [0, 1.45, 0], half: [1.15, 0.18, 0.28], material: 'titanium', role: 'frame' },
        ],
        units: [
            { id: 'catapult', unitId: 'spring_catapult_arm', parent: 'crossbar', mountPos: [0, 1.65, 0], scale: 1 },
            { id: 'winder', unitId: 'gearbox_4to1', parent: 'gantry_l', mountPos: [-0.75, 0.25, 0.55], scale: 0.8 },
        ],
    },
};
