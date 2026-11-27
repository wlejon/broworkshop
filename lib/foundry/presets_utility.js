// lib/foundry/presets_utility.js — Non-Slice-and-Dice Mechanical Machines:
// Hydraulic Forklift Lifters, Sumo Grapple Crawlers, Torsion Catapults,
// Diesel Battering Bulldozers, Overhead Workshop Gantry Cranes & Metropolis Recovery Cranes.
//
// Every blueprint is spatially packaged with ZERO solid or swept-volume interference
// and runs cleanly on the live Dyno Bench and Box3D Combat Arena.

import { createBlueprint, addNode } from "./blueprint.js";

const PI = Math.PI;

export function registerUtilityAndControlMachines(lib, reg, wire) {
    // =========================================================================
    // TIER 1: NEW NON-BLADE SUB-ASSEMBLIES (HOIST & FORKLIFT MAST)
    // =========================================================================

    // U1. 40:1 Self-Locking Worm Winch Pack (Motor -> 20:1 Worm -> Slip Clutch -> 2:1 Chain -> Cable Drum)
    {
        const bp = createBlueprint({
            id: 'worm_hoist_pack',
            name: '40:1 Worm Winch Pack',
            scale: 'subassembly',
            kind: 'weapon',
            description: 'Self-locking 20:1 bronze worm reducer + slip clutch + 2:1 roller chain driving a grooved steel cable winch drum. Holds multi-tonne static loads with zero back-drive.',
        });
        addNode(bp, { id: 'mtr', type: 'motor', label: 'Hoist Motor 2.2kW', x: 40, y: 130, pos3d: [0, 0, -0.24],
            params: { powerW: 2200, noLoadRpm: 1800, efficiency: 0.86 } });
        addNode(bp, { id: 'worm', type: 'worm_gear', label: '20:1 Worm Reducer', x: 240, y: 130, pos3d: [0, 0, -0.05],
            params: { ratio: 20, wheelOdMm: 98, faceWidthMm: 26, material: 'bronze' } });
        addNode(bp, { id: 'cl', type: 'slip_clutch', label: '260 N·m Load Clutch', x: 440, y: 130, pos3d: [0, 0, 0.08],
            params: { slipTorqueNm: 260, diameterMm: 95 } });
        addNode(bp, { id: 'chain', type: 'chain_drive', label: '2:1 Hoist Chain', x: 640, y: 130, pos3d: [0, 0, 0.24],
            params: { ratio: 2.0, spanMm: 150, pitchMm: 12.7, material: 'alloySteel' } });
        addNode(bp, { id: 'drum', type: 'weapon_head', label: 'Cable Winch Drum', x: 840, y: 130, pos3d: [0, 0, 0.44],
            params: { kind: 'winch_drum', massKg: 14, radiusM: 0.10, material: 'alloySteel' } });
        wire(bp, lib, [
            ['mtr', 'rot_out', 'worm', 'rot_in'],
            ['worm', 'rot_out', 'cl', 'rot_in'],
            ['cl', 'rot_out', 'chain', 'rot_in'],
            ['chain', 'rot_out', 'drum', 'rot_in'],
        ]);
        bp.exposedPorts = [
            { id: 'elec_in', label: 'DC In', domain: 'elec', dir: 'in', nodeId: 'mtr', portId: 'elec_in' },
        ];
        reg(bp);
    }

    // U2. Hydraulic Forklift Mast Pack (240-Bar HPU -> 60mm Lift Ram -> Twin Forged Forks)
    {
        const bp = createBlueprint({
            id: 'fork_mast_pack',
            name: 'Hydraulic Forklift Mast',
            scale: 'subassembly',
            kind: 'weapon',
            description: '240-Bar hydraulic power pack driving a 60 mm lift cylinder into twin forged tapered steel forks. Scoops and hoists 100 kg loads cleanly with relief-valve overload protection.',
        });
        addNode(bp, { id: 'hpu', type: 'assembly', ref: 'hyd_power_pack', label: '240-Bar Hyd Pack', x: 40, y: 130, pos3d: [0, 0, -0.15] });
        addNode(bp, { id: 'ram', type: 'hydraulic_ram', label: '60mm Lift Ram', x: 270, y: 130, pos3d: [0, 0.04, 0.13],
            params: { boreMm: 60, strokeMm: 170, maxBar: 250, material: 'alloySteel' } });
        addNode(bp, { id: 'forks', type: 'weapon_head', label: 'Twin Forged Forks', x: 500, y: 130, pos3d: [0, 0.11, 0.44],
            params: { kind: 'fork_lifter', massKg: 11.5, radiusM: 0.30, material: 'alloySteel' } });
        wire(bp, lib, [
            ['hpu', 'hyd_out', 'ram', 'hyd_in'],
            ['ram', 'lin_out', 'forks', 'lin_in'],
        ]);
        bp.exposedPorts = [
            { id: 'elec_in', label: 'DC In', domain: 'elec', dir: 'in', nodeId: 'hpu', portId: 'elec_in' },
        ];
        reg(bp);
    }

    // =========================================================================
    // TIER 2: NON-SLICE-AND-DICE ARENA & WORKSHOP MACHINES (0.8–1.4 m)
    // =========================================================================

    // U3. Atlas Hydraulic Lifter (Tracked Forklift Control Bot — Zero Spinning Blades!)
    {
        const bp = createBlueprint({
            id: 'bot_atlas_forklift',
            name: 'Atlas Hydraulic Lifter',
            scale: 'machine',
            kind: 'bot',
            description: 'Heavy tracked industrial forklift control bot. Twin crawler track drives, 240-bar hydraulic mast, twin forged lifting forks, oil cooler, and 16 mm rear ballast counterweight.',
        });
        addNode(bp, { id: 'batt', type: 'battery', label: '60V 900Wh Pack', x: 40, y: 180, pos3d: [0, 0.095, -0.34],
            params: { voltage: 60, capacityWh: 900, maxC: 16 } });
        addNode(bp, { id: 'drive_l', type: 'assembly', ref: 'drive_pod_crawler', label: 'Left Crawler Pod', x: 270, y: 50,
            pos3d: [-0.215, 0.10, -0.26], yaw3d: -PI / 2 });
        addNode(bp, { id: 'drive_r', type: 'assembly', ref: 'drive_pod_crawler', label: 'Right Crawler Pod', x: 270, y: 310,
            pos3d: [0.215, 0.10, -0.26], yaw3d: PI / 2 });
        addNode(bp, { id: 'track_l', type: 'track_unit', label: 'Left Steel Track', x: 540, y: 50, pos3d: [-0.44, 0.10, -0.02],
            params: { lengthM: 0.72, widthM: 0.12, heightM: 0.20, grip: 1.50, side: 'left' } });
        addNode(bp, { id: 'track_r', type: 'track_unit', label: 'Right Steel Track', x: 540, y: 310, pos3d: [0.44, 0.10, -0.02],
            params: { lengthM: 0.72, widthM: 0.12, heightM: 0.20, grip: 1.50, side: 'right' } });
        addNode(bp, { id: 'lifter', type: 'assembly', ref: 'fork_mast_pack', label: 'Hydraulic Fork Mast', x: 270, y: 180,
            pos3d: [0, 0.16, 0.27] });
        addNode(bp, { id: 'rad', type: 'radiator', label: 'Hydraulic Cooler', x: 540, y: 400, pos3d: [0, 0.25, -0.24],
            params: { coolingKW: 4.0, widthMm: 220, heightMm: 110 } });
        addNode(bp, { id: 'chassis', type: 'frame', label: '4140 Forklift Frame', x: 540, y: 180, pos3d: [0, 0.13, -0.02],
            params: { lengthM: 0.86, widthM: 0.72, heightM: 0.22, wallMm: 6.5, material: 'alloySteel' } });
        addNode(bp, { id: 'ballast', type: 'armor', label: '16mm Counterweight', x: 770, y: 180, pos3d: [0, 0.12, -0.49],
            params: { widthM: 0.72, heightM: 0.20, thicknessMm: 16, material: 'hardox', face: 'rear' } });
        wire(bp, lib, [
            ['batt', 'elec_out', 'drive_l', 'elec_in'],
            ['batt', 'elec_out', 'drive_r', 'elec_in'],
            ['batt', 'elec_out', 'lifter', 'elec_in'],
            ['drive_l', 'rot_out', 'track_l', 'rot_in'],
            ['drive_r', 'rot_out', 'track_r', 'rot_in'],
            ['chassis', 'struct_out', 'ballast', 'struct_in'],
        ]);
        reg(bp);
    }

    // U4. Kodiak Grapple Crawler (Gas-Differential Sumo Clamper — Zero Spinning Blades!)
    {
        const bp = createBlueprint({
            id: 'bot_kodiak_grapple',
            name: 'Kodiak Grapple Crawler',
            scale: 'machine',
            kind: 'bot',
            description: 'Hybrid gas-hydraulic sumo grappler. 200cc twin gas engine feeds a 90° bevel transfer & true mechanical summing differential, while a 240-bar hydraulic ram drives twin serrated clamping jaws.',
        });
        addNode(bp, { id: 'eng', type: 'ic_engine', label: '200cc Twin Gas', x: 40, y: 80, pos3d: [0, 0.14, -0.37],
            params: { displacementCc: 200, cylinders: 2, redlineRpm: 4200, fuelKg: 1.8 } });
        addNode(bp, { id: 'bevel', type: 'bevel_gear', label: '1.5:1 Bevel Transfer', x: 240, y: 80, pos3d: [0, 0.14, -0.22],
            params: { ratio: 1.5, crownOdMm: 88, material: 'alloySteel' } });
        addNode(bp, { id: 'diff', type: 'differential', label: 'Summing Differential', x: 440, y: 80, pos3d: [0, 0.14, -0.09],
            params: { ratio: 1.5, carrierOdMm: 112, material: 'alloySteel' } });
        addNode(bp, { id: 'wheel_l', type: 'wheel', label: 'Left Sumo Tire', x: 660, y: 40, pos3d: [-0.46, 0.14, -0.09],
            params: { radiusM: 0.14, widthM: 0.10, grip: 1.48, side: 'left' } });
        addNode(bp, { id: 'wheel_r', type: 'wheel', label: 'Right Sumo Tire', x: 660, y: 140, pos3d: [0.46, 0.14, -0.09],
            params: { radiusM: 0.14, widthM: 0.10, grip: 1.48, side: 'right' } });
        addNode(bp, { id: 'batt', type: 'battery', label: '48V 450Wh Aux Pack', x: 40, y: 260, pos3d: [-0.23, 0.09, -0.34],
            params: { voltage: 48, capacityWh: 450, maxC: 15 } });
        addNode(bp, { id: 'hpu', type: 'assembly', ref: 'hyd_power_pack', label: '240-Bar Hyd Pack', x: 240, y: 260, pos3d: [0, 0.12, 0.21] });
        addNode(bp, { id: 'ram', type: 'hydraulic_ram', label: '64mm Clamp Ram', x: 460, y: 260, pos3d: [0, 0.13, 0.45],
            params: { boreMm: 64, strokeMm: 155, maxBar: 250, material: 'toolSteel' } });
        addNode(bp, { id: 'claw', type: 'weapon_head', label: 'Dual-Jaw Grapple', x: 680, y: 260, pos3d: [0, 0.13, 0.74],
            params: { kind: 'grapple_claw', massKg: 11.5, radiusM: 0.30, material: 'toolSteel' } });
        addNode(bp, { id: 'rad', type: 'radiator', label: 'Engine Cooler', x: 440, y: 380, pos3d: [0.22, 0.24, -0.30],
            params: { coolingKW: 4.5, widthMm: 200, heightMm: 100 } });
        addNode(bp, { id: 'chassis', type: 'frame', label: 'Heavy Sumo Chassis', x: 660, y: 380, pos3d: [0, 0.13, 0],
            params: { lengthM: 0.96, widthM: 0.76, heightM: 0.22, wallMm: 6.5, material: 'alloySteel' } });
        addNode(bp, { id: 'bumper', type: 'armor', label: 'Rear Hardox Bumper', x: 870, y: 380, pos3d: [0, 0.12, -0.52],
            params: { widthM: 0.76, heightM: 0.20, thicknessMm: 10, material: 'hardox', face: 'rear' } });
        wire(bp, lib, [
            ['eng', 'rot_out', 'bevel', 'rot_in'],
            ['bevel', 'rot_out', 'diff', 'rot_in'],
            ['diff', 'rot_out', 'wheel_l', 'rot_in'],
            ['diff', 'rot_out_b', 'wheel_r', 'rot_in'],
            ['batt', 'elec_out', 'hpu', 'elec_in'],
            ['hpu', 'hyd_out', 'ram', 'hyd_in'],
            ['ram', 'lin_out', 'claw', 'lin_in'],
            ['chassis', 'struct_out', 'bumper', 'struct_in'],
        ]);
        reg(bp);
    }

    // U5. Ballista Torsion Catapult (Worm-Wound Sprag-Clutch Trebuchet Launcher!)
    {
        const bp = createBlueprint({
            id: 'bot_ballista_catapult',
            name: 'Ballista Torsion Catapult',
            scale: 'machine',
            kind: 'bot',
            description: 'Agile planetary-drive launcher bot. A supercap-fed motor winds a 320 N·m/rad torsion spring through a self-locking 18:1 worm reducer & sprag freewheel to hurl opponents with a counterweight trebuchet arm.',
        });
        addNode(bp, { id: 'batt', type: 'battery', label: '48V 600Wh Pack', x: 40, y: 120, pos3d: [-0.17, 0.085, -0.34],
            params: { voltage: 48, capacityWh: 600, maxC: 16 } });
        addNode(bp, { id: 'cap', type: 'capacitor_bank', label: '28kW Supercap Bank', x: 40, y: 260, pos3d: [0.17, 0.085, -0.34],
            params: { voltage: 48, energyKJ: 24, maxPeakKW: 28 } });
        addNode(bp, { id: 'drive_l', type: 'assembly', ref: 'drive_pod_planetary', label: 'Left Planetary Pod', x: 260, y: 40,
            pos3d: [-0.215, 0.13, -0.10], yaw3d: -PI / 2 });
        addNode(bp, { id: 'drive_r', type: 'assembly', ref: 'drive_pod_planetary', label: 'Right Planetary Pod', x: 260, y: 340,
            pos3d: [0.215, 0.13, -0.10], yaw3d: PI / 2 });
        addNode(bp, { id: 'wheel_l', type: 'wheel', label: 'Left Drive Wheel', x: 500, y: 40, pos3d: [-0.43, 0.13, -0.10],
            params: { radiusM: 0.13, widthM: 0.09, grip: 1.32, side: 'left' } });
        addNode(bp, { id: 'wheel_r', type: 'wheel', label: 'Right Drive Wheel', x: 500, y: 340, pos3d: [0.43, 0.13, -0.10],
            params: { radiusM: 0.13, widthM: 0.09, grip: 1.32, side: 'right' } });
        addNode(bp, { id: 'wmtr', type: 'motor', label: 'Winder Motor 1.8kW', x: 260, y: 190, pos3d: [0, 0.28, -0.18],
            params: { powerW: 1800, noLoadRpm: 2200, efficiency: 0.86 } });
        addNode(bp, { id: 'worm', type: 'worm_gear', label: '18:1 Worm Winder', x: 440, y: 190, pos3d: [0, 0.28, -0.01],
            params: { ratio: 18, wheelOdMm: 92, faceWidthMm: 24, material: 'bronze' } });
        addNode(bp, { id: 'sprag', type: 'overrun_clutch', label: 'Sprag Freewheel', x: 620, y: 190, pos3d: [0, 0.28, 0.11],
            params: { torqueMaxNm: 420, diameterMm: 78, material: 'toolSteel' } });
        addNode(bp, { id: 'spr', type: 'spring_actuator', label: '320 N·m Torsion Pack', x: 790, y: 190, pos3d: [0, 0.28, 0.23],
            params: { stiffnessNmRad: 320, maxAngleDeg: 115, material: 'toolSteel' } });
        addNode(bp, { id: 'arm', type: 'weapon_head', label: 'Catapult Throwing Arm', x: 970, y: 190, pos3d: [0, 0.36, 0.56],
            params: { kind: 'trebuchet_arm', massKg: 9.5, radiusM: 0.44, material: 'alloySteel' } });
        addNode(bp, { id: 'chassis', type: 'frame', label: '4140 Catapult Frame', x: 660, y: 340, pos3d: [0, 0.125, -0.02],
            params: { lengthM: 0.88, widthM: 0.70, heightM: 0.20, wallMm: 5.5, material: 'alloySteel' } });
        addNode(bp, { id: 'wedge', type: 'armor', label: 'Hardox Scoop Lip', x: 870, y: 340, pos3d: [0, 0.068, 0.48],
            params: { widthM: 0.70, heightM: 0.095, thicknessMm: 10, material: 'hardox', face: 'front' } });
        wire(bp, lib, [
            ['batt', 'elec_out', 'drive_l', 'elec_in'],
            ['batt', 'elec_out', 'drive_r', 'elec_in'],
            ['batt', 'elec_out', 'cap', 'elec_in'],
            ['cap', 'elec_out', 'wmtr', 'elec_in'],
            ['drive_l', 'rot_out', 'wheel_l', 'rot_in'],
            ['drive_r', 'rot_out', 'wheel_r', 'rot_in'],
            ['wmtr', 'rot_out', 'worm', 'rot_in'],
            ['worm', 'rot_out', 'sprag', 'rot_in'],
            ['sprag', 'rot_out', 'spr', 'rot_in'],
            ['spr', 'rot_out', 'arm', 'rot_in'],
            ['chassis', 'struct_out', 'wedge', 'struct_in'],
        ]);
        reg(bp);
    }

    // U6. Diesel Battering Bull (Twin-Diesel Flywheel + Diff Tracks + Crank-Slider Battering Ram!)
    {
        const bp = createBlueprint({
            id: 'bot_battering_bull',
            name: 'Diesel Battering Bull',
            scale: 'machine',
            kind: 'bot',
            description: 'Pure mechanical siege dozer. A 380cc twin industrial diesel spins a 6.5 kg steel flywheel through a 140 N·m slip clutch, simultaneously powering crawler tracks via a summing differential and a reciprocating crank-slider battering ram.',
        });
        addNode(bp, { id: 'eng', type: 'ic_engine', label: '380cc Twin Diesel', x: 40, y: 180, pos3d: [0, 0.15, -0.34],
            params: { displacementCc: 380, cylinders: 2, redlineRpm: 2600, fuelKg: 2.5 } });
        addNode(bp, { id: 'fw', type: 'flywheel', label: '6.5kg Steel Flywheel', x: 230, y: 180, pos3d: [0, 0.15, -0.15],
            params: { diameterMm: 180, massKg: 6.5, material: 'alloySteel' } });
        addNode(bp, { id: 'cl', type: 'slip_clutch', label: '140 N·m Master Clutch', x: 420, y: 180, pos3d: [0, 0.15, -0.05],
            params: { slipTorqueNm: 140, diameterMm: 95 } });
        addNode(bp, { id: 'diff', type: 'differential', label: '3.5:1 Crawler Diff', x: 620, y: 90, pos3d: [0, 0.12, 0.08],
            params: { ratio: 3.5, carrierOdMm: 116, material: 'alloySteel' } });
        addNode(bp, { id: 'track_l', type: 'track_unit', label: 'Left Siege Track', x: 840, y: 40, pos3d: [-0.46, 0.10, -0.01],
            params: { lengthM: 0.78, widthM: 0.13, heightM: 0.20, grip: 1.55, side: 'left' } });
        addNode(bp, { id: 'track_r', type: 'track_unit', label: 'Right Siege Track', x: 840, y: 150, pos3d: [0.46, 0.10, -0.01],
            params: { lengthM: 0.78, widthM: 0.13, heightM: 0.20, grip: 1.55, side: 'right' } });
        addNode(bp, { id: 'crank', type: 'crank_slider', label: '45mm Battering Crank', x: 620, y: 270, pos3d: [0, 0.27, 0.28],
            params: { throwMm: 45, rodLenMm: 155, material: 'toolSteel' } });
        addNode(bp, { id: 'ram', type: 'weapon_head', label: 'Forged Battering Ram', x: 840, y: 270, pos3d: [0, 0.27, 0.64],
            params: { kind: 'piledriver_spear', massKg: 12.5, radiusM: 0.30, material: 'toolSteel' } });
        addNode(bp, { id: 'rad', type: 'radiator', label: 'Diesel Heat Exchanger', x: 420, y: 360, pos3d: [0, 0.38, -0.26],
            params: { coolingKW: 6.5, widthMm: 260, heightMm: 120 } });
        addNode(bp, { id: 'chassis', type: 'frame', label: 'Heavy Dozer Hull', x: 620, y: 380, pos3d: [0, 0.13, -0.01],
            params: { lengthM: 0.94, widthM: 0.74, heightM: 0.22, wallMm: 7.0, material: 'alloySteel' } });
        addNode(bp, { id: 'rear', type: 'armor', label: '14mm Rear Bulkhead', x: 840, y: 380, pos3d: [0, 0.12, -0.52],
            params: { widthM: 0.74, heightM: 0.20, thicknessMm: 14, material: 'hardox', face: 'rear' } });
        wire(bp, lib, [
            ['eng', 'rot_out', 'fw', 'rot_in'],
            ['fw', 'rot_out', 'cl', 'rot_in'],
            ['cl', 'rot_out', 'diff', 'rot_in'],
            ['diff', 'rot_out', 'track_l', 'rot_in'],
            ['diff', 'rot_out_b', 'track_r', 'rot_in'],
            ['cl', 'rot_out', 'crank', 'rot_in'],
            ['crank', 'lin_out', 'ram', 'lin_in'],
            ['chassis', 'struct_out', 'rear', 'struct_in'],
        ]);
        reg(bp);
    }

    // U7. 5-Tonne Workshop Gantry Crane (Tall Open 4-Post Bridge Hoist + Worm Winch + Lead-Screw Trolley!)
    {
        const bp = createBlueprint({
            id: 'machine_gantry_crane',
            name: '5t Workshop Gantry Crane',
            scale: 'machine',
            kind: 'workshop',
            description: 'Foundry overhead bridge crane built on an open 4-post steel gantry. Features planetary rail travel drives, a transverse lead-screw trolley carriage, and a 40:1 self-locking worm cable winch.',
        });
        addNode(bp, { id: 'batt', type: 'battery', label: '48V 900Wh Shop Bus', x: 40, y: 180, pos3d: [-0.32, 0.14, -0.44],
            params: { voltage: 48, capacityWh: 900, maxC: 12 } });
        addNode(bp, { id: 'drive_l', type: 'assembly', ref: 'drive_pod_planetary', label: 'Left Rail Drive', x: 270, y: 60,
            pos3d: [-0.34, 0.14, 0.30], yaw3d: -PI / 2 });
        addNode(bp, { id: 'drive_r', type: 'assembly', ref: 'drive_pod_planetary', label: 'Right Rail Drive', x: 270, y: 300,
            pos3d: [0.34, 0.14, 0.30], yaw3d: PI / 2 });
        addNode(bp, { id: 'wheel_l', type: 'wheel', label: 'Left Rail Wheel', x: 520, y: 60, pos3d: [-0.58, 0.14, 0.30],
            params: { radiusM: 0.14, widthM: 0.08, grip: 1.0, side: 'left' } });
        addNode(bp, { id: 'wheel_r', type: 'wheel', label: 'Right Rail Wheel', x: 520, y: 300, pos3d: [0.58, 0.14, 0.30],
            params: { radiusM: 0.14, widthM: 0.08, grip: 1.0, side: 'right' } });
        addNode(bp, { id: 'tmtr', type: 'motor', label: 'Trolley Motor 1.2kW', x: 270, y: 180, pos3d: [-0.36, 1.22, -0.26],
            yaw3d: PI / 2, params: { powerW: 1200, noLoadRpm: 1800, efficiency: 0.86 } });
        addNode(bp, { id: 'tscrew', type: 'lead_screw', label: 'Bridge Lead Screw', x: 520, y: 180, pos3d: [0.06, 1.22, -0.26],
            yaw3d: PI / 2, params: { diameterMm: 32, pitchMm: 6, strokeMm: 420, material: 'alloySteel' } });
        addNode(bp, { id: 'hoist', type: 'assembly', ref: 'worm_hoist_pack', label: '40:1 Worm Cable Winch', x: 270, y: 410,
            pos3d: [0, 1.04, 0.18] });
        addNode(bp, { id: 'rad', type: 'radiator', label: 'Drive Bay Cooler', x: 520, y: 410, pos3d: [0.32, 0.16, -0.44],
            params: { coolingKW: 4.0, widthMm: 220, heightMm: 110 } });
        addNode(bp, { id: 'frame', type: 'frame', label: '4-Post Steel Gantry', x: 760, y: 180, pos3d: [0, 0.66, 0],
            params: { lengthM: 1.25, widthM: 1.05, heightM: 1.32, wallMm: 12, material: 'alloySteel' } });
        wire(bp, lib, [
            ['batt', 'elec_out', 'drive_l', 'elec_in'],
            ['batt', 'elec_out', 'drive_r', 'elec_in'],
            ['batt', 'elec_out', 'tmtr', 'elec_in'],
            ['batt', 'elec_out', 'hoist', 'elec_in'],
            ['drive_l', 'rot_out', 'wheel_l', 'rot_in'],
            ['drive_r', 'rot_out', 'wheel_r', 'rot_in'],
            ['tmtr', 'rot_out', 'tscrew', 'rot_in'],
        ]);
        reg(bp);
    }

    // =========================================================================
    // TIER 3: METROPOLIS MULTI-STOREY HEAVY UTILITY TITAN MODULE
    // =========================================================================

    // U8. Metropolis 8m Diesel-Hydraulic Recovery Crane Deck
    {
        const bp = createBlueprint({
            id: 'titan_recovery_crane',
            name: 'Metropolis 8m Crane Deck',
            scale: 'titan',
            kind: 'titan',
            description: 'Multi-storey city-scale construction & recovery crane module. A 12L V8 diesel spins a 420 kg flywheel & 14 kN·m clutch, driving both a 310-bar hydraulic boom luffing ram and a 30:1 self-locking 3.8-tonne cable winch drum.',
        });
        addNode(bp, { id: 'eng', type: 'ic_engine', label: '12L V8 Crane Diesel', x: 40, y: 180, pos3d: [0, 1.05, -2.4],
            params: { displacementCc: 12000, cylinders: 8, redlineRpm: 1600, fuelKg: 180 } });
        addNode(bp, { id: 'fw', type: 'flywheel', label: '420kg Inertia Wheel', x: 240, y: 180, pos3d: [0, 1.05, -1.25],
            params: { diameterMm: 950, massKg: 420, material: 'alloySteel' } });
        addNode(bp, { id: 'cl', type: 'slip_clutch', label: '14 kN·m Master Clutch', x: 440, y: 180, pos3d: [0, 1.05, -0.55],
            params: { slipTorqueNm: 14000, diameterMm: 780, material: 'toolSteel' } });
        addNode(bp, { id: 'pump', type: 'hydraulic_pump', label: '260cc Boom Pump', x: 640, y: 80, pos3d: [-0.95, 1.05, 0.45],
            params: { dispCcRev: 260, maxBar: 350, efficiency: 0.90 } });
        addNode(bp, { id: 'valve', type: 'hydraulic_valve', label: '310-Bar Relief Block', x: 840, y: 80, pos3d: [-0.95, 1.05, 1.55],
            params: { reliefBar: 310, maxFlowLpm: 560 } });
        addNode(bp, { id: 'ram', type: 'hydraulic_ram', label: '180mm Boom Ram', x: 1040, y: 80, pos3d: [-0.95, 1.55, 3.05],
            params: { boreMm: 180, strokeMm: 1800, maxBar: 350, material: 'toolSteel' } });
        addNode(bp, { id: 'worm', type: 'worm_gear', label: '30:1 Heavy Worm Hoist', x: 640, y: 280, pos3d: [0.95, 1.05, 0.75],
            params: { ratio: 30, wheelOdMm: 760, faceWidthMm: 220, material: 'bronze' } });
        addNode(bp, { id: 'winch', type: 'weapon_head', label: '3.8t Cable Winch Drum', x: 860, y: 280, pos3d: [0.95, 1.85, 2.85],
            params: { kind: 'winch_drum', massKg: 3800, radiusM: 0.85, material: 'toolSteel' } });
        addNode(bp, { id: 'rad', type: 'radiator', label: '160kW Heat Exchanger', x: 440, y: 360, pos3d: [0, 2.35, -1.4],
            params: { coolingKW: 160, widthMm: 1600, heightMm: 1100 } });
        addNode(bp, { id: 'deck', type: 'frame', label: '6.4m Structural Deck', x: 1040, y: 280, pos3d: [0, 0.45, 0.1],
            params: { lengthM: 6.4, widthM: 3.4, heightM: 0.85, wallMm: 28, material: 'alloySteel' } });
        wire(bp, lib, [
            ['eng', 'rot_out', 'fw', 'rot_in'],
            ['fw', 'rot_out', 'cl', 'rot_in'],
            ['cl', 'rot_out', 'pump', 'rot_in'],
            ['pump', 'hyd_out', 'valve', 'hyd_in'],
            ['valve', 'hyd_out', 'ram', 'hyd_in'],
            ['cl', 'rot_out', 'worm', 'rot_in'],
            ['worm', 'rot_out', 'winch', 'rot_in'],
        ]);
        reg(bp);
    }
}
