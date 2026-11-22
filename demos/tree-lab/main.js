// Tree Lab entry: boot the kit, grow the first species and mount the panel.
// Everything else is in lab.js, which the capture scripts import.
import { boot, h } from "/lib/kit/index.js";
import { vp, sky, person, growSpecies, measureTree, matureScale, draw, clear } from "/app/lab.js";

const app = boot();
const NAMES = ['oak', 'beech', 'elm', 'birch', 'pine', 'spruce', 'fir', 'redwood'];

function show(name) {
    app.status.set(`growing ${name}…`);
    const { world } = growSpecies(name);
    const m = measureTree(world);
    clear();
    const k = matureScale(name, m);
    const d = draw(world, { scale: k, leaf: 1.5 });
    // The post stands clear of the trunk, under the crown's edge.
    person.x = Math.max(2.5, k * m.crownW * 0.3); person.z = 1.5;
    vp.reframe([0, k * m.height * 0.45, 0], k * m.height * 1.4);
    app.status.set(`${name}: ${(k * m.height).toFixed(1)} m tall, trunk ${(k * m.trunkD).toFixed(2)} m, clear bole ${(k * m.bole).toFixed(1)} m,`
        + ` crown ${(k * m.crownW).toFixed(1)} m, ${d.leafCount} leaves`);
}

const list = document.getElementById('species');
for (const n of NAMES) list.append(h('button', { onclick: () => show(n) }, n));
const tod = document.getElementById('tod');
for (const p of ['noon', 'golden', 'dawn']) tod.append(h('button', { onclick: () => sky.apply(p) }, p));
show(NAMES[0]);
