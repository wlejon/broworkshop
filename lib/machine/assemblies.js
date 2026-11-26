// lib/machine/assemblies.js — Tier-3 Battle-Ready Machine Assemblies (6) built
// recursively from Tier-1 Components and Tier-2 Subsystems, plus the unified
// catalog and custom-unit resolver.

import { TIER1_COMPONENTS, TIER2_SUBSYSTEMS } from "./components.js";

export const TIER3_ASSEMBLIES = {
    iron_strider: {
        id: 'iron_strider',
        name: 'Iron Strider MK-IV',
        tier: 3,
        category: 'mech',
        description: 'Quad-leg walking artillery mech built from 4 articulated mech legs, a clockwork gait cam, and a stabilized 120mm recoil turret.',
        ports: [
            { id: 'walk_sig', type: 'signal', role: 'W/S/A/D gait locomotion' },
            { id: 'aim_sig', type: 'signal', role: 'Q/E yaw, Z/C pitch' },
            { id: 'fire_sig', type: 'signal', role: 'fire main howitzer [Space]' },
        ],
        nodes: [
            { id: 'hull', kind: 'beam', pos: [0, 3.05, 0], half: [1.35, 0.42, 1.85], material: 'titanium', role: 'chassis' },
            { id: 'prow_armor', kind: 'beam', parent: 'hull', pos: [0, 3.15, -2.0], half: [1.15, 0.35, 0.25], material: 'tungsten', role: 'armor' },
            { id: 'spine_brace', kind: 'beam', parent: 'hull', pos: [0, 3.55, 0.65], half: [0.95, 0.22, 0.95], material: 'steel', role: 'frame' },
        ],
        units: [
            { id: 'cam', unitId: 'cam_oscillator', parent: 'hull', mountPos: [0, 3.15, 0.2] },
            { id: 'turret', unitId: 'turret_howitzer_unit', parent: 'hull', mountPos: [0, 3.65, -0.35] },
            { id: 'leg_fl', unitId: 'mech_leg_unit', parent: 'hull', mountPos: [-1.55, 2.85, -1.25], channelPrefix: '', material: 'titanium' },
            { id: 'leg_fr', unitId: 'mech_leg_unit', parent: 'hull', mountPos: [1.55, 2.85, -1.25], mirrorX: true, channelPrefix: '' },
            { id: 'leg_rl', unitId: 'mech_leg_unit', parent: 'hull', mountPos: [-1.55, 2.85, 1.25], mirrorX: true },
            { id: 'leg_rr', unitId: 'mech_leg_unit', parent: 'hull', mountPos: [1.55, 2.85, 1.25] },
        ],
    },

    siege_howitzer: {
        id: 'siege_howitzer',
        name: 'Bastion Siege Howitzer',
        tier: 3,
        category: 'artillery',
        description: 'Heavy mobile artillery crawler pairing 4 sprung wheel bogies, deployable hydraulic spades [R], and a scaled 120mm recoil turret.',
        ports: [
            { id: 'drive_sig', type: 'signal', role: 'W/S/A/D crawler drive' },
            { id: 'spade_sig', type: 'signal', role: 'deploy/stow outriggers [R]' },
            { id: 'fire_sig', type: 'signal', role: 'heavy artillery shot [Space]' },
        ],
        nodes: [
            { id: 'hull', kind: 'beam', pos: [0, 1.45, 0], half: [1.45, 0.45, 2.55], material: 'steel', role: 'chassis' },
            { id: 'bunker_nose', kind: 'beam', parent: 'hull', pos: [0, 1.55, -2.65], half: [1.35, 0.40, 0.25], material: 'tungsten', role: 'armor' },
            { id: 'ammo_rack', kind: 'beam', parent: 'hull', pos: [0, 1.85, 1.45], half: [1.15, 0.42, 0.85], material: 'steel', role: 'armor' },
        ],
        units: [
            { id: 'bogie_l', unitId: 'suspension_bogie', parent: 'hull', mountPos: [-1.72, 1.05, -0.95] },
            { id: 'bogie_r', unitId: 'suspension_bogie', parent: 'hull', mountPos: [1.72, 1.05, -0.95] },
            { id: 'bogie_rl', unitId: 'suspension_bogie', parent: 'hull', mountPos: [-1.72, 1.05, 1.15] },
            { id: 'bogie_rr', unitId: 'suspension_bogie', parent: 'hull', mountPos: [1.72, 1.05, 1.15] },
            { id: 'spade_l', unitId: 'outrigger_spade', parent: 'hull', mountPos: [-1.25, 1.25, 2.45] },
            { id: 'spade_r', unitId: 'outrigger_spade', parent: 'hull', mountPos: [1.25, 1.25, 2.45] },
            { id: 'turret', unitId: 'turret_howitzer_unit', parent: 'hull', mountPos: [0, 2.08, -0.25], scale: 1.18 },
        ],
    },

    juggernaut_ram: {
        id: 'juggernaut_ram',
        name: 'Juggernaut Pile-Bunker',
        tier: 3,
        category: 'brawler',
        description: 'Armored tungsten ramming wedge propelled by 4 sprung wheel bogies, flywheel surge [R], and dual pile-bunker spikes [Space].',
        ports: [
            { id: 'drive_sig', type: 'signal', role: 'W/S/A/D rush' },
            { id: 'surge_sig', type: 'signal', role: 'flywheel surge [R]' },
            { id: 'punch_sig', type: 'signal', role: 'pile-bunker thrust [Space]' },
        ],
        nodes: [
            { id: 'hull', kind: 'beam', pos: [0, 1.35, 0], half: [1.45, 0.48, 2.15], material: 'titanium', role: 'chassis' },
            { id: 'dozer_plow', kind: 'beam', parent: 'hull', pos: [0, 1.12, -2.52], half: [1.75, 0.62, 0.35], material: 'tungsten', role: 'plow', friction: 0.25 },
            { id: 'skirt_l', kind: 'beam', parent: 'hull', pos: [-1.58, 1.42, 0], half: [0.16, 0.42, 2.1], material: 'tungsten', role: 'armor' },
            { id: 'skirt_r', kind: 'beam', parent: 'hull', pos: [1.58, 1.42, 0], half: [0.16, 0.42, 2.1], material: 'tungsten', role: 'armor' },
        ],
        units: [
            { id: 'bogie_l', unitId: 'suspension_bogie', parent: 'hull', mountPos: [-1.52, 1.0, -0.95] },
            { id: 'bogie_r', unitId: 'suspension_bogie', parent: 'hull', mountPos: [1.52, 1.0, -0.95] },
            { id: 'bogie_rl', unitId: 'suspension_bogie', parent: 'hull', mountPos: [-1.52, 1.0, 1.05] },
            { id: 'bogie_rr', unitId: 'suspension_bogie', parent: 'hull', mountPos: [1.52, 1.0, 1.05] },
            { id: 'bunker', unitId: 'pile_bunker_arm', parent: 'hull', mountPos: [0, 1.85, -0.65] },
        ],
    },

    clockwork_catapult: {
        id: 'clockwork_catapult',
        name: 'Clockwork Siege Catapult',
        tier: 3,
        category: 'artillery',
        description: 'Self-winding geared torsion-spring siege carriage on heavy sprung bogies firing massive 140 kg boulders [Space].',
        ports: [
            { id: 'drive_sig', type: 'signal', role: 'W/S/A/D positioning' },
            { id: 'release_sig', type: 'signal', role: 'ratchet release [Space]' },
        ],
        nodes: [
            { id: 'hull', kind: 'beam', pos: [0, 1.32, 0], half: [1.55, 0.35, 2.35], material: 'steel', role: 'chassis' },
            { id: 'counterweight', kind: 'beam', parent: 'hull', pos: [0, 1.45, -1.85], half: [1.25, 0.55, 0.45], material: 'tungsten', role: 'armor' },
        ],
        units: [
            { id: 'bogie_l', unitId: 'suspension_bogie', parent: 'hull', mountPos: [-1.68, 0.98, -1.0] },
            { id: 'bogie_r', unitId: 'suspension_bogie', parent: 'hull', mountPos: [1.68, 0.98, -1.0] },
            { id: 'bogie_rl', unitId: 'suspension_bogie', parent: 'hull', mountPos: [-1.68, 0.98, 1.0] },
            { id: 'bogie_rr', unitId: 'suspension_bogie', parent: 'hull', mountPos: [1.68, 0.98, 1.0] },
            { id: 'launcher', unitId: 'trebuchet_launcher', parent: 'hull', mountPos: [0, 1.68, 0.25] },
        ],
    },

    twin_autocannon_tank: {
        id: 'twin_autocannon_tank',
        name: 'Vanguard Twin-Cannon Tank',
        tier: 3,
        category: 'skirmisher',
        description: 'Fast titanium-armored skirmisher combining 4 sprung bogies with side-by-side 120mm recoil breeches on a fast turret.',
        ports: [
            { id: 'drive_sig', type: 'signal', role: 'W/S/A/D high-speed drive' },
            { id: 'fire_sig', type: 'signal', role: 'dual-breech salvo [Space]' },
        ],
        nodes: [
            { id: 'hull', kind: 'beam', pos: [0, 1.28, 0], half: [1.35, 0.38, 2.05], material: 'titanium', role: 'chassis' },
            { id: 'glacis', kind: 'beam', parent: 'hull', pos: [0, 1.32, -2.15], half: [1.25, 0.30, 0.30], rot: [0.35, 0, 0, 0.9367], material: 'tungsten', role: 'armor' },
            {
                id: 'turret_head', kind: 'beam', parent: 'hull', pos: [0, 1.98, -0.15], half: [0.95, 0.38, 0.95], material: 'titanium', role: 'turret',
                joint: { kind: 'hinge', anchor: [0, 1.66, -0.15], axis: [0, 1, 0], lower: -3.05, upper: 3.05, target: 0, hertz: 12, damping: 0.95, maxEffort: 1.8e5, breakForce: 1.3e6, channel: 'turret_yaw', role: 'turret_yaw' },
            },
            {
                id: 'trunnion', kind: 'beam', parent: 'turret_head', pos: [0, 2.05, -0.45], half: [0.85, 0.28, 0.35], material: 'steel', role: 'turret',
                joint: { kind: 'hinge', anchor: [0, 2.05, -0.35], axis: [1, 0, 0], lower: -0.15, upper: 0.75, target: 0.14, hertz: 14, damping: 0.95, maxEffort: 1.4e5, breakForce: 1.1e6, channel: 'turret_pitch', role: 'turret_pitch' },
            },
        ],
        units: [
            { id: 'bogie_l', unitId: 'suspension_bogie', parent: 'hull', mountPos: [-1.52, 0.98, -0.85] },
            { id: 'bogie_r', unitId: 'suspension_bogie', parent: 'hull', mountPos: [1.52, 0.98, -0.85] },
            { id: 'bogie_rl', unitId: 'suspension_bogie', parent: 'hull', mountPos: [-1.52, 0.98, 0.95] },
            { id: 'bogie_rr', unitId: 'suspension_bogie', parent: 'hull', mountPos: [1.52, 0.98, 0.95] },
            { id: 'gun_l', unitId: 'recoil_breech', parent: 'trunnion', mountPos: [-0.46, 2.08, -0.65], scale: 0.85 },
            { id: 'gun_r', unitId: 'recoil_breech', parent: 'trunnion', mountPos: [0.46, 2.08, -0.65], scale: 0.85 },
        ],
    },

    biped_titan: {
        id: 'biped_titan',
        name: 'Colossus Biped Titan',
        tier: 3,
        category: 'mech',
        description: 'Gyro-stabilized bipedal mech combining twin heavy strider legs, tungsten stabilizer flywheel, and a heavy main turret.',
        ports: [
            { id: 'walk_sig', type: 'signal', role: 'W/S/A/D bipedal march' },
            { id: 'fire_sig', type: 'signal', role: 'shoulder cannon fire [Space]' },
        ],
        nodes: [
            { id: 'pelvis', kind: 'beam', pos: [0, 3.35, 0], half: [1.15, 0.45, 0.95], material: 'titanium', role: 'chassis' },
            { id: 'torso', kind: 'beam', parent: 'pelvis', pos: [0, 4.45, 0], half: [1.35, 0.85, 1.05], material: 'tungsten', role: 'armor' },
        ],
        couplings: [
            { id: 'torso_gyro', kind: 'gyro', nodeId: 'torso', maxTorque: 9.0e5 },
        ],
        units: [
            { id: 'fly', unitId: 'flywheel_bank', parent: 'torso', mountPos: [0, 4.65, 0.85] },
            { id: 'cam', unitId: 'cam_oscillator', parent: 'pelvis', mountPos: [0, 3.45, 0.4] },
            { id: 'leg_l', unitId: 'mech_leg_unit', parent: 'pelvis', mountPos: [-1.45, 3.05, 0], scale: 1.12 },
            { id: 'leg_r', unitId: 'mech_leg_unit', parent: 'pelvis', mountPos: [1.45, 3.05, 0], scale: 1.12, mirrorX: true },
            { id: 'turret', unitId: 'turret_howitzer_unit', parent: 'torso', mountPos: [0, 5.45, -0.25], scale: 1.05 },
        ],
    },
};

export const BUILTIN_CATALOG = {
    ...TIER1_COMPONENTS,
    ...TIER2_SUBSYSTEMS,
    ...TIER3_ASSEMBLIES,
};

export function createCatalogResolver(customMap = {}) {
    return (id) => customMap[id] || BUILTIN_CATALOG[id] || null;
}

export function listCatalogEntries(customMap = {}) {
    const all = { ...BUILTIN_CATALOG, ...customMap };
    return Object.values(all).sort((a, b) => (b.tier || 0) - (a.tier || 0) || a.name.localeCompare(b.name));
}
