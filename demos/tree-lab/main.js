// Tree Lab entry: boot the kit, grow the first species and mount the panel.
// Everything else is in lab.js, which the capture scripts import.
import { boot, h } from "/lib/kit/index.js";
import { sky, growSpecies, measureTree, draw, clear } from "/app/lab.js";

const app = boot();
const NAMES = ['oak', 'beech', 'elm', 'birch', 'pine', 'spruce', 'fir', 'redwood'];

function show(name) {
    app.status.set(`growing ${name}…`);
    const { world } = growSpecies(name);
    const m = measureTree(world);
    clear();
    const d = draw(world);
    app.status.set(`${name}: ${m.height.toFixed(1)} m tall, trunk ${m.trunkD.toFixed(2)} m, clear bole ${m.bole.toFixed(1)} m, crown ${m.crownW.toFixed(1)} m, ${d.leafCount} leaves`);
}

const list = document.getElementById('species');
for (const n of NAMES) list.append(h('button', { onclick: () => show(n) }, n));
const tod = document.getElementById('tod');
for (const p of ['noon', 'golden', 'dawn']) tod.append(h('button', { onclick: () => sky.apply(p) }, p));
show(NAMES[0]);
