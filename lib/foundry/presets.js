// lib/foundry/presets.js — Tier 1 Precision Mechanisms & Sub-Assemblies (15 blueprints)
// plus unified starter library loader across all 3 physical scales (27 total blueprints).
//
// Every blueprint is spatially packaged with zero solid or swept-volume interference
// (enforced by compiler.js::checkSpatialInterference).

import { createBlueprint, addNode, addLink } from "./blueprint.js";
import { registerMachinesAndTitans } from "./presets_machines.js";
import { registerUtilityAndControlMachines } from "./presets_utility.js";
import { registerIndustrialAndMechMachines } from "./presets_industrial.js";

export function wire(bp, lib, pairs) {
    for (const [a, ap, b, bpPort] of pairs) {
        const res = addLink(bp, a, ap, b, bpPort, lib);
        if (!res) throw new Error(`presets(${bp.id}): failed to link ${a}.${ap} -> ${b}.${bpPort}`);
    }
}

export function createStarterLibrary() {
    const lib = {};
    const reg = (bp) => { lib[bp.id] = bp; return bp; };

    // =========================================================================
    // TIER 1: PRECISION SUB-ASSEMBLIES & MECHANISMS (10–60 cm)
    // =========================================================================

    // 1. 3:1 Light Spur Gearbox (cheap mild steel + bronze bushings)
    {
        const bp = createBlueprint({
            id: 'gb_3to1_light',
            name: '3:1 Light Gearbox',
            scale: 'subassembly',
            kind: 'gearbox',
            description: 'Compact 3:1 mild-steel spur stage on bronze bushings. Cheap and light, but teeth strip near 122 N·m and bushings wear quickly under radial shock.',
        });
        addNode(bp, { id: 'in_brg', type: 'bearing', label: 'Input Bushing', x: 60, y: 120, pos3d: [0, 0, -0.042],
            params: { boreMm: 14, kind: 'bushing', material: 'bronze' } });
        addNode(bp, { id: 'stage1', type: 'gear_pair', label: '12:36 Spur Stage', x: 260, y: 120, pos3d: [0, 0, 0],
            params: { teethIn: 12, teethOut: 36, moduleMm: 2.5, faceWidthMm: 15, material: 'mildSteel' } });
        addNode(bp, { id: 'out_brg', type: 'bearing', label: 'Output Bushing', x: 470, y: 120, pos3d: [0.060, 0, 0.042],
            params: { boreMm: 22, kind: 'bushing', material: 'bronze' } });
        wire(bp, lib, [
            ['in_brg', 'rot_out', 'stage1', 'rot_in'],
            ['stage1', 'rot_out', 'out_brg', 'rot_in'],
        ]);
        bp.exposedPorts = [
            { id: 'rot_in', label: 'Input Shaft', domain: 'rot', dir: 'in', nodeId: 'in_brg', portId: 'rot_in' },
            { id: 'rot_out', label: 'Output Shaft', domain: 'rot', dir: 'out', nodeId: 'out_brg', portId: 'rot_out' },
        ];
        reg(bp);
    }

    // 2. 4:1 Heavy Spur Gearbox (hardened tool steel + tapered roller bearings)
    {
        const bp = createBlueprint({
            id: 'gb_4to1_heavy',
            name: '4:1 Heavy Gearbox',
            scale: 'subassembly',
            kind: 'gearbox',
            description: 'Hardened S7 tool-steel 4:1 reduction on tapered roller bearings. Compact 96 mm bull gear packages cleanly inside combat chassis.',
        });
        addNode(bp, { id: 'in_brg', type: 'bearing', label: 'Input Ball Brg', x: 60, y: 120, pos3d: [0, 0, -0.046],
            params: { boreMm: 16, kind: 'ball', material: 'alloySteel' } });
        addNode(bp, { id: 'stage1', type: 'gear_pair', label: '12:48 Alloy Stage', x: 260, y: 120, pos3d: [0, 0, 0],
            params: { teethIn: 12, teethOut: 48, moduleMm: 2.0, faceWidthMm: 20, material: 'toolSteel' } });
        addNode(bp, { id: 'out_brg', type: 'bearing', label: 'Output Roller Brg', x: 470, y: 120, pos3d: [0.060, 0, 0.046],
            params: { boreMm: 22, kind: 'roller', material: 'alloySteel' } });
        wire(bp, lib, [
            ['in_brg', 'rot_out', 'stage1', 'rot_in'],
            ['stage1', 'rot_out', 'out_brg', 'rot_in'],
        ]);
        bp.exposedPorts = [
            { id: 'rot_in', label: 'Input Shaft', domain: 'rot', dir: 'in', nodeId: 'in_brg', portId: 'rot_in' },
            { id: 'rot_out', label: 'Output Shaft', domain: 'rot', dir: 'out', nodeId: 'out_brg', portId: 'rot_out' },
        ];
        reg(bp);
    }

    // 2b. 3:1 Alloy Weapon Gearbox (hardened alloy steel + ball/roller bearings — runs cool & fast!)
    {
        const bp = createBlueprint({
            id: 'gb_3to1_weapon',
            name: '3:1 Alloy Weapon Gearbox',
            scale: 'subassembly',
            kind: 'gearbox',
            description: 'High-speed 3:1 alloy-steel spur stage on precision ball & tapered roller bearings. Handles sustained 4.5 kW spinner speeds without bushing overheating.',
        });
        addNode(bp, { id: 'in_brg', type: 'bearing', label: 'Input Ball Brg', x: 60, y: 120, pos3d: [0, 0, -0.044],
            params: { boreMm: 18, kind: 'ball', material: 'alloySteel' } });
        addNode(bp, { id: 'stage1', type: 'gear_pair', label: '12:36 Alloy Stage', x: 260, y: 120, pos3d: [0, 0, 0],
            params: { teethIn: 12, teethOut: 36, moduleMm: 2.5, faceWidthMm: 18, material: 'alloySteel' } });
        addNode(bp, { id: 'out_brg', type: 'bearing', label: 'Output Roller Brg', x: 470, y: 120, pos3d: [0.060, 0, 0.044],
            params: { boreMm: 24, kind: 'roller', material: 'alloySteel' } });
        wire(bp, lib, [
            ['in_brg', 'rot_out', 'stage1', 'rot_in'],
            ['stage1', 'rot_out', 'out_brg', 'rot_in'],
        ]);
        bp.exposedPorts = [
            { id: 'rot_in', label: 'Input Shaft', domain: 'rot', dir: 'in', nodeId: 'in_brg', portId: 'rot_in' },
            { id: 'rot_out', label: 'Output Shaft', domain: 'rot', dir: 'out', nodeId: 'out_brg', portId: 'rot_out' },
        ];
        reg(bp);
    }

    // 3. 5:1 Coaxial Planetary Gearbox (zero radial offset, 3-planet load sharing!)
    {
        const bp = createBlueprint({
            id: 'gb_planetary_5to1',
            name: '5:1 Planetary Gearbox',
            scale: 'subassembly',
            kind: 'gearbox',
            description: 'Coaxial 3-planet alloy-steel epicyclic gearbox on ball/roller bearings. Zero radial axis offset and 3x tooth load sharing.',
        });
        addNode(bp, { id: 'in_brg', type: 'bearing', label: 'Sun Input Brg', x: 60, y: 120, pos3d: [0, 0, -0.045],
            params: { boreMm: 16, kind: 'ball', material: 'alloySteel' } });
        addNode(bp, { id: 'plan', type: 'planetary_gear', label: '5:1 Planetary Stage', x: 260, y: 120, pos3d: [0, 0, 0],
            params: { ratio: 5, ringOdMm: 78, faceWidthMm: 24, planets: 3, material: 'alloySteel' } });
        addNode(bp, { id: 'out_brg', type: 'bearing', label: 'Carrier Roller Brg', x: 470, y: 120, pos3d: [0, 0, 0.048],
            params: { boreMm: 22, kind: 'roller', material: 'alloySteel' } });
        wire(bp, lib, [
            ['in_brg', 'rot_out', 'plan', 'rot_in'],
            ['plan', 'rot_out', 'out_brg', 'rot_in'],
        ]);
        bp.exposedPorts = [
            { id: 'rot_in', label: 'Sun In', domain: 'rot', dir: 'in', nodeId: 'in_brg', portId: 'rot_in' },
            { id: 'rot_out', label: 'Carrier Out', domain: 'rot', dir: 'out', nodeId: 'out_brg', portId: 'rot_out' },
        ];
        reg(bp);
    }

    // 4. 20:1 Self-Locking Worm Reducer (massive torque, high sliding heat!)
    {
        const bp = createBlueprint({
            id: 'gb_worm_20to1',
            name: '20:1 Worm Reducer',
            scale: 'subassembly',
            kind: 'gearbox',
            description: 'Self-locking 20:1 bronze worm wheel reducer with active oil cooler. Holds massive static loads without power, runs hot under sustained torque.',
        });
        addNode(bp, { id: 'in_brg', type: 'bearing', label: 'Worm Thrust Brg', x: 60, y: 120, pos3d: [0, 0, -0.075],
            params: { boreMm: 16, kind: 'ball', material: 'alloySteel' } });
        addNode(bp, { id: 'worm', type: 'worm_gear', label: '20:1 Bronze Worm', x: 270, y: 120, pos3d: [0, 0, 0],
            params: { ratio: 20, wheelOdMm: 98, faceWidthMm: 28, material: 'bronze' } });
        addNode(bp, { id: 'out_brg', type: 'bearing', label: 'Output Roller Brg', x: 480, y: 120, pos3d: [0, 0, 0.080],
            params: { boreMm: 26, kind: 'roller', material: 'toolSteel' } });
        addNode(bp, { id: 'rad', type: 'radiator', label: 'Case Oil Cooler', x: 270, y: 245, pos3d: [0.11, 0, 0],
            params: { coolingKW: 2.5, widthMm: 95, heightMm: 85 } });
        wire(bp, lib, [
            ['in_brg', 'rot_out', 'worm', 'rot_in'],
            ['worm', 'rot_out', 'out_brg', 'rot_in'],
        ]);
        bp.exposedPorts = [
            { id: 'rot_in', label: 'Worm In', domain: 'rot', dir: 'in', nodeId: 'in_brg', portId: 'rot_in' },
            { id: 'rot_out', label: 'Wheel Out', domain: 'rot', dir: 'out', nodeId: 'out_brg', portId: 'rot_out' },
        ];
        reg(bp);
    }

    // 5. Heavy Spur Drive Pod
    {
        const bp = createBlueprint({
            id: 'drive_pod_heavy',
            name: 'Heavy Drive Pod',
            scale: 'subassembly',
            kind: 'drivetrain',
            description: '2.2 kW brushless drive coupled through a compiled 4:1 Heavy Gearbox and 20 mm alloy axle.',
        });
        addNode(bp, { id: 'mtr', type: 'motor', label: 'Drive Motor 2.2kW', x: 60, y: 120, pos3d: [0, 0, -0.105],
            params: { powerW: 2200, noLoadRpm: 3200, efficiency: 0.87 } });
        addNode(bp, { id: 'gb', type: 'assembly', ref: 'gb_4to1_heavy', label: '4:1 Heavy Gearbox', x: 270, y: 120, pos3d: [0, 0, 0.015] });
        addNode(bp, { id: 'axle', type: 'shaft', label: 'Drive Axle', x: 490, y: 120, pos3d: [0.06, 0, 0.125],
            params: { diameterMm: 20, lengthMm: 100, material: 'alloySteel' } });
        wire(bp, lib, [
            ['mtr', 'rot_out', 'gb', 'rot_in'],
            ['gb', 'rot_out', 'axle', 'rot_in'],
        ]);
        bp.exposedPorts = [
            { id: 'elec_in', label: 'DC In', domain: 'elec', dir: 'in', nodeId: 'mtr', portId: 'elec_in' },
            { id: 'rot_out', label: 'Axle Out', domain: 'rot', dir: 'out', nodeId: 'axle', portId: 'rot_out' },
        ];
        reg(bp);
    }

    // 6. Light Spur Drive Pod (bronze bushings wear fast!)
    {
        const bp = createBlueprint({
            id: 'drive_pod_light',
            name: 'Light Drive Pod',
            scale: 'subassembly',
            kind: 'drivetrain',
            description: 'High-speed drive using the 3:1 Light Gearbox. Faster top speed and lighter, but bronze bushings wear quickly.',
        });
        addNode(bp, { id: 'mtr', type: 'motor', label: 'Drive Motor 2.0kW', x: 60, y: 120, pos3d: [0, 0, -0.10],
            params: { powerW: 2000, noLoadRpm: 3800, efficiency: 0.86 } });
        addNode(bp, { id: 'gb', type: 'assembly', ref: 'gb_3to1_light', label: '3:1 Light Gearbox', x: 270, y: 120, pos3d: [0, 0, 0.015] });
        addNode(bp, { id: 'axle', type: 'shaft', label: 'Light Axle', x: 480, y: 120, pos3d: [0.06, 0, 0.12],
            params: { diameterMm: 14, lengthMm: 95, material: 'mildSteel' } });
        wire(bp, lib, [
            ['mtr', 'rot_out', 'gb', 'rot_in'],
            ['gb', 'rot_out', 'axle', 'rot_in'],
        ]);
        bp.exposedPorts = [
            { id: 'elec_in', label: 'DC In', domain: 'elec', dir: 'in', nodeId: 'mtr', portId: 'elec_in' },
            { id: 'rot_out', label: 'Axle Out', domain: 'rot', dir: 'out', nodeId: 'axle', portId: 'rot_out' },
        ];
        reg(bp);
    }

    // 7. Coaxial Planetary Drive Pod (zero radial offset — ultra compact inline package!)
    {
        const bp = createBlueprint({
            id: 'drive_pod_planetary',
            name: 'Planetary Drive Pod',
            scale: 'subassembly',
            kind: 'drivetrain',
            description: 'Inline coaxial 2.4 kW brushless motor + 5:1 Planetary Gearbox + alloy axle. Zero radial offset fits tightly in compact drum & flipper bots.',
        });
        addNode(bp, { id: 'mtr', type: 'motor', label: 'Brushless 2.4kW', x: 60, y: 120, pos3d: [0, 0, -0.105],
            params: { powerW: 2400, noLoadRpm: 3800, efficiency: 0.89 } });
        addNode(bp, { id: 'gb', type: 'assembly', ref: 'gb_planetary_5to1', label: '5:1 Planetary', x: 270, y: 120, pos3d: [0, 0, 0.015] });
        addNode(bp, { id: 'axle', type: 'shaft', label: 'Coaxial Axle', x: 490, y: 120, pos3d: [0, 0, 0.120],
            params: { diameterMm: 20, lengthMm: 90, material: 'alloySteel' } });
        wire(bp, lib, [
            ['mtr', 'rot_out', 'gb', 'rot_in'],
            ['gb', 'rot_out', 'axle', 'rot_in'],
        ]);
        bp.exposedPorts = [
            { id: 'elec_in', label: 'DC In', domain: 'elec', dir: 'in', nodeId: 'mtr', portId: 'elec_in' },
            { id: 'rot_out', label: 'Axle Out', domain: 'rot', dir: 'out', nodeId: 'axle', portId: 'rot_out' },
        ];
        reg(bp);
    }

    // 8. Crawler Track Drive Pack (Motor -> 5:1 Planetary -> Slip Clutch -> Axle)
    {
        const bp = createBlueprint({
            id: 'drive_pod_crawler',
            name: 'Crawler Track Drive',
            scale: 'subassembly',
            kind: 'drivetrain',
            description: 'High-torque crawler sprocket drive with 5:1 planetary reduction and 140 N·m slip clutch to protect gears when tracks jam.',
        });
        addNode(bp, { id: 'mtr', type: 'motor', label: 'Torque Motor 2.6kW', x: 40, y: 120, pos3d: [0, 0, -0.13],
            params: { powerW: 2600, noLoadRpm: 2600, efficiency: 0.87 } });
        addNode(bp, { id: 'gb', type: 'assembly', ref: 'gb_planetary_5to1', label: '5:1 Planetary', x: 245, y: 120, pos3d: [0, 0, -0.01] });
        addNode(bp, { id: 'cl', type: 'slip_clutch', label: 'Track Slip Clutch', x: 455, y: 120, pos3d: [0, 0, 0.095],
            params: { slipTorqueNm: 140, radiusMm: 44 } });
        addNode(bp, { id: 'axle', type: 'shaft', label: 'Sprocket Shaft', x: 660, y: 120, pos3d: [0, 0, 0.175],
            params: { diameterMm: 22, lengthMm: 75, material: 'toolSteel' } });
        wire(bp, lib, [
            ['mtr', 'rot_out', 'gb', 'rot_in'],
            ['gb', 'rot_out', 'cl', 'rot_in'],
            ['cl', 'rot_out', 'axle', 'rot_in'],
        ]);
        bp.exposedPorts = [
            { id: 'elec_in', label: 'DC In', domain: 'elec', dir: 'in', nodeId: 'mtr', portId: 'elec_in' },
            { id: 'rot_out', label: 'Sprocket Out', domain: 'rot', dir: 'out', nodeId: 'axle', portId: 'rot_out' },
        ];
        reg(bp);
    }

    // 9. 240-Bar Hydraulic Power Pack (Motor -> Axial Pump -> Relief Valve -> Oil Cooler)
    {
        const bp = createBlueprint({
            id: 'hyd_power_pack',
            name: '240-Bar Hydraulic Pack',
            scale: 'subassembly',
            kind: 'hydraulics',
            description: 'Closed-loop hydraulic power unit: 3.2 kW motor driving a 14 cc/rev axial-piston pump protected by a 210-bar pressure-relief manifold.',
        });
        addNode(bp, { id: 'mtr', type: 'motor', label: 'Pump Motor 3.2kW', x: 40, y: 120, pos3d: [0, 0, -0.14],
            params: { powerW: 3200, noLoadRpm: 3000, efficiency: 0.88 } });
        addNode(bp, { id: 'pump', type: 'hydraulic_pump', label: '14cc Axial Pump', x: 250, y: 120, pos3d: [0, 0, -0.01],
            params: { dispCcRev: 14, maxBar: 260, efficiency: 0.90 } });
        addNode(bp, { id: 'valve', type: 'hydraulic_valve', label: '210-Bar Relief Valve', x: 460, y: 120, pos3d: [0, 0, 0.12],
            params: { reliefBar: 210, flowLpm: 42 } });
        wire(bp, lib, [
            ['mtr', 'rot_out', 'pump', 'rot_in'],
            ['pump', 'hyd_out', 'valve', 'hyd_in'],
        ]);
        bp.exposedPorts = [
            { id: 'elec_in', label: 'DC In', domain: 'elec', dir: 'in', nodeId: 'mtr', portId: 'elec_in' },
            { id: 'hyd_out', label: 'Regulated Hyd', domain: 'hyd', dir: 'out', nodeId: 'valve', portId: 'hyd_out' },
        ];
        reg(bp);
    }

    // 10. Fail-Safe Horizontal Spinner Drive (ball/roller alloy gearbox + slip clutch + $3 brass shear pin!)
    {
        const bp = createBlueprint({
            id: 'spinner_drive_fused',
            name: 'Fail-Safe Spinner Drive',
            scale: 'subassembly',
            kind: 'weapon',
            description: 'Engineered for sustained combat & cheap repairs: 3:1 Alloy Weapon Gearbox runs cool at 4200 RPM, Slip Clutch absorbs 50 N·m glancing hits, and a $3 Brass Shear Pin snaps cleanly at 96 N·m before gears strip!',
        });
        addNode(bp, { id: 'mtr', type: 'motor', label: 'Weapon Motor 4.5kW', x: 40, y: 130, pos3d: [-0.03, 0, -0.34],
            params: { powerW: 4500, noLoadRpm: 4200, efficiency: 0.89 } });
        addNode(bp, { id: 'gb', type: 'assembly', ref: 'gb_3to1_weapon', label: '3:1 Alloy Gearbox', x: 235, y: 130, pos3d: [0, 0, -0.20] });
        addNode(bp, { id: 'clutch', type: 'slip_clutch', label: '50 N·m Slip Clutch', x: 440, y: 130, pos3d: [0.03, 0, -0.09],
            params: { slipTorqueNm: 50, radiusMm: 46 } });
        addNode(bp, { id: 'pin', type: 'shear_pin', label: 'Brass Shear Pin', x: 635, y: 130, pos3d: [0.03, 0, -0.02],
            params: { diameterMm: 9.8, material: 'brass' } });
        addNode(bp, { id: 'fly', type: 'flywheel', label: 'Steel Flywheel', x: 825, y: 130, pos3d: [0.03, 0, 0.05],
            params: { radiusMm: 64, thicknessMm: 18, material: 'alloySteel' } });
        addNode(bp, { id: 'bar', type: 'weapon_head', label: 'S7 Spinner Bar', x: 1020, y: 130, pos3d: [0.03, 0.04, 0.44],
            params: { kind: 'spinner_bar', massKg: 11, radiusM: 0.32, material: 'toolSteel' } });
        wire(bp, lib, [
            ['mtr', 'rot_out', 'gb', 'rot_in'],
            ['gb', 'rot_out', 'clutch', 'rot_in'],
            ['clutch', 'rot_out', 'pin', 'rot_in'],
            ['pin', 'rot_out', 'fly', 'rot_in'],
            ['fly', 'rot_out', 'bar', 'rot_in'],
        ]);
        bp.exposedPorts = [
            { id: 'elec_in', label: 'DC In', domain: 'elec', dir: 'in', nodeId: 'mtr', portId: 'elec_in' },
        ];
        reg(bp);
    }

    // 11. Unprotected Direct-Drive Spinner (Raw)
    {
        const bp = createBlueprint({
            id: 'spinner_drive_raw',
            name: 'Direct-Drive Spinner (Raw)',
            scale: 'subassembly',
            kind: 'weapon',
            description: 'Unprotected direct-coupled spinner: zero torque limiter or shear pin. Delivers raw shock directly into the 3:1 gearbox pinion.',
        });
        addNode(bp, { id: 'mtr', type: 'motor', label: 'Weapon Motor 4.5kW', x: 40, y: 130, pos3d: [-0.03, 0, -0.32],
            params: { powerW: 4500, noLoadRpm: 4200, efficiency: 0.88 } });
        addNode(bp, { id: 'gb', type: 'assembly', ref: 'gb_3to1_light', label: '3:1 Light Gearbox', x: 245, y: 130, pos3d: [0, 0, -0.18] });
        addNode(bp, { id: 'shaft', type: 'shaft', label: 'Rigid Shaft', x: 455, y: 130, pos3d: [0.03, 0, -0.05],
            params: { diameterMm: 22, lengthMm: 100, material: 'toolSteel' } });
        addNode(bp, { id: 'fly', type: 'flywheel', label: 'Steel Flywheel', x: 655, y: 130, pos3d: [0.03, 0, 0.05],
            params: { radiusMm: 64, thicknessMm: 18, material: 'alloySteel' } });
        addNode(bp, { id: 'bar', type: 'weapon_head', label: 'S7 Spinner Bar', x: 855, y: 130, pos3d: [0.03, 0.04, 0.44],
            params: { kind: 'spinner_bar', massKg: 11, radiusM: 0.32, material: 'toolSteel' } });
        wire(bp, lib, [
            ['mtr', 'rot_out', 'gb', 'rot_in'],
            ['gb', 'rot_out', 'shaft', 'rot_in'],
            ['shaft', 'rot_out', 'fly', 'rot_in'],
            ['fly', 'rot_out', 'bar', 'rot_in'],
        ]);
        bp.exposedPorts = [
            { id: 'elec_in', label: 'DC In', domain: 'elec', dir: 'in', nodeId: 'mtr', portId: 'elec_in' },
        ];
        reg(bp);
    }

    // 12. Belt-Driven Vertical Drum Weapon (Motor -> HTD Belt -> Sprag Freewheel -> Toothed Drum!)
    {
        const bp = createBlueprint({
            id: 'drum_drive_belted',
            name: 'Belted Vertical Drum',
            scale: 'subassembly',
            kind: 'weapon',
            description: 'High-KE vertical toothed drum spun by a shock-cushioning HTD timing belt and one-way sprag freewheel clutch. Belt slips/snaps ($9) before hurting the motor!',
        });
        addNode(bp, { id: 'mtr', type: 'motor', label: 'Drum Motor 5.0kW', x: 40, y: 130, pos3d: [0, 0, -0.22],
            params: { powerW: 5000, noLoadRpm: 5600, efficiency: 0.89 } });
        addNode(bp, { id: 'belt', type: 'belt_drive', label: '2.2:1 HTD Belt', x: 245, y: 130, pos3d: [0, 0, -0.02],
            params: { ratio: 2.2, widthMm: 28, spanMm: 170, slipTorqueNm: 48 } });
        addNode(bp, { id: 'sprag', type: 'overrun_clutch', label: 'Sprag Freewheel', x: 460, y: 130, pos3d: [0, 0, 0.14],
            params: { diameterMm: 56, material: 'toolSteel' } });
        addNode(bp, { id: 'drum', type: 'weapon_head', label: 'S7 Tooth Drum', x: 675, y: 130, pos3d: [0, 0.02, 0.28],
            params: { kind: 'spinner_drum', massKg: 13.5, radiusM: 0.11, material: 'toolSteel' } });
        wire(bp, lib, [
            ['mtr', 'rot_out', 'belt', 'rot_in'],
            ['belt', 'rot_out', 'sprag', 'rot_in'],
            ['sprag', 'rot_out', 'drum', 'rot_in'],
        ]);
        bp.exposedPorts = [
            { id: 'elec_in', label: 'DC In', domain: 'elec', dir: 'in', nodeId: 'mtr', portId: 'elec_in' },
        ];
        reg(bp);
    }

    // 13. Spring-Loaded Overhead Hammer Assembly
    {
        const bp = createBlueprint({
            id: 'hammer_drive',
            name: 'Spring Hammer Drive',
            scale: 'subassembly',
            kind: 'weapon',
            description: 'Motor winds a 220 N·m/rad tool-steel torsion spring through a 4:1 gearbox and releases a violent overhead strike.',
        });
        addNode(bp, { id: 'mtr', type: 'motor', label: 'Winder Motor 1.6kW', x: 40, y: 130, pos3d: [-0.06, 0.18, -0.18],
            params: { powerW: 1600, noLoadRpm: 2800, efficiency: 0.85 } });
        addNode(bp, { id: 'gb', type: 'assembly', ref: 'gb_4to1_heavy', label: '4:1 Heavy Gearbox', x: 250, y: 130, pos3d: [-0.06, 0.18, -0.04] });
        addNode(bp, { id: 'spr', type: 'spring_actuator', label: 'Torsion Spring', x: 460, y: 130, pos3d: [0, 0.18, 0.09],
            params: { stiffnessNmRad: 220, maxAngleDeg: 120, material: 'toolSteel' } });
        addNode(bp, { id: 'arm', type: 'weapon_head', label: 'Overhead Hammer', x: 670, y: 130, pos3d: [0, 0.21, 0.30],
            params: { kind: 'hammer_arm', massKg: 7.5, radiusM: 0.40, material: 'toolSteel' } });
        wire(bp, lib, [
            ['mtr', 'rot_out', 'gb', 'rot_in'],
            ['gb', 'rot_out', 'spr', 'rot_in'],
            ['spr', 'rot_out', 'arm', 'rot_in'],
        ]);
        bp.exposedPorts = [
            { id: 'elec_in', label: 'DC In', domain: 'elec', dir: 'in', nodeId: 'mtr', portId: 'elec_in' },
        ];
        reg(bp);
    }

    // 14. Hydraulic Piercing Crusher Jaw Assembly (Hyd Pack -> 68mm Ram -> Piercing Beak!)
    {
        const bp = createBlueprint({
            id: 'crusher_jaw_pack',
            name: 'Hydraulic Crusher Pack',
            scale: 'subassembly',
            kind: 'weapon',
            description: '240-Bar Hydraulic Power Pack driving a 68 mm bore cylinder into a hardened S7 piercing crusher beak (~90 kN bite force, relief-valve protected!).',
        });
        addNode(bp, { id: 'hpu', type: 'assembly', ref: 'hyd_power_pack', label: '240-Bar Hyd Pack', x: 40, y: 130, pos3d: [0, 0, -0.14] });
        addNode(bp, { id: 'ram', type: 'hydraulic_ram', label: '68mm Crusher Ram', x: 270, y: 130, pos3d: [0, 0.04, 0.12],
            params: { boreMm: 68, strokeMm: 160, maxBar: 260, material: 'toolSteel' } });
        addNode(bp, { id: 'jaw', type: 'weapon_head', label: 'S7 Piercing Jaw', x: 500, y: 130, pos3d: [0, 0.14, 0.34],
            params: { kind: 'crusher_jaw', massKg: 10.5, radiusM: 0.32, material: 'toolSteel' } });
        wire(bp, lib, [
            ['hpu', 'hyd_out', 'ram', 'hyd_in'],
            ['ram', 'lin_out', 'jaw', 'lin_in'],
        ]);
        bp.exposedPorts = [
            { id: 'elec_in', label: 'DC In', domain: 'elec', dir: 'in', nodeId: 'hpu', portId: 'elec_in' },
        ];
        reg(bp);
    }

    // 15. Supercap Hydraulic Flipper Launcher (Cap Bank -> Hyd Pack -> Fast Ram -> Flipper Spatula!)
    {
        const bp = createBlueprint({
            id: 'flipper_launcher_pack',
            name: 'Hydraulic Flipper Pack',
            scale: 'subassembly',
            kind: 'weapon',
            description: 'Supercapacitor burst bank feeding a high-flow hydraulic ram & hinged Hardox launcher spatula capable of tossing 100 kg opponents.',
        });
        addNode(bp, { id: 'cap', type: 'capacitor_bank', label: '28kW Supercap Bank', x: 40, y: 130, pos3d: [-0.14, 0, -0.14],
            params: { voltage: 48, energyKJ: 24, maxPeakKW: 28 } });
        addNode(bp, { id: 'hpu', type: 'assembly', ref: 'hyd_power_pack', label: '240-Bar Hyd Pack', x: 250, y: 130, pos3d: [0.06, 0, -0.10] });
        addNode(bp, { id: 'ram', type: 'hydraulic_ram', label: 'Fast Launcher Ram', x: 480, y: 130, pos3d: [0, 0.02, 0.15],
            params: { boreMm: 54, strokeMm: 190, maxBar: 240, material: 'alloySteel' } });
        addNode(bp, { id: 'spat', type: 'weapon_head', label: 'Hardox Flipper', x: 710, y: 130, pos3d: [0, 0.04, 0.36],
            params: { kind: 'flipper_spatula', massKg: 8.5, radiusM: 0.28, material: 'hardox' } });
        wire(bp, lib, [
            ['cap', 'elec_out', 'hpu', 'elec_in'],
            ['hpu', 'hyd_out', 'ram', 'hyd_in'],
            ['ram', 'lin_out', 'spat', 'lin_in'],
        ]);
        bp.exposedPorts = [
            { id: 'elec_in', label: 'DC In', domain: 'elec', dir: 'in', nodeId: 'cap', portId: 'elec_in' },
        ];
        reg(bp);
    }

    // Register Tier 2 Industrial/Mech, Utility/Control, Workshop & Tier 3 Titan Modules
    registerMachinesAndTitans(lib, reg, wire);
    registerUtilityAndControlMachines(lib, reg, wire);
    registerIndustrialAndMechMachines(lib, reg, wire);

    return lib;
}

