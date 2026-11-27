// lib/foundry/yards.js — yards to work in: machines from the library stood on the
// ground, crates, pads, and the deliveries asked for. Each yard is built by a
// function of `contract(id)` (the compiled library), so its machines are what the
// library's designs compile to now.

import { createSite } from "./site.js";

export const YARDS = [
    {
        id: 'handover', name: 'Hand-over',
        about: 'Two slewing cranes, five metres apart. The crate is beyond the second crane and the pad beyond the first: neither reaches both, so the first sets it down where the second can take it.',
        build(contract) {
            const site = createSite();
            const crane = contract('slewingCrane');
            site.addMachine(crane, { pos: [0, 0], name: 'Crane A' });
            site.addMachine(crane, { pos: [5, 0], yaw: Math.PI, name: 'Crane B' });
            const cr = site.addCrate([-2.3, 0.8], 0.3, { name: 'Crate' });
            const pad = site.addPad([7.4, -0.6], 0.8, { name: 'Pad' });
            site.deliver(cr, pad);
            site.addPerson([2.5, -3.4]);
            return site;
        },
    },
    {
        id: 'relay', name: 'Relay',
        about: 'Three cranes in a line, two crates at one end and two pads at the other: each crate goes down the line, crane to crane.',
        build(contract) {
            const site = createSite();
            const crane = contract('slewingCrane');
            site.addMachine(crane, { pos: [0, 0], name: 'Crane A' });
            site.addMachine(crane, { pos: [4.8, 0], yaw: Math.PI, name: 'Crane B' });
            site.addMachine(crane, { pos: [9.6, 0], yaw: Math.PI, name: 'Crane C' });
            const a = site.addCrate([-2.4, 0.5], 0.3, { name: 'Crate 1' });
            const b = site.addCrate([-1.9, -1.4], 0.3, { name: 'Crate 2' });
            const p = site.addPad([12.0, 0.6], 0.7, { name: 'Pad 1' });
            const q = site.addPad([11.5, -1.5], 0.7, { name: 'Pad 2' });
            site.deliver(a, p);
            site.deliver(b, q);
            site.addPerson([4.8, -3.6]);
            return site;
        },
    },
    {
        id: 'haul', name: 'Haul',
        about: 'A crane at the depot and another at the site, twenty metres apart: the Carrier drives between them. The depot crane sets the crate on its deck; it drives it over to the site crane, which sets it on the pad.',
        build(contract) {
            const site = createSite();
            const crane = contract('slewingCrane');
            site.addMachine(crane, { pos: [0, 0], name: 'Depot Crane' });
            site.addMachine(crane, { pos: [20, 0], yaw: Math.PI, name: 'Site Crane' });
            site.addMachine(contract('carrier'), { pos: [6, -4], yaw: 0, name: 'Carrier' });
            const cr = site.addCrate([-2.3, 0.8], 0.3, { name: 'Crate' });
            const pad = site.addPad([22.4, -0.6], 0.8, { name: 'Pad' });
            site.deliver(cr, pad);
            site.addPerson([10, -6]);
            return site;
        },
    },
    {
        id: 'grade', name: 'Up the ramp',
        about: 'The haul again, but the site is on a bench a metre up: a bank too steep for the Carrier stands across the straight way, and a ramp climbs to the bench off to one side. The Carrier finds the ramp from what it climbs with the crate aboard.',
        build(contract) {
            const s = (t) => { const u = Math.max(0, Math.min(1, t)); return u * u * (3 - 2 * u); };
            const site = createSite({ terrain: {
                from: [-4, -13], to: [27, 7], cell: 0.25,
                // The bench: a metre up past x = 15, behind a wall half a metre across. The ramp: a lane
                // three metres wide at z = -8.5 rising a metre from x = 5 to 15 (10%).
                height: (x, z) => {
                    const bench = s((x - 14.5) / 0.5), lane = 1 - s((Math.abs(z + 8.5) - 1.5) / 0.5);
                    // Walled all round inside the grid, down to the floor.
                    const edge = s((26.5 - x) / 0.5) * s((6.5 - z) / 0.5) * s((z + 12.5) / 0.5);
                    return edge * Math.max(bench, lane * Math.max(0, Math.min(1, (x - 4.5) / 10)));
                },
            } });
            const crane = contract('slewingCrane');
            site.addMachine(crane, { pos: [0, 0], name: 'Depot Crane' });
            site.addMachine(crane, { pos: [20, 0], yaw: Math.PI, name: 'Site Crane' });
            site.addMachine(contract('carrier'), { pos: [6, -4], yaw: 0, name: 'Carrier' });
            const cr = site.addCrate([-2.3, 0.8], 0.3, { name: 'Crate' });
            const pad = site.addPad([22.4, -0.6], 0.8, { name: 'Pad' });
            site.deliver(cr, pad);
            site.addPerson([10, 2]);
            return site;
        },
    },
    {
        id: 'frame', name: 'Portal frame',
        about: 'Two cranes build a precast concrete frame: a footing, then a column stood up on it, at each end, then a lintel across the columns\' tops. The columns lie down until they go up, below the cranes\' jibs, and hang upright from the eye cast in their tops. The lintel weighs 160 kg, more than either crane lifts, so they lift it together, one at each end.',
        build(contract) {
            const site = createSite();
            const crane = contract('slewingCrane');
            site.addMachine(crane, { pos: [0, 0], name: 'Crane A' });
            site.addMachine(crane, { pos: [7.2, 0], yaw: Math.PI, name: 'Crane B' });
            const FOOT = [0.2, 0.075, 0.2], COL = [0.07, 0.35, 0.07], LINTEL = [1.3, 0.08, 0.08];
            const f1 = site.addPiece([1.2, -2.3], FOOT, { name: 'Footing 1', material: 'concrete' });
            const f2 = site.addPiece([6, -2.3], FOOT, { name: 'Footing 2', material: 'concrete' });
            const c1 = site.addPiece([-1.6, -2], COL, { name: 'Column 1', material: 'concrete', lying: true, eye: true });
            const c2 = site.addPiece([8.8, -2], COL, { name: 'Column 2', material: 'concrete', lying: true, yaw: Math.PI, eye: true });
            const li = site.addPiece([3.6, 1.5], LINTEL, { name: 'Lintel', material: 'concrete' });
            const top = 2 * FOOT[1];
            const F1 = site.place(f1, [2.6, FOOT[1], 0], { yaw: null, label: 'Footing 1 at the left' });
            const F2 = site.place(f2, [4.6, FOOT[1], 0], { yaw: null, label: 'Footing 2 at the right' });
            const C1 = site.place(c1, [2.6, top + COL[1], 0], { yaw: null, after: [F1], label: 'Column 1 on Footing 1' });
            const C2 = site.place(c2, [4.6, top + COL[1], 0], { yaw: null, after: [F2], label: 'Column 2 on Footing 2' });
            site.place(li, [3.6, top + 2 * COL[1] + LINTEL[1], 0], { after: [C1, C2], label: 'Lintel across the columns' });
            site.addPerson([3.6, -3.6]);
            return site;
        },
    },
    {
        id: 'build', name: 'Depot to frame',
        about: 'The frame again, but its footings and columns are at a depot fourteen metres off. The depot crane loads them on the Carrier one at a time, laying each column down along its deck so it rides lying; the Carrier drives round the cranes to the one that sets each piece; the two site cranes build the frame as its pieces arrive, and lift the lintel, already on site, together.',
        build(contract) {
            const site = createSite();
            const crane = contract('slewingCrane');
            site.addMachine(crane, { pos: [-14, 0], name: 'Depot Crane' });
            site.addMachine(crane, { pos: [0, 0], name: 'Crane A' });
            site.addMachine(crane, { pos: [7.2, 0], yaw: Math.PI, name: 'Crane B' });
            site.addMachine(contract('carrier'), { pos: [-7, -4], yaw: Math.PI, name: 'Carrier' });
            const FOOT = [0.2, 0.075, 0.2], COL = [0.07, 0.35, 0.07], LINTEL = [1.3, 0.08, 0.08];
            const f1 = site.addPiece([-16.4, -1.2], FOOT, { name: 'Footing 1', material: 'concrete' });
            const f2 = site.addPiece([-16.6, 0.2], FOOT, { name: 'Footing 2', material: 'concrete' });
            const c1 = site.addPiece([-16.2, 1.6], COL, { name: 'Column 1', material: 'concrete', lying: true, yaw: Math.PI, eye: true });
            const c2 = site.addPiece([-15.2, 2.3], COL, { name: 'Column 2', material: 'concrete', lying: true, yaw: Math.PI, eye: true });
            const li = site.addPiece([3.6, 1.5], LINTEL, { name: 'Lintel', material: 'concrete' });
            const top = 2 * FOOT[1];
            const F1 = site.place(f1, [2.6, FOOT[1], 0], { yaw: null, label: 'Footing 1 at the left' });
            const F2 = site.place(f2, [4.6, FOOT[1], 0], { yaw: null, label: 'Footing 2 at the right' });
            const C1 = site.place(c1, [2.6, top + COL[1], 0], { yaw: null, after: [F1], label: 'Column 1 on Footing 1' });
            const C2 = site.place(c2, [4.6, top + COL[1], 0], { yaw: null, after: [F2], label: 'Column 2 on Footing 2' });
            site.place(li, [3.6, top + 2 * COL[1] + LINTEL[1], 0], { after: [C1, C2], label: 'Lintel across the columns' });
            site.addPerson([-6, -6]);
            return site;
        },
    },
    {
        id: 'mixed', name: 'Crane and excavator',
        about: 'A slewing crane and an excavator: the excavator reaches the crates, the crane the pad.',
        build(contract) {
            const site = createSite();
            site.addMachine(contract('excavator'), { pos: [0, 0], name: 'Excavator' });
            site.addMachine(contract('slewingCrane'), { pos: [5, 0], yaw: Math.PI, name: 'Crane' });
            const cr = site.addCrate([-2.4, 1.2], 0.24, { name: 'Crate' });
            const pad = site.addPad([7.5, 0.5], 0.8, { name: 'Pad' });
            site.deliver(cr, pad);
            site.addPerson([2.5, -3.6]);
            return site;
        },
    },
];
