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