export const PRESET_GROUPS = [
    {
        label: 'Tier 1 — Mechanisms & Sub-Assemblies (10–60 cm)',
        ids: [
            'gb_3to1_light', 'gb_3to1_weapon', 'gb_4to1_heavy', 'gb_planetary_5to1', 'gb_worm_20to1',
            'drive_pod_heavy', 'drive_pod_light', 'drive_pod_planetary', 'drive_pod_crawler',
            'hyd_power_pack', 'worm_hoist_pack', 'fork_mast_pack',
            'spinner_drive_fused', 'spinner_drive_raw', 'drum_drive_belted',
            'hammer_drive', 'crusher_jaw_pack', 'flipper_launcher_pack',
        ],
    },
    {
        label: 'Tier 2 — Heavy Industrial, Mech & Workshop Machines (0.9–1.6 m)',
        ids: [
            'mach_excavator_crawler', 'mach_mech_walker', 'mach_haul_tractor', 'mach_rotary_drill',
            'mach_engine_lathe', 'mach_compound_powerhouse', 'machine_gantry_crane',
            'machine_shop_press', 'machine_cnc_mill',
        ],
    },
    {
        label: 'Tier 2 — Compact Mobile & Arena Test Rigs (0.7–1.0 m)',
        ids: [
            'bot_atlas_forklift', 'bot_kodiak_grapple', 'bot_ballista_catapult', 'bot_battering_bull',
            'bot_catapult_flipper', 'bot_fang_crusher', 'bot_piledriver_crank', 'bot_iron_wedge', 'bot_anvil_hammer',
            'bot_shredder_safe', 'bot_mauler_drum', 'bot_twin_saw_mantis', 'bot_goliath_twin_v4',
            'bot_ripper_gas', 'bot_shredder_raw',
        ],
    },
    {
        label: 'Tier 3 — Titan Modules & Multi-Storey Machinery (4–10 m)',
        ids: ['titan_recovery_crane', 'titan_hip_drive', 'titan_hydraulic_leg', 'titan_crawler_bogie', 'titan_siege_core'],
    },
];
