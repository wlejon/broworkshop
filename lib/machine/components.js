// lib/machine/components.js — Tier-1 Functioning Compiled Components (8) and
// Tier-2 Recursive Composite Subsystems (4). All parts use flush mounts,
// forward -Z alignment (barrel rot [-0.7071, 0, 0, 0.7071]), and realistic
// break thresholds so normal operation never self-fractures.

export const TIER1_COMPONENTS = {
    gearbox_4to1: {
        id: 'gearbox_4to1',
        name: '4:1 Spur Gearbox',
        tier: 1,
        category: 'drivetrain',
        description: 'Open-housing 4:1 spur reducer meshing a bronze pinion and titanium bull gear (65 kN·m tooth-shear rating).',
        ports: [
            { id: 'spin_in', type: 'spin', role: 'input 4x rpm' },
            { id: 'spin_out', type: 'spin', role: 'output 4x torque' },
        ],
        nodes: [
            { id: 'housing', kind: 'beam', meshKind: 'truss', pos: [0, 0, 0], half: [0.44, 0.16, 0.56], material: 'steel', role: 'gearbox' },
            { id: 'pinion', kind: 'cylinder', meshKind: 'gear', parent: 'housing', pos: [0, 0.24, 0.34], radius: 0.18, halfHeight: 0.10, material: 'spring_steel', role: 'gear' },
            { id: 'bull_gear', kind: 'cylinder', meshKind: 'gear', parent: 'housing', pos: [0, 0.24, -0.24], radius: 0.38, halfHeight: 0.11, material: 'titanium', role: 'gear' },
        ],
        couplings: [
            { id: 'spur_pinion', kind: 'gear', nodeId: 'pinion', ratio: 4.0, nominalTorque: 12000, maxTorque: 65000, efficiency: 0.96 },
            { id: 'spur_bull', kind: 'gear', nodeId: 'bull_gear', ratio: -1.0, nominalTorque: 48000, maxTorque: 140000, efficiency: 0.96 },
        ],
    },

    flywheel_bank: {
        id: 'flywheel_bank',
        name: 'Tungsten Flywheel Bank',
        tier: 1,
        category: 'storage',
        description: 'Armored cradle spinning a high-density tungsten kinetic rotor + clutch dump [R] releasing 280 kJ surges.',
        ports: [
            { id: 'charge_spin', type: 'spin', role: 'spin-up input' },
            { id: 'clutch_trig', type: 'signal', role: 'clutch release [R]' },
            { id: 'surge_out', type: 'spin', role: '2.8x torque surge' },
        ],
        nodes: [
            { id: 'cradle', kind: 'beam', meshKind: 'truss', pos: [0, 0, 0], half: [0.46, 0.18, 0.46], material: 'steel', role: 'armor' },
            { id: 'rotor', kind: 'cylinder', meshKind: 'flywheel', parent: 'cradle', pos: [0, 0.26, 0], radius: 0.42, halfHeight: 0.14, material: 'tungsten', role: 'flywheel', massKg: 360 },
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
        description: 'Forward-facing 120mm cannon & muzzle brake riding twin hydraulic recoil cylinders along a prismatic slide.',
        ports: [
            { id: 'fire_sig', type: 'signal', role: 'trigger fire [Space]' },
            { id: 'blast_out', type: 'impulse', role: '105 m/s shell + recoil' },
        ],
        nodes: [
            { id: 'cradle', kind: 'beam', meshKind: 'hull', pos: [0, 0, 0], half: [0.34, 0.24, 0.68], material: 'steel', role: 'cradle' },
            { id: 'damper_l', kind: 'cylinder', meshKind: 'piston', parent: 'cradle', pos: [-0.26, 0.12, -0.35], radius: 0.08, halfHeight: 0.48, rot: [-0.7071068, 0, 0, 0.7071068], material: 'spring_steel', role: 'piston' },
            { id: 'damper_r', kind: 'cylinder', meshKind: 'piston', parent: 'cradle', pos: [0.26, 0.12, -0.35], radius: 0.08, halfHeight: 0.48, rot: [-0.7071068, 0, 0, 0.7071068], material: 'spring_steel', role: 'piston' },
            {
                id: 'breech_sled', kind: 'beam', meshKind: 'hull', parent: 'cradle',
                pos: [0, 0.10, 0.08], half: [0.22, 0.20, 0.56], material: 'titanium', role: 'breech',
                joint: {
                    kind: 'slider', anchor: [0, 0.10, 0.08], axis: [0, 0, 1],
                    lower: -0.05, upper: 0.70, target: 0, hertz: 2.8, damping: 0.72, maxEffort: 1.8e5,
                    breakForce: 4.5e6, role: 'recoil',
                },
            },
            {
                id: 'barrel', kind: 'cylinder', meshKind: 'barrel', parent: 'breech_sled',
                // -90 deg X aligns cylinder +Y axis onto world -Z (FORWARD).
                pos: [0, 0.12, -1.35], radius: 0.13, halfHeight: 1.15, rot: [-0.7071068, 0, 0, 0.7071068],
                material: 'tungsten', role: 'barrel',
                cannon: {
                    caliberMm: 120, muzzleSpeed: 105, massKg: 140, shellRadius: 0.24,
                    recoilNs: 5400, cooldownSec: 1.35, energyJ: 770000,
                    offset: [0, 1.25, 0], dir: [0, 1, 0],
                },
            },
        ],
    },

    hydraulic_hinge: {
        id: 'hydraulic_hinge',
        name: 'Hydraulic Torque Hinge',
        tier: 1,
        category: 'actuator',
        description: 'Machined clevis joint + hydraulic actuator cylinder rated to 160 kN·m clamped implicit servo torque.',
        ports: [
            { id: 'stroke_in', type: 'signal', role: 'target angle [-1.35..1.35]' },
            { id: 'torque_out', type: 'stroke', role: 'clamped hinge motion' },
        ],
        nodes: [
            { id: 'clevis', kind: 'beam', meshKind: 'hull', pos: [0, 0, 0], half: [0.26, 0.22, 0.26], material: 'steel', role: 'mount' },
            { id: 'actuator', kind: 'cylinder', meshKind: 'piston', parent: 'clevis', pos: [0, -0.18, 0.22], radius: 0.08, halfHeight: 0.28, material: 'spring_steel', role: 'piston' },
            {
                id: 'arm', kind: 'beam', meshKind: 'truss', parent: 'clevis',
                pos: [0, -0.52, 0], half: [0.20, 0.48, 0.20], material: 'titanium', role: 'arm',
                joint: {
                    kind: 'hinge', anchor: [0, -0.04, 0], axis: [1, 0, 0],
                    lower: -1.35, upper: 1.35, target: 0, hertz: 12, damping: 0.95, maxEffort: 1.6e5,
                    breakForce: 3.5e6, role: 'hinge_servo',
                },
            },
        ],
    },

    outrigger_spade: {
        id: 'outrigger_spade',
        name: 'Hydraulic Outrigger Spade',
        tier: 1,
        category: 'stabilizer',
        description: 'Flush transom hydraulic stabilizer leg [R] widening support polygon cleanly onto the ground.',
        ports: [
            { id: 'deploy_sig', type: 'signal', role: 'deploy / stow [R]' },
            { id: 'brace_out', type: 'stroke', role: 'ground anchor reaction' },
        ],
        nodes: [
            { id: 'mount', kind: 'beam', meshKind: 'hull', pos: [0, 0, 0], half: [0.26, 0.22, 0.26], material: 'steel', role: 'mount' },
            {
                id: 'strut', kind: 'beam', meshKind: 'truss', parent: 'mount',
                pos: [0, -0.45, 0.45], half: [0.16, 0.52, 0.16], rot: [0.34, 0, 0, 0.94], material: 'titanium', role: 'spade',
                joint: {
                    kind: 'hinge', anchor: [0, -0.05, 0.18], axis: [1, 0, 0],
                    lower: -0.55, upper: 0.35, target: -0.42, hertz: 10, damping: 0.95, maxEffort: 2.0e5,
                    breakForce: 4.0e6, role: 'spade', channel: 'spade',
                },
            },
            { id: 'pad', kind: 'beam', meshKind: 'hull', parent: 'strut', pos: [0, -0.92, 0.78], half: [0.40, 0.13, 0.40], material: 'tungsten', role: 'spade', groundContact: true, friction: 1.5 },
        ],
    },

    spring_catapult_arm: {
        id: 'spring_catapult_arm',
        name: 'Ratchet Spring Catapult',
        tier: 1,
        category: 'ordnance',
        description: 'Self-cocking brass torsion spring arm locked by an analytical ratchet releasing heavy boulders forward [Space].',
        ports: [
            { id: 'wind_spin', type: 'spin', role: 'ratchet charge' },
            { id: 'release_sig', type: 'signal', role: 'fire release [Space]' },
            { id: 'lob_out', type: 'impulse', role: 'heavy forward siege lob' },
        ],
        nodes: [
            { id: 'pillow_block', kind: 'beam', meshKind: 'hull', pos: [0, 0, 0], half: [0.68, 0.30, 0.48], material: 'titanium', role: 'mount' },
            { id: 'coil', kind: 'cylinder', meshKind: 'spring', parent: 'pillow_block', pos: [0, 0.22, 0], radius: 0.26, halfHeight: 0.52, rot: [0, 0, 0.7071068, 0.7071068], material: 'spring_steel', role: 'spring' },
            {
                id: 'throw_arm', kind: 'beam', meshKind: 'truss', parent: 'pillow_block',
                pos: [0, 0.32, 1.15], half: [0.18, 0.16, 1.35], material: 'spring_steel', role: 'catapult',
                joint: {
                    // Around +X axis: upper (+0.22) is cocked down; negative angle (-1.15) whips UP & FORWARD toward -Z!
                    kind: 'hinge', anchor: [0, 0.22, 0], axis: [1, 0, 0],
                    lower: -1.15, upper: 0.22, target: 0.14, hertz: 10, damping: 0.75, maxEffort: 2.6e5,
                    breakForce: 4.5e6, role: 'catapult_arm', channel: 'catapult_arm',
                },
            },
            {
                id: 'sling_cup', kind: 'beam', meshKind: 'hull', parent: 'throw_arm',
                pos: [0, 0.56, 2.35], half: [0.36, 0.20, 0.36], material: 'tungsten', role: 'catapult',
                cannon: {
                    caliberMm: 420, muzzleSpeed: 31, massKg: 260, shellRadius: 0.44,
                    recoilNs: 4200, cooldownSec: 2.0, energyJ: 125000, catapultTrigger: true,
                    offset: [0, 0.75, -0.35], dir: [0, 0.46, -0.89],
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
        description: 'Titanium rocker pod with twin lugged armored wheels on 9 Hz Box3D suspension and high-torque drives.',
        ports: [
            { id: 'drive_spin', type: 'spin', role: 'differential wheel drive' },
            { id: 'load_out', type: 'stroke', role: 'ground weight support' },
        ],
        nodes: [
            { id: 'carrier', kind: 'beam', meshKind: 'sponson', pos: [0, 0, 0], half: [0.30, 0.22, 0.98], material: 'titanium', role: 'frame' },
            {
                id: 'wheel_f', kind: 'wheel', meshKind: 'wheel', parent: 'carrier',
                pos: [0, -0.34, -0.74], radius: 0.58, halfHeight: 0.24, material: 'steel', massKg: 220, role: 'wheel', groundContact: true, friction: 1.5,
                joint: {
                    kind: 'wheel', anchor: [0, -0.34, -0.74], axis: [0, 1, 0], axisB: [1, 0, 0],
                    lower: -0.22, upper: 0.22, hertz: 9.0, damping: 0.95,
                    enableMotor: true, motorSpeed: 0, maxEffort: 5.0e4, breakForce: 3.5e6,
                    role: 'wheel', channel: 'wheel',
                },
            },
            {
                id: 'wheel_r', kind: 'wheel', meshKind: 'wheel', parent: 'carrier',
                pos: [0, -0.34, 0.74], radius: 0.58, halfHeight: 0.24, material: 'steel', massKg: 220, role: 'wheel', groundContact: true, friction: 1.5,
                joint: {
                    kind: 'wheel', anchor: [0, -0.34, 0.74], axis: [0, 1, 0], axisB: [1, 0, 0],
                    lower: -0.22, upper: 0.22, hertz: 9.0, damping: 0.95,
                    enableMotor: true, motorSpeed: 0, maxEffort: 5.0e4, breakForce: 3.5e6,
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
        description: 'Open clockwork cam wheel + follower piston generating continuous sinusoidal gait and timing signals.',
        ports: [
            { id: 'clock_spin', type: 'spin', role: 'drive clock input' },
            { id: 'phase_sig', type: 'signal', role: 'sin/cos gait timing' },
        ],
        nodes: [
            { id: 'cam_box', kind: 'beam', meshKind: 'truss', pos: [0, 0, 0], half: [0.34, 0.16, 0.34], material: 'aluminum', role: 'cam' },
            { id: 'lobe', kind: 'cylinder', meshKind: 'cam', parent: 'cam_box', pos: [0, 0.22, 0], radius: 0.28, halfHeight: 0.11, material: 'spring_steel', role: 'cam' },
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
        description: '2-DOF hip + knee strider leg built from armored truss links, hydraulic actuators, and wide tungsten foot pad.',
        ports: [
            { id: 'hip_sig', type: 'signal', role: 'gait swing angle' },
            { id: 'knee_sig', type: 'signal', role: 'knee lift angle' },
            { id: 'step_out', type: 'stroke', role: 'ground stride load' },
        ],
        nodes: [
            { id: 'hip_block', kind: 'beam', meshKind: 'hull', pos: [0, 0, 0], half: [0.28, 0.24, 0.28], material: 'steel', role: 'leg' },
            {
                id: 'thigh', kind: 'beam', meshKind: 'leg', parent: 'hip_block',
                pos: [0, -0.64, 0], half: [0.22, 0.62, 0.24], material: 'titanium', role: 'leg',
                joint: {
                    kind: 'hinge', anchor: [0, -0.04, 0], axis: [1, 0, 0],
                    lower: -0.85, upper: 0.85, target: 0.0, hertz: 12, damping: 0.95, maxEffort: 2.6e5,
                    breakForce: 4.5e6, role: 'hip', channel: 'gait_hip_A',
                },
            },
            {
                id: 'shin', kind: 'beam', meshKind: 'leg', parent: 'thigh',
                pos: [0, -1.78, 0.04], half: [0.19, 0.62, 0.21], material: 'titanium', role: 'leg',
                joint: {
                    kind: 'hinge', anchor: [0, -1.20, 0], axis: [1, 0, 0],
                    lower: -0.95, upper: 0.45, target: -0.04, hertz: 12, damping: 0.95, maxEffort: 2.4e5,
                    breakForce: 4.5e6, role: 'knee', channel: 'gait_knee_A',
                },
            },
            { id: 'foot', kind: 'beam', meshKind: 'foot', parent: 'shin', pos: [0, -2.42, 0.0], half: [0.52, 0.14, 0.78], material: 'tungsten', role: 'foot', groundContact: true, friction: 0.90 },
        ],
    },

    turret_howitzer_unit: {
        id: 'turret_howitzer_unit',
        name: 'Stabilized Turret + Recoil Gun',
        tier: 2,
        category: 'ordnance',
        description: 'Armored azimuth turret ring + elevated trunnion recursively embedding the forward 120mm Recoil Breech.',
        ports: [
            { id: 'yaw_sig', type: 'signal', role: 'azimuth target [Q/E]' },
            { id: 'pitch_sig', type: 'signal', role: 'elevation target [Z/C]' },
            { id: 'fire_sig', type: 'signal', role: 'fire shell [Space]' },
            { id: 'blast_out', type: 'impulse', role: 'ballistic fire' },
        ],
        nodes: [
            { id: 'turret_ring', kind: 'cylinder', meshKind: 'gear', pos: [0, 0, 0], radius: 0.82, halfHeight: 0.14, material: 'steel', role: 'turret' },
            {
                id: 'turret_head', kind: 'beam', meshKind: 'turret', parent: 'turret_ring',
                pos: [0, 0.44, 0], half: [0.84, 0.34, 0.95], material: 'titanium', role: 'turret',
                joint: {
                    kind: 'hinge', anchor: [0, 0.14, 0], axis: [0, 1, 0],
                    lower: -3.05, upper: 3.05, target: 0, hertz: 11, damping: 0.95, maxEffort: 2.4e5,
                    breakForce: 4.5e6, role: 'turret_yaw', channel: 'turret_yaw',
                },
            },
            {
                id: 'trunnion', kind: 'beam', meshKind: 'hull', parent: 'turret_head',
                pos: [0, 0.86, -0.25], half: [0.44, 0.24, 0.44], material: 'steel', role: 'turret',
                joint: {
                    kind: 'hinge', anchor: [0, 0.86, -0.15], axis: [1, 0, 0],
                    lower: -0.12, upper: 0.85, target: 0.18, hertz: 12, damping: 0.95, maxEffort: 2.0e5,
                    breakForce: 4.5e6, role: 'turret_pitch', channel: 'turret_pitch',
                },
            },
        ],
        units: [
            { id: 'gun', unitId: 'recoil_breech', parent: 'trunnion', mountPos: [0, 0.94, -0.58], scale: 1 },
        ],
    },

    pile_bunker_arm: {
        id: 'pile_bunker_arm',
        name: 'Flywheel Pile-Bunker Ram',
        tier: 2,
        category: 'melee',
        description: 'Spur gearbox + tungsten flywheel bank driving a gleaming hydraulic tungsten ramming spike forward [Space].',
        ports: [
            { id: 'surge_sig', type: 'signal', role: 'ram punch [Space]' },
            { id: 'ram_out', type: 'impulse', role: 'high-mass kinetic strike' },
        ],
        nodes: [
            { id: 'arm_chassis', kind: 'beam', meshKind: 'hull', pos: [0, 0, 0], half: [0.58, 0.38, 1.05], material: 'steel', role: 'armor' },
            {
                id: 'ram_spike', kind: 'beam', meshKind: 'plow', parent: 'arm_chassis',
                pos: [0, 0.05, -1.35], half: [0.28, 0.24, 1.15], material: 'tungsten', role: 'plow',
                joint: {
                    kind: 'slider', anchor: [0, 0.05, -1.0], axis: [0, 0, -1],
                    lower: 0.0, upper: 1.45, target: 0.0, hertz: 16, damping: 0.70, maxEffort: 4.5e5,
                    breakForce: 4.5e6, role: 'pile_bunker', channel: 'pile_bunker',
                },
            },
        ],
        units: [
            { id: 'gb', unitId: 'gearbox_4to1', parent: 'arm_chassis', mountPos: [0, 0.42, 0.38], scale: 0.85 },
            { id: 'fw', unitId: 'flywheel_bank', parent: 'arm_chassis', mountPos: [0, 0.42, -0.36], scale: 0.85 },
        ],
    },

    trebuchet_launcher: {
        id: 'trebuchet_launcher',
        name: 'Clockwork Siege Lobber',
        tier: 2,
        category: 'ordnance',
        description: 'Braced A-frame gantry pairing a 4:1 spur winder with the Ratchet Spring Catapult arm.',
        ports: [
            { id: 'fire_sig', type: 'signal', role: 'release siege shot [Space]' },
            { id: 'lob_out', type: 'impulse', role: '140 kg ballistic lob' },
        ],
        nodes: [
            { id: 'gantry_l', kind: 'beam', meshKind: 'truss', pos: [-0.92, 0.65, 0], half: [0.18, 0.85, 0.52], material: 'steel', role: 'frame' },
            { id: 'gantry_r', kind: 'beam', meshKind: 'truss', parent: 'gantry_l', pos: [0.92, 0.65, 0], half: [0.18, 0.85, 0.52], material: 'steel', role: 'frame' },
            { id: 'crossbar', kind: 'beam', meshKind: 'truss', parent: 'gantry_l', pos: [0, 1.42, 0], half: [1.12, 0.18, 0.30], material: 'titanium', role: 'frame' },
        ],
        units: [
            { id: 'catapult', unitId: 'spring_catapult_arm', parent: 'crossbar', mountPos: [0, 1.72, 0], scale: 1 },
            { id: 'winder', unitId: 'gearbox_4to1', parent: 'gantry_l', mountPos: [-0.45, 0.18, 0.65], scale: 0.78 },
        ],
    },
};
